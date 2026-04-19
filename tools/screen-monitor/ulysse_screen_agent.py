#!/usr/bin/env python3
"""
Ulysse Screen Monitor Agent - Windows Desktop Companion
Captures screen in real-time and sends to Ulysse for analysis.

Requirements:
    pip install dxcam opencv-python pillow websocket-client pywin32

Usage:
    python ulysse_screen_agent.py --server wss://your-app.replit.app/ws/screen --token YOUR_AUTH_TOKEN
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
        """Get information about the currently active window."""
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
        except Exception as e:
            return "Unknown", ""

    def should_filter_window(self, title: str, app_name: str) -> bool:
        """Check if window content should be filtered for privacy."""
        if self.privacy_mode:
            return True
        
        combined = f"{title} {app_name}".lower()
        for keyword in self.privacy_keywords:
            if keyword in combined:
                return True
        return False

    def capture_screen(self):
        """Capture the current screen."""
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
            img_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
            
            return img_base64
        except Exception as e:
            print(f"[ERROR] Capture failed: {e}")
            return None

    def on_message(self, ws, message):
        """Handle incoming WebSocket messages."""
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            
            if msg_type == "connected":
                print(f"[INFO] Connected to server, authenticating...")
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
                        
            elif msg_type == "frame.received":
                pass
                
            elif msg_type == "pong":
                pass
                
            elif msg_type == "error":
                print(f"[ERROR] Server error: {data.get('error')}")
                
        except json.JSONDecodeError:
            print(f"[WARN] Invalid message received")

    def on_error(self, ws, error):
        """Handle WebSocket errors."""
        print(f"[ERROR] WebSocket error: {error}")

    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket close."""
        self.connected = False
        self.authenticated = False
        print(f"[INFO] Connection closed: {close_msg or 'Unknown reason'}")

    def on_open(self, ws):
        """Handle WebSocket open."""
        self.connected = True
        print("[INFO] WebSocket connection established")

    def send_auth(self):
        """Send authentication message."""
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

    def start_monitoring(self):
        """Start the monitoring session."""
        if self.ws and self.authenticated:
            self.ws.send(json.dumps({
                "type": "control",
                "action": "start"
            }))

    def send_frame(self):
        """Capture and send a single frame."""
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
        """Main capture loop."""
        interval = 1.0 / self.fps
        print(f"[INFO] Starting capture loop at {self.fps} FPS")
        
        while self.running:
            if self.connected and self.authenticated and not self.paused:
                self.send_frame()
            time.sleep(interval)

    def heartbeat_loop(self):
        """Send periodic heartbeats."""
        while self.running:
            if self.ws and self.connected:
                try:
                    self.ws.send(json.dumps({"type": "ping"}))
                except:
                    pass
            time.sleep(30)

    def connect(self):
        """Connect to the WebSocket server."""
        websocket.enableTrace(False)
        self.ws = websocket.WebSocketApp(
            self.server_url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )

    def run(self):
        """Start the agent."""
        self.running = True
        self.connect()
        
        capture_thread = threading.Thread(target=self.capture_loop, daemon=True)
        heartbeat_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        
        capture_thread.start()
        heartbeat_thread.start()
        
        print(f"[INFO] Connecting to {self.server_url}...")
        print("[INFO] Press Ctrl+C to stop")
        
        try:
            self.ws.run_forever(ping_interval=60, ping_timeout=30)
        except KeyboardInterrupt:
            print("\n[INFO] Stopping...")
            self.stop()

    def stop(self):
        """Stop the agent."""
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


<<<<<<< HEAD
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

    print(f"[AUTOSTART] Enabled - agent will start automatically with Windows")
    print(f"[AUTOSTART] Startup script: {bat_path}")
    print(f"[AUTOSTART] Config saved: {AUTOSTART_CONFIG_FILE}")
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
        print("[AUTOSTART] Disabled - agent will no longer start with Windows")
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
    parser = argparse.ArgumentParser(description="Ulysse Screen Monitor Agent")
    parser.add_argument("--server", "-s",
=======
def main():
    parser = argparse.ArgumentParser(description="Ulysse Screen Monitor Agent")
    parser.add_argument("--server", "-s", required=True, 
>>>>>>> 4c2530ad (Ulysse full sync - complete codebase)
                        help="WebSocket server URL (e.g., wss://your-app.replit.app/ws/screen)")
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
<<<<<<< HEAD
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
=======
    
    args = parser.parse_args()
>>>>>>> 4c2530ad (Ulysse full sync - complete codebase)
    
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
<<<<<<< HEAD
    status = autostart_status()
    print(f"  Autostart: {'ON' if status['enabled'] else 'OFF'}")
=======
>>>>>>> 4c2530ad (Ulysse full sync - complete codebase)
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
