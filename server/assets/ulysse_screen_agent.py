#!/usr/bin/env python3
"""
Ulysse Screen Monitor Agent - Windows Desktop Companion
Captures screen in real-time and sends to Ulysse for analysis.

Requirements:
    pip install mss pillow websocket-client pywin32 psutil pyautogui

Optional (faster capture, but may produce black frames on some GPUs):
    pip install dxcam opencv-python numpy

Usage:
    python ulysse_screen_agent.py --server wss://ulyssepro.org/ws/screen --user-id 1
"""

import argparse
import base64
import json
import time
import threading
import sys
import os
from io import BytesIO
from datetime import datetime

try:
    from PIL import Image
    import websocket
    import win32gui
    import win32process
    import psutil
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("\nInstall requirements with:")
    print("pip install mss pillow websocket-client pywin32 psutil pyautogui")
    sys.exit(1)

DXCAM_AVAILABLE = False
try:
    import dxcam
    import numpy as np
    DXCAM_AVAILABLE = True
except ImportError:
    pass

MSS_AVAILABLE = False
try:
    import mss
    MSS_AVAILABLE = True
except ImportError:
    pass

if not MSS_AVAILABLE:
    try:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "mss", "-q"])
        import mss
        MSS_AVAILABLE = True
        print("[INFO] Installed mss for screen capture")
    except Exception:
        pass

if not MSS_AVAILABLE and not DXCAM_AVAILABLE:
    print("[ERROR] No screen capture library available.")
    print("Install with: pip install mss")
    sys.exit(1)

try:
    import pyautogui
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.05
    REMOTE_CONTROL_AVAILABLE = True
    print("[INFO] Remote control (pyautogui) available")
except ImportError:
    REMOTE_CONTROL_AVAILABLE = False
    print("[WARN] pyautogui not installed — remote control disabled. Run: pip install pyautogui")

class ScreenMonitorAgent:
    def __init__(self, server_url, auth_token=None, user_id=None,
                 device_id="windows-agent", device_name=None,
                 fps=2, quality="medium", privacy_mode=False):
        self.server_url = server_url
        self.auth_token = auth_token
        self.user_id = user_id
        self.device_id = device_id
        self.device_name = device_name or os.environ.get("COMPUTERNAME", "Windows PC")
        self.fps = fps
        self.quality = quality
        self.privacy_mode = privacy_mode

        self.ws = None
        self.dxcam_camera = None
        self.mss_sct = None
        self.running = False
        self.paused = False
        self.connected = False
        self.authenticated = False
        self.last_activity = time.time()
        self.inactivity_timeout = 120
        self.remote_control_enabled = False
        self.capture_method = None
        self.black_frame_count = 0

        self.quality_settings = {
            "low": {"resolution": (640, 480), "jpeg_quality": 50},
            "medium": {"resolution": (1024, 768), "jpeg_quality": 70},
            "high": {"resolution": (1920, 1080), "jpeg_quality": 85}
        }

        self.privacy_keywords = [
            "password", "mot de passe", "connexion", "login",
            "bank", "banque", "paypal", "stripe", "credit",
            "secret", "private", "confidentiel"
        ]

    def get_active_window_info(self):
        try:
            hwnd = win32gui.GetForegroundWindow()
            window_title = win32gui.GetWindowText(hwnd)
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            try:
                process = psutil.Process(pid)
                app_name = process.name().replace(".exe", "")
            except Exception:
                app_name = "Unknown"
            if self.should_filter_window(window_title, app_name):
                return app_name, "[Contenu sensible masque]"
            return app_name, window_title[:100] if window_title else ""
        except Exception:
            return "Unknown", ""

    def should_filter_window(self, title, app_name):
        if self.privacy_mode:
            return True
        combined = f"{title} {app_name}".lower()
        for keyword in self.privacy_keywords:
            if keyword in combined:
                return True
        return False

    def _is_black_frame(self, pil_img):
        small = pil_img.resize((16, 16))
        pixels = list(small.getdata())
        avg = sum(sum(p[:3]) for p in pixels) / (len(pixels) * 3)
        return avg < 5

    def _capture_dxcam(self):
        if not DXCAM_AVAILABLE:
            return None
        try:
            if not self.dxcam_camera:
                self.dxcam_camera = dxcam.create(output_idx=0)
                self.dxcam_camera.start(target_fps=self.fps)
                time.sleep(0.5)
            frame = self.dxcam_camera.get_latest_frame()
            if frame is None:
                return None
            return Image.fromarray(frame)
        except Exception as e:
            print(f"[WARN] DXCam capture error: {e}")
            return None

    def _capture_mss(self):
        if not MSS_AVAILABLE:
            return None
        try:
            if not self.mss_sct:
                self.mss_sct = mss.mss()
            monitor = self.mss_sct.monitors[1]
            screenshot = self.mss_sct.grab(monitor)
            return Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
        except Exception as e:
            print(f"[WARN] MSS capture error: {e}")
            return None

    def _capture_pyautogui(self):
        if not REMOTE_CONTROL_AVAILABLE:
            return None
        try:
            return pyautogui.screenshot()
        except Exception as e:
            print(f"[WARN] pyautogui screenshot error: {e}")
            return None

    def capture_screen(self):
        try:
            pil_img = None

            if self.capture_method == "mss":
                pil_img = self._capture_mss()
            elif self.capture_method == "dxcam":
                pil_img = self._capture_dxcam()
            elif self.capture_method == "pyautogui":
                pil_img = self._capture_pyautogui()
            else:
                if DXCAM_AVAILABLE:
                    pil_img = self._capture_dxcam()
                    if pil_img and not self._is_black_frame(pil_img):
                        self.capture_method = "dxcam"
                        print("[INFO] Capture method: DXCam (fast GPU capture)")
                    else:
                        pil_img = None

                if pil_img is None and MSS_AVAILABLE:
                    pil_img = self._capture_mss()
                    if pil_img and not self._is_black_frame(pil_img):
                        self.capture_method = "mss"
                        print("[INFO] Capture method: MSS (reliable cross-platform)")
                    else:
                        pil_img = None

                if pil_img is None:
                    pil_img = self._capture_pyautogui()
                    if pil_img and not self._is_black_frame(pil_img):
                        self.capture_method = "pyautogui"
                        print("[INFO] Capture method: pyautogui (fallback)")
                    else:
                        pil_img = None

            if pil_img is None:
                return None

            if self._is_black_frame(pil_img):
                self.black_frame_count += 1
                if self.black_frame_count >= 5 and self.capture_method:
                    print(f"[WARN] {self.black_frame_count} black frames — resetting capture method")
                    self.capture_method = None
                    self.black_frame_count = 0
                    if self.dxcam_camera:
                        try:
                            self.dxcam_camera.stop()
                        except Exception:
                            pass
                        self.dxcam_camera = None
                return None
            else:
                self.black_frame_count = 0

            settings = self.quality_settings.get(self.quality, self.quality_settings["medium"])
            pil_img = pil_img.resize(settings["resolution"], Image.Resampling.LANCZOS)
            buffer = BytesIO()
            pil_img.save(buffer, format="JPEG", quality=settings["jpeg_quality"])
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
        except Exception as e:
            print(f"[ERROR] Capture failed: {e}")
            return None

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            if msg_type == "connected":
                print("[INFO] Connected to server, authenticating...")
                self.send_auth()
            elif msg_type == "auth.success":
                self.authenticated = True
                print(f"[INFO] Authenticated successfully as user {data.get('userId')}")
                self.start_monitoring()
            elif msg_type == "auth.failed":
                print(f"[ERROR] Authentication failed: {data.get('error')}")
                self.stop()
            elif msg_type == "session.started":
                print(f"[INFO] Monitoring session started (ID: {data.get('sessionId')})")
                self.ws.send(json.dumps({
                    "type": "capability",
                    "remoteControl": REMOTE_CONTROL_AVAILABLE,
                    "platform": sys.platform
                }))
            elif msg_type == "session.paused":
                self.paused = True
                print("[INFO] Session paused")
            elif msg_type == "session.resumed":
                self.paused = False
                print("[INFO] Session resumed")
            elif msg_type == "session.ended":
                print("[INFO] Session ended by server")
            elif msg_type == "analysis":
                analysis = data.get("data", {})
                context = analysis.get("context", "")
                tags = ", ".join(analysis.get("tags", []))
                print(f"[ANALYSIS] {context} | Tags: {tags}")
                if analysis.get("suggestions"):
                    for s in analysis["suggestions"]:
                        print(f"  -> Suggestion: {s}")
            elif msg_type == "remote_control.enable":
                if REMOTE_CONTROL_AVAILABLE:
                    self.remote_control_enabled = True
                    print("[REMOTE] Prise en main activee — Ulysse controle votre ecran")
                    self.ws.send(json.dumps({"type": "remote_control.status", "enabled": True, "timestamp": int(time.time() * 1000)}))
                else:
                    print("[REMOTE] pyautogui non installe")
                    self.ws.send(json.dumps({"type": "remote_control.status", "enabled": False, "error": "pyautogui not installed", "timestamp": int(time.time() * 1000)}))
            elif msg_type == "remote_control.disable":
                self.remote_control_enabled = False
                print("[REMOTE] Prise en main desactivee")
                self.ws.send(json.dumps({"type": "remote_control.status", "enabled": False, "timestamp": int(time.time() * 1000)}))
            elif msg_type == "remote_control.cmd":
                if self.remote_control_enabled and REMOTE_CONTROL_AVAILABLE:
                    result = self.handle_remote_control_cmd(data)
                    self.ws.send(json.dumps({"type": "remote_control.result", "success": result["success"], "cmd": data.get("cmd"), "msg": result.get("msg", ""), "timestamp": int(time.time() * 1000)}))
                else:
                    self.ws.send(json.dumps({"type": "remote_control.result", "success": False, "msg": "Remote control not enabled or pyautogui missing", "timestamp": int(time.time() * 1000)}))
            elif msg_type == "error":
                print(f"[ERROR] Server error: {data.get('error')}")
        except json.JSONDecodeError:
            print("[WARN] Invalid message received")

    def handle_remote_control_cmd(self, data):
        cmd = data.get("cmd", "")
        try:
            if cmd == "mouse_move":
                x, y = int(data["x"]), int(data["y"])
                pyautogui.moveTo(x, y, duration=0.3)
                print(f"[REMOTE] Mouse moved to ({x}, {y})")
                return {"success": True, "msg": f"Mouse moved to ({x}, {y})"}

            elif cmd == "click":
                x, y = int(data["x"]), int(data["y"])
                button = data.get("button", "left")
                pyautogui.click(x, y, button=button)
                print(f"[REMOTE] Clicked {button} at ({x}, {y})")
                return {"success": True, "msg": f"Clicked {button} at ({x}, {y})"}

            elif cmd == "double_click":
                x, y = int(data["x"]), int(data["y"])
                pyautogui.doubleClick(x, y)
                print(f"[REMOTE] Double-clicked at ({x}, {y})")
                return {"success": True, "msg": f"Double-clicked at ({x}, {y})"}

            elif cmd == "right_click":
                x, y = int(data["x"]), int(data["y"])
                pyautogui.rightClick(x, y)
                print(f"[REMOTE] Right-clicked at ({x}, {y})")
                return {"success": True, "msg": f"Right-clicked at ({x}, {y})"}

            elif cmd == "scroll":
                x = int(data.get("x", 0))
                y_pos = int(data.get("y", 0))
                dy = int(data.get("dy", 3))
                if x and y_pos:
                    pyautogui.moveTo(x, y_pos)
                pyautogui.scroll(-dy)
                print(f"[REMOTE] Scrolled dy={dy}")
                return {"success": True, "msg": f"Scrolled dy={dy}"}

            elif cmd == "key_press":
                key = data.get("key", "")
                if "+" in key:
                    keys = [k.strip() for k in key.split("+")]
                    pyautogui.hotkey(*keys)
                else:
                    pyautogui.press(key)
                print(f"[REMOTE] Key pressed: {key}")
                return {"success": True, "msg": f"Key pressed: {key}"}

            elif cmd == "type_text":
                text = data.get("text", "")
                pyautogui.write(text, interval=0.03)
                print(f"[REMOTE] Typed: {text[:30]}...")
                return {"success": True, "msg": f"Typed {len(text)} characters"}

            elif cmd == "screenshot":
                img_b64 = self.capture_screen()
                if img_b64 and self.ws:
                    app_name, win_title = self.get_active_window_info()
                    self.ws.send(json.dumps({
                        "type": "frame",
                        "frame": {
                            "imageBase64": img_b64,
                            "activeApp": app_name,
                            "activeWindow": win_title,
                            "timestamp": int(time.time() * 1000)
                        }
                    }))
                    return {"success": True, "msg": "Screenshot sent"}
                return {"success": False, "msg": "Screenshot capture failed (black frame or no capture method)"}

            else:
                return {"success": False, "msg": f"Unknown command: {cmd}"}

        except pyautogui.FailSafeException:
            print("[REMOTE] FAILSAFE triggered — mouse moved to corner. Remote control disabled.")
            self.remote_control_enabled = False
            return {"success": False, "msg": "Failsafe triggered — move mouse away from corner to re-enable"}
        except Exception as e:
            print(f"[REMOTE] Error executing {cmd}: {e}")
            return {"success": False, "msg": str(e)}

    def on_error(self, ws, error):
        print(f"[ERROR] WebSocket error: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        self.connected = False
        self.authenticated = False
        print(f"[INFO] Connection closed: {close_msg or 'Unknown reason'}")

    def on_open(self, ws):
        self.connected = True
        print("[INFO] WebSocket connection established")

    def send_auth(self):
        if self.ws:
            auth_msg = {"type": "auth", "deviceId": self.device_id, "deviceName": self.device_name}
            if self.auth_token:
                auth_msg["token"] = self.auth_token
            if self.user_id:
                auth_msg["userId"] = self.user_id
            self.ws.send(json.dumps(auth_msg))

    def start_monitoring(self):
        if self.ws and self.authenticated:
            self.ws.send(json.dumps({"type": "control", "action": "start"}))

    def send_frame(self):
        if not self.authenticated or self.paused:
            return
        app_name, window_title = self.get_active_window_info()
        img_base64 = self.capture_screen()
        if img_base64 and self.ws:
            frame_msg = {
                "type": "frame",
                "frame": {
                    "imageBase64": img_base64,
                    "activeApp": app_name,
                    "activeWindow": window_title,
                    "timestamp": int(time.time() * 1000)
                }
            }
            try:
                self.ws.send(json.dumps(frame_msg))
                self.last_activity = time.time()
            except Exception as e:
                print(f"[ERROR] Failed to send frame: {e}")

    def capture_loop(self):
        interval = 1.0 / self.fps
        print(f"[INFO] Starting capture loop at {self.fps} FPS")
        while self.running:
            if self.connected and self.authenticated and not self.paused:
                self.send_frame()
            time.sleep(interval)

    def heartbeat_loop(self):
        while self.running:
            if self.ws and self.connected:
                try:
                    self.ws.send(json.dumps({"type": "ping"}))
                except Exception:
                    pass
            time.sleep(30)

    def connect(self):
        websocket.enableTrace(False)
        self.ws = websocket.WebSocketApp(
            self.server_url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )

    def run(self):
        self.running = True
        self.connect()
        threading.Thread(target=self.capture_loop, daemon=True).start()
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()
        print(f"[INFO] Connecting to {self.server_url}...")
        print("[INFO] Press Ctrl+C to stop")
        while self.running:
            try:
                self.ws.run_forever(ping_interval=60, ping_timeout=30)
            except KeyboardInterrupt:
                print("\n[INFO] Stopping...")
                self.stop()
                break
            except Exception as e:
                print(f"[WARN] Connection lost: {e}")
            if self.running:
                print("[INFO] Reconnecting in 5 seconds...")
                time.sleep(5)
                self.connect()

    def stop(self):
        self.running = False
        if self.ws:
            if self.authenticated:
                try:
                    self.ws.send(json.dumps({"type": "control", "action": "stop"}))
                    time.sleep(0.5)
                except Exception:
                    pass
            self.ws.close()
        if self.dxcam_camera:
            try:
                self.dxcam_camera.stop()
            except Exception:
                pass
        if self.mss_sct:
            try:
                self.mss_sct.close()
            except Exception:
                pass
        print("[INFO] Agent stopped")

def main():
    parser = argparse.ArgumentParser(description="Ulysse Screen Monitor Agent")
    parser.add_argument("--server", "-s", required=True, help="WebSocket server URL")
    parser.add_argument("--token", "-t", help="Authentication token (JWT)")
    parser.add_argument("--user-id", "-u", type=int, help="User ID")
    parser.add_argument("--device-id", "-d", default="windows-agent", help="Device identifier")
    parser.add_argument("--device-name", "-n", help="Device name")
    parser.add_argument("--fps", "-f", type=int, default=2, choices=[1, 2, 3, 5], help="FPS")
    parser.add_argument("--quality", "-q", default="medium", choices=["low", "medium", "high"], help="Quality")
    parser.add_argument("--privacy", "-p", action="store_true", help="Privacy mode")
    args = parser.parse_args()

    if not args.token and not args.user_id:
        print("[ERROR] Either --token or --user-id is required")
        sys.exit(1)

    capture_methods = []
    if DXCAM_AVAILABLE:
        capture_methods.append("DXCam")
    if MSS_AVAILABLE:
        capture_methods.append("MSS")
    if REMOTE_CONTROL_AVAILABLE:
        capture_methods.append("pyautogui")

    print("=" * 50)
    print("  ULYSSE SCREEN MONITOR AGENT v2")
    print("=" * 50)
    print(f"  Server: {args.server}")
    print(f"  Device: {args.device_name or args.device_id}")
    print(f"  FPS: {args.fps}")
    print(f"  Quality: {args.quality}")
    print(f"  Privacy Mode: {'ON' if args.privacy else 'OFF'}")
    print(f"  Capture: {', '.join(capture_methods)} (auto-fallback)")
    print("=" * 50)
    print()

    agent = ScreenMonitorAgent(
        server_url=args.server,
        auth_token=args.token,
        user_id=args.user_id,
        device_id=args.device_id,
        device_name=args.device_name,
        fps=args.fps,
        quality=args.quality,
        privacy_mode=args.privacy
    )
    agent.run()

if __name__ == "__main__":
    main()
