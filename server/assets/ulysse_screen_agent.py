#!/usr/bin/env python3
"""
Ulysse Screen Monitor Agent - Windows Desktop Companion
Full remote control: screen capture, mouse, keyboard, app launch, file/URL open.

Requirements:
    pip install dxcam opencv-python pillow websocket-client pywin32 psutil pyautogui

Usage:
    python ulysse_screen_agent.py --server wss://ulyssepro.org/ws/screen --token YOUR_AUTH_TOKEN
"""

import argparse
import base64
import json
import time
import threading
import sys
import os
import subprocess
import platform
from io import BytesIO
from datetime import datetime

HAS_PYAUTOGUI = False
HAS_SCREEN = False

try:
    import websocket
except ImportError:
    print("Missing: websocket-client")
    print("pip install websocket-client")
    sys.exit(1)

try:
    import dxcam
    import cv2
    import numpy as np
    from PIL import Image
    import win32gui
    import win32process
    import psutil
    HAS_SCREEN = True
except ImportError as e:
    print(f"[WARN] Screen capture deps missing: {e}")
    print("pip install dxcam opencv-python pillow pywin32 psutil")

try:
    import pyautogui
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.05
    HAS_PYAUTOGUI = True
except ImportError:
    print("[WARN] pyautogui not installed — remote control disabled")
    print("pip install pyautogui")


class RemoteControlHandler:
    """Handles all remote control commands from Ulysse server."""

    def __init__(self, agent):
        self.agent = agent
        self.enabled = False

    def handle_message(self, data):
        msg_type = data.get("type", "")

        if msg_type == "remote_control.enable":
            self.enabled = True
            print("[RC] Remote control ENABLED")
            self.send_status(True)
            return True

        if msg_type == "remote_control.disable":
            self.enabled = False
            print("[RC] Remote control DISABLED")
            self.send_status(False)
            return True

        if msg_type == "remote_control.cmd":
            return self.execute_command(data)

        return False

    def send_status(self, enabled):
        if self.agent.ws:
            try:
                self.agent.ws.send(json.dumps({
                    "type": "remote_control.status",
                    "enabled": enabled,
                    "timestamp": int(time.time() * 1000)
                }))
            except:
                pass

    def send_result(self, cmd, success, msg=""):
        if self.agent.ws:
            try:
                self.agent.ws.send(json.dumps({
                    "type": "remote_control.result",
                    "cmd": cmd,
                    "success": success,
                    "msg": msg,
                    "timestamp": int(time.time() * 1000)
                }))
            except:
                pass

    def execute_command(self, data):
        cmd = data.get("cmd", "")

        if cmd == "screenshot":
            self._cmd_screenshot()
            return True

        if not self.enabled:
            self.send_result(cmd, False, "Remote control not enabled")
            return True

        if not HAS_PYAUTOGUI and cmd not in ("screenshot", "open_folder", "open_app", "run_command"):
            self.send_result(cmd, False, "pyautogui not installed")
            return True

        try:
            handler = {
                "mouse_move": self._cmd_mouse_move,
                "click": self._cmd_click,
                "double_click": self._cmd_double_click,
                "right_click": self._cmd_right_click,
                "scroll": self._cmd_scroll,
                "key_press": self._cmd_key_press,
                "type_text": self._cmd_type_text,
                "open_url": self._cmd_open_url,
                "open_folder": self._cmd_open_folder,
                "open_app": self._cmd_open_app,
                "run_command": self._cmd_run_command,
            }.get(cmd)

            if handler:
                handler(data)
            else:
                self.send_result(cmd, False, f"Unknown command: {cmd}")
        except Exception as e:
            print(f"[RC][ERROR] {cmd}: {e}")
            self.send_result(cmd, False, str(e))

        return True

    def _cmd_screenshot(self):
        img = self.agent.capture_screen()
        if img:
            app_name, window_title = "", ""
            if HAS_SCREEN:
                app_name, window_title = self.agent.get_active_window_info()
            if self.agent.ws:
                self.agent.ws.send(json.dumps({
                    "type": "frame",
                    "frame": {
                        "imageBase64": img,
                        "activeApp": app_name,
                        "activeWindow": window_title,
                        "timestamp": int(time.time() * 1000)
                    }
                }))
            self.send_result("screenshot", True)
        else:
            self.send_result("screenshot", False, "Capture failed")

    def _cmd_mouse_move(self, data):
        x, y = int(data.get("x", 0)), int(data.get("y", 0))
        pyautogui.moveTo(x, y, duration=0.2)
        self.send_result("mouse_move", True, f"Moved to ({x}, {y})")

    def _cmd_click(self, data):
        x = data.get("x")
        y = data.get("y")
        button = data.get("button", "left")
        clicks = data.get("clicks", 1)
        if x is not None and y is not None:
            pyautogui.click(int(x), int(y), button=button, clicks=int(clicks))
        else:
            pyautogui.click(button=button, clicks=int(clicks))
        self.send_result("click", True, f"Click at ({x}, {y})")

    def _cmd_double_click(self, data):
        x = data.get("x")
        y = data.get("y")
        if x is not None and y is not None:
            pyautogui.doubleClick(int(x), int(y))
        else:
            pyautogui.doubleClick()
        self.send_result("double_click", True, f"Double click at ({x}, {y})")

    def _cmd_right_click(self, data):
        x = data.get("x")
        y = data.get("y")
        if x is not None and y is not None:
            pyautogui.rightClick(int(x), int(y))
        else:
            pyautogui.rightClick()
        self.send_result("right_click", True, f"Right click at ({x}, {y})")

    def _cmd_scroll(self, data):
        x = data.get("x")
        y = data.get("y")
        dy = int(data.get("dy", 3))
        if x is not None and y is not None:
            pyautogui.moveTo(int(x), int(y))
        pyautogui.scroll(-dy)
        self.send_result("scroll", True, f"Scroll dy={dy}")

    def _cmd_key_press(self, data):
        key = data.get("key", "")
        if not key:
            self.send_result("key_press", False, "No key specified")
            return

        if "+" in key and len(key) > 1:
            parts = [k.strip().lower() for k in key.split("+")]
            key_map = {
                "ctrl": "ctrl", "control": "ctrl",
                "alt": "alt", "shift": "shift",
                "win": "win", "windows": "win", "super": "win",
                "cmd": "win", "command": "win",
                "enter": "enter", "return": "enter",
                "esc": "escape", "escape": "escape",
                "tab": "tab", "space": "space",
                "backspace": "backspace", "delete": "delete",
                "up": "up", "down": "down", "left": "left", "right": "right",
                "home": "home", "end": "end",
                "pageup": "pageup", "pagedown": "pagedown",
                "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
                "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
                "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
            }
            mapped = [key_map.get(p, p) for p in parts]
            pyautogui.hotkey(*mapped)
        else:
            key_map_single = {
                "enter": "enter", "return": "enter",
                "esc": "escape", "escape": "escape",
                "tab": "tab", "space": "space",
                "backspace": "backspace", "delete": "delete",
                "up": "up", "down": "down", "left": "left", "right": "right",
                "win": "win", "windows": "win",
            }
            mapped_key = key_map_single.get(key.lower(), key)
            pyautogui.press(mapped_key)

        self.send_result("key_press", True, f"Key: {key}")

    def _cmd_type_text(self, data):
        text = data.get("text", "")
        if not text:
            self.send_result("type_text", False, "No text specified")
            return
        pyautogui.typewrite(text, interval=0.02) if text.isascii() else self._type_unicode(text)
        self.send_result("type_text", True, f"Typed {len(text)} chars")

    def _type_unicode(self, text):
        import ctypes
        for char in text:
            if char == '\n':
                pyautogui.press('enter')
            elif char == '\t':
                pyautogui.press('tab')
            else:
                try:
                    vk = ctypes.windll.user32.VkKeyScanW(ord(char))
                    if vk == -1:
                        ctypes.windll.user32.keybd_event(0, 0, 0, 0)
                        hwnd = ctypes.windll.user32.GetForegroundWindow()
                        ctypes.windll.user32.SendMessageW(hwnd, 0x0102, ord(char), 0)
                    else:
                        shift = (vk >> 8) & 1
                        actual_vk = vk & 0xFF
                        if shift:
                            ctypes.windll.user32.keybd_event(0x10, 0, 0, 0)
                        ctypes.windll.user32.keybd_event(actual_vk, 0, 0, 0)
                        ctypes.windll.user32.keybd_event(actual_vk, 0, 2, 0)
                        if shift:
                            ctypes.windll.user32.keybd_event(0x10, 0, 2, 0)
                except:
                    pass
            time.sleep(0.01)

    def _cmd_open_url(self, data):
        url = data.get("text") or data.get("url", "")
        if not url:
            self.send_result("open_url", False, "No URL specified")
            return
        # Force new window: try Chromium-family browsers with --new-window, then Firefox, then fallback.
        browsers = [
            ("chrome", ["chrome", "--new-window", url]),
            ("msedge", ["msedge", "--new-window", url]),
            ("brave",  ["brave", "--new-window", url]),
            ("firefox",["firefox", "-new-window", url]),
        ]
        for name, cmd in browsers:
            try:
                subprocess.Popen(cmd, shell=False)
                self.send_result("open_url", True, f"Opened in new window ({name}): {url}")
                return
            except Exception:
                continue
        # Fallback: default handler (may reuse existing window)
        try:
            os.startfile(url)
            self.send_result("open_url", True, f"Opened (default handler): {url}")
        except Exception as e:
            try:
                subprocess.Popen(["start", "", url], shell=True)
                self.send_result("open_url", True, f"Opened via start: {url}")
            except Exception as e2:
                self.send_result("open_url", False, str(e2))

    def _cmd_open_folder(self, data):
        path = data.get("path") or data.get("text", "")
        if not path:
            self.send_result("open_folder", False, "No path specified")
            return
        path = os.path.expandvars(os.path.expanduser(path))
        if not os.path.exists(path):
            self.send_result("open_folder", False, f"Path not found: {path}")
            return
        # Force new Explorer window with /n flag
        try:
            subprocess.Popen(["explorer", "/n,", path], shell=False)
            self.send_result("open_folder", True, f"Opened in new window: {path}")
            return
        except Exception:
            pass
        try:
            os.startfile(path)
            self.send_result("open_folder", True, f"Opened: {path}")
        except Exception as e:
            self.send_result("open_folder", False, str(e))

    def _cmd_open_app(self, data):
        app = data.get("app") or data.get("text", "")
        if not app:
            self.send_result("open_app", False, "No app specified")
            return

        app_aliases = {
            "word": "winword",
            "excel": "excel",
            "powerpoint": "powerpnt",
            "ppt": "powerpnt",
            "outlook": "outlook",
            "notepad": "notepad",
            "bloc-notes": "notepad",
            "paint": "mspaint",
            "calculatrice": "calc",
            "calculator": "calc",
            "calc": "calc",
            "explorer": "explorer",
            "explorateur": "explorer",
            "cmd": "cmd",
            "terminal": "wt",
            "powershell": "powershell",
            "chrome": "chrome",
            "firefox": "firefox",
            "edge": "msedge",
            "code": "code",
            "vscode": "code",
            "teams": "ms-teams",
            "spotify": "spotify",
            "discord": "discord",
            "slack": "slack",
            "notion": "notion",
        }

        resolved = app_aliases.get(app.lower().strip(), app)

        try:
            if os.path.exists(resolved):
                os.startfile(resolved)
            else:
                subprocess.Popen(resolved, shell=True)
            self.send_result("open_app", True, f"Launched: {resolved}")
        except FileNotFoundError:
            try:
                subprocess.Popen(f"start {resolved}", shell=True)
                self.send_result("open_app", True, f"Launched via start: {resolved}")
            except Exception as e2:
                self.send_result("open_app", False, f"Not found: {resolved} — {e2}")
        except Exception as e:
            self.send_result("open_app", False, str(e))

    def _cmd_run_command(self, data):
        command = data.get("command") or data.get("text", "")
        if not command:
            self.send_result("run_command", False, "No command specified")
            return
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=30
            )
            output = result.stdout[:2000] if result.stdout else ""
            error = result.stderr[:500] if result.stderr else ""
            self.send_result("run_command", True, f"Exit {result.returncode}. Output: {output}{(' Error: ' + error) if error else ''}")
        except subprocess.TimeoutExpired:
            self.send_result("run_command", False, "Command timed out (30s)")
        except Exception as e:
            self.send_result("run_command", False, str(e))


class ScreenMonitorAgent:
    def __init__(self, server_url: str, auth_token: str = None, user_id: int = None, 
                 device_id: str = "windows-agent", device_name: str = None,
                 fps: int = 2, quality: str = "medium", privacy_mode: bool = False):
        self.server_url = server_url
        self.auth_token = auth_token
        self.user_id = user_id
        self.device_id = device_id
        self.device_name = device_name or os.environ.get("COMPUTERNAME", "Windows PC")
        self.fps = fps
        self.quality = quality
        self.privacy_mode = privacy_mode
        
        self.ws = None
        self.camera = None
        self.running = False
        self.paused = False
        self.connected = False
        self.authenticated = False
        self.last_activity = time.time()
        self.inactivity_timeout = 120
        
        self.rc = RemoteControlHandler(self)
        
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
            except:
                app_name = "Unknown"
            
            if self.should_filter_window(window_title, app_name):
                return app_name, "[Contenu sensible masqué]"
            
            return app_name, window_title[:100] if window_title else ""
        except:
            return "Unknown", ""

    def should_filter_window(self, title: str, app_name: str) -> bool:
        if self.privacy_mode:
            return True
        combined = f"{title} {app_name}".lower()
        for keyword in self.privacy_keywords:
            if keyword in combined:
                return True
        return False

    def capture_screen(self):
        try:
            if not HAS_SCREEN:
                if HAS_PYAUTOGUI:
                    screenshot = pyautogui.screenshot()
                    settings = self.quality_settings.get(self.quality, self.quality_settings["medium"])
                    screenshot = screenshot.resize(settings["resolution"], Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS)
                    buffer = BytesIO()
                    screenshot.save(buffer, format="JPEG", quality=settings["jpeg_quality"])
                    return base64.b64encode(buffer.getvalue()).decode("utf-8")
                return None

            if not self.camera:
                self.camera = dxcam.create(output_idx=0)
                self.camera.start(target_fps=self.fps)
            
            frame = self.camera.get_latest_frame()
            if frame is None:
                return None
            
            pil_img = Image.fromarray(frame)
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
            
            if msg_type.startswith("remote_control"):
                self.rc.handle_message(data)
                return
            
            if msg_type == "connected":
                print("[INFO] Connected to server, authenticating...")
                self.send_auth()
                
            elif msg_type == "auth.success":
                self.authenticated = True
                print(f"[INFO] Authenticated as user {data.get('userId')}")
                self.send_capability()
                self.start_monitoring()
                
            elif msg_type == "auth.failed":
                print(f"[ERROR] Authentication failed: {data.get('error')}")
                self.stop()
                
            elif msg_type == "session.started":
                print(f"[INFO] Session started (ID: {data.get('sessionId')})")
                
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
                        print(f"  -> {s}")
                        
            elif msg_type == "frame.received":
                pass
            elif msg_type == "pong":
                pass
            elif msg_type == "error":
                print(f"[ERROR] Server: {data.get('error')}")
                
        except json.JSONDecodeError:
            print("[WARN] Invalid message received")

    def on_error(self, ws, error):
        print(f"[ERROR] WebSocket: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        self.connected = False
        self.authenticated = False
        self.rc.enabled = False
        print(f"[INFO] Connection closed: {close_msg or 'Unknown'}")

    def on_open(self, ws):
        self.connected = True
        print("[INFO] WebSocket connected")

    def send_auth(self):
        if self.ws:
            auth_msg = {
                "type": "auth",
                "deviceId": self.device_id,
                "deviceName": self.device_name
            }
            if self.auth_token:
                auth_msg["token"] = self.auth_token
            if self.user_id:
                auth_msg["userId"] = self.user_id
            self.ws.send(json.dumps(auth_msg))

    def send_capability(self):
        if self.ws:
            self.ws.send(json.dumps({
                "type": "capability",
                "remoteControl": HAS_PYAUTOGUI,
                "platform": platform.system(),
                "version": "2.0.0",
                "features": {
                    "screenshot": True,
                    "mouse": HAS_PYAUTOGUI,
                    "keyboard": HAS_PYAUTOGUI,
                    "open_url": True,
                    "open_folder": True,
                    "open_app": True,
                    "run_command": True,
                    "type_unicode": True,
                }
            }))
            caps = "FULL" if HAS_PYAUTOGUI else "SCREEN-ONLY"
            print(f"[INFO] Capabilities sent: {caps}")

    def start_monitoring(self):
        if self.ws and self.authenticated:
            self.ws.send(json.dumps({
                "type": "control",
                "action": "start"
            }))

    def send_frame(self):
        if not self.authenticated or self.paused:
            return
        
        app_name, window_title = "", ""
        if HAS_SCREEN:
            app_name, window_title = self.get_active_window_info()
        img_base64 = self.capture_screen()
        
        if img_base64 and self.ws:
            try:
                self.ws.send(json.dumps({
                    "type": "frame",
                    "frame": {
                        "imageBase64": img_base64,
                        "activeApp": app_name,
                        "activeWindow": window_title,
                        "timestamp": int(time.time() * 1000)
                    }
                }))
                self.last_activity = time.time()
            except Exception as e:
                print(f"[ERROR] Failed to send frame: {e}")

    def capture_loop(self):
        interval = 1.0 / self.fps
        print(f"[INFO] Capture loop at {self.fps} FPS")
        
        while self.running:
            if self.connected and self.authenticated and not self.paused:
                self.send_frame()
            time.sleep(interval)

    def heartbeat_loop(self):
        while self.running:
            if self.ws and self.connected:
                try:
                    self.ws.send(json.dumps({"type": "ping"}))
                except:
                    pass
            time.sleep(30)

    def reconnect_loop(self):
        while self.running:
            time.sleep(10)
            if not self.connected and self.running:
                print("[INFO] Attempting reconnect...")
                try:
                    self.connect()
                    self.ws.run_forever(ping_interval=60, ping_timeout=30, reconnect=5)
                except:
                    print("[WARN] Reconnect failed, retrying in 10s...")

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
                print(f"[ERROR] Connection lost: {e}")

            if self.running:
                print("[INFO] Reconnecting in 5s...")
                time.sleep(5)
                self.connect()

    def stop(self):
        self.running = False
        if self.ws:
            if self.authenticated:
                try:
                    self.ws.send(json.dumps({"type": "control", "action": "stop"}))
                    time.sleep(0.5)
                except:
                    pass
            self.ws.close()
        if self.camera:
            try:
                self.camera.stop()
            except:
                pass
        print("[INFO] Agent stopped")


AUTOSTART_CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".ulysse_agent_config.json")

def get_startup_folder():
    return os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")

def get_autostart_config():
    try:
        if os.path.exists(AUTOSTART_CONFIG_FILE):
            with open(AUTOSTART_CONFIG_FILE, "r") as f:
                return json.load(f)
    except:
        pass
    return None

def save_autostart_config(server, token=None, user_id=None, device_id="windows-agent", device_name=None, fps=2, quality="medium", privacy=False):
    config = {
        "server": server,
        "token": token,
        "user_id": user_id,
        "device_id": device_id,
        "device_name": device_name,
        "fps": fps,
        "quality": quality,
        "privacy": privacy,
        "enabled": True,
        "agent_path": os.path.abspath(__file__),
    }
    with open(AUTOSTART_CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    return config

def enable_autostart(server, token=None, user_id=None, device_id="windows-agent", device_name=None, fps=2, quality="medium", privacy=False):
    config = save_autostart_config(server, token, user_id, device_id, device_name, fps, quality, privacy)
    agent_path = config["agent_path"]
    startup_folder = get_startup_folder()
    bat_path = os.path.join(startup_folder, "ulysse_screen_agent.bat")

    cmd_parts = [f'python "{agent_path}"', f'--server "{server}"']
    if token:
        cmd_parts.append(f'--token "{token}"')
    if user_id:
        cmd_parts.append(f'--user-id {user_id}')
    if device_id != "windows-agent":
        cmd_parts.append(f'--device-id "{device_id}"')
    if device_name:
        cmd_parts.append(f'--device-name "{device_name}"')
    if fps != 2:
        cmd_parts.append(f'--fps {fps}')
    if quality != "medium":
        cmd_parts.append(f'--quality {quality}')
    if privacy:
        cmd_parts.append('--privacy')

    bat_content = f'@echo off\ntitle Ulysse Screen Agent\n{" ".join(cmd_parts)}\n'
    with open(bat_path, "w") as f:
        f.write(bat_content)

    print(f"[AUTOSTART] Enabled — starts with Windows")
    print(f"[AUTOSTART] Script: {bat_path}")
    print(f"[AUTOSTART] Config: {AUTOSTART_CONFIG_FILE}")
    return True

def disable_autostart():
    startup_folder = get_startup_folder()
    bat_path = os.path.join(startup_folder, "ulysse_screen_agent.bat")
    removed = False
    if os.path.exists(bat_path):
        os.remove(bat_path)
        removed = True
    if os.path.exists(AUTOSTART_CONFIG_FILE):
        try:
            config = get_autostart_config()
            if config:
                config["enabled"] = False
                with open(AUTOSTART_CONFIG_FILE, "w") as f:
                    json.dump(config, f, indent=2)
        except:
            pass
    if removed:
        print("[AUTOSTART] Disabled")
    else:
        print("[AUTOSTART] Was not enabled")
    return removed

def autostart_status():
    startup_folder = get_startup_folder()
    bat_path = os.path.join(startup_folder, "ulysse_screen_agent.bat")
    config = get_autostart_config()
    bat_exists = os.path.exists(bat_path)
    return {
        "enabled": bat_exists,
        "config": config,
        "startup_script": bat_path if bat_exists else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Ulysse Screen Monitor Agent v2.0")
    parser.add_argument("--server", "-s",
                        help="WebSocket server URL (e.g., wss://ulyssepro.org/ws/screen)")
    parser.add_argument("--token", "-t", 
                        help="Authentication token (JWT)")
    parser.add_argument("--user-id", "-u", type=int,
                        help="User ID (alternative to token)")
    parser.add_argument("--device-id", "-d", default="windows-agent",
                        help="Unique device identifier")
    parser.add_argument("--device-name", "-n",
                        help="Human-readable device name")
    parser.add_argument("--fps", "-f", type=int, default=2, choices=[1, 2, 3, 5],
                        help="Frames per second (default: 2)")
    parser.add_argument("--quality", "-q", default="medium", choices=["low", "medium", "high"],
                        help="Image quality (default: medium)")
    parser.add_argument("--privacy", "-p", action="store_true",
                        help="Enable privacy mode (blur all window titles)")
    parser.add_argument("--autostart", choices=["enable", "disable", "status"],
                        help="Manage Windows autostart (enable/disable/status)")
    
    args = parser.parse_args()

    if args.autostart:
        if args.autostart == "enable":
            if not args.server:
                print("[ERROR] --server is required to enable autostart")
                sys.exit(1)
            if not args.token and not args.user_id:
                print("[ERROR] --token or --user-id is required to enable autostart")
                sys.exit(1)
            enable_autostart(args.server, args.token, args.user_id, args.device_id, args.device_name, args.fps, args.quality, args.privacy)
        elif args.autostart == "disable":
            disable_autostart()
        elif args.autostart == "status":
            status = autostart_status()
            print(f"[AUTOSTART] Enabled: {status['enabled']}")
            if status['config']:
                print(f"[AUTOSTART] Server: {status['config'].get('server', '?')}")
            if status['startup_script']:
                print(f"[AUTOSTART] Script: {status['startup_script']}")
        return

    if not args.server:
        print("[ERROR] --server is required")
        sys.exit(1)
    
    if not args.token and not args.user_id:
        print("[ERROR] Either --token or --user-id is required")
        sys.exit(1)
    
    print("=" * 55)
    print("  ULYSSE SCREEN MONITOR AGENT v2.0")
    print("  Full Remote Control Edition")
    print("=" * 55)
    print(f"  Server    : {args.server}")
    print(f"  Device    : {args.device_name or args.device_id}")
    print(f"  FPS       : {args.fps}")
    print(f"  Quality   : {args.quality}")
    print(f"  Privacy   : {'ON' if args.privacy else 'OFF'}")
    print(f"  Screen    : {'dxcam' if HAS_SCREEN else ('pyautogui' if HAS_PYAUTOGUI else 'NONE')}")
    print(f"  Mouse/KB  : {'YES' if HAS_PYAUTOGUI else 'NO (install pyautogui)'}")
    print(f"  Apps/URLs : YES")
    status = autostart_status()
    print(f"  Autostart : {'ON' if status['enabled'] else 'OFF'}")
    print("=" * 55)
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
