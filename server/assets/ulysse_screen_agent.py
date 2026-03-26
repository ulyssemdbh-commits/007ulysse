#!/usr/bin/env python3
"""
Ulysse Screen Monitor Agent - Windows Desktop Companion
Captures screen in real-time and sends to Ulysse for analysis.

Requirements:
    pip install dxcam opencv-python pillow websocket-client pywin32 psutil

Usage:
    python ulysse_screen_agent.py --server wss://devflow-ai.replit.app/ws/screen --user-id 1
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
    import dxcam
    import cv2
    import numpy as np
    from PIL import Image
    import websocket
    import win32gui
    import win32process
    import psutil
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("\nInstall requirements with:")
    print("pip install dxcam opencv-python pillow websocket-client pywin32 psutil")
    sys.exit(1)

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
                return app_name, "[Contenu sensible masque]"
            return app_name, window_title[:100] if window_title else ""
        except Exception:
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
            elif msg_type == "error":
                print(f"[ERROR] Server error: {data.get('error')}")
        except json.JSONDecodeError:
            print("[WARN] Invalid message received")

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
                except:
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
        try:
            self.ws.run_forever(ping_interval=60, ping_timeout=30)
        except KeyboardInterrupt:
            print("\n[INFO] Stopping...")
            self.stop()

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
    
    print("=" * 50)
    print("  ULYSSE SCREEN MONITOR AGENT")
    print("=" * 50)
    print(f"  Server: {args.server}")
    print(f"  Device: {args.device_name or args.device_id}")
    print(f"  FPS: {args.fps}")
    print(f"  Quality: {args.quality}")
    print(f"  Privacy Mode: {'ON' if args.privacy else 'OFF'}")
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
