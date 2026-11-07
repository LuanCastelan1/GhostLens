#!/usr/bin/env python3
"""
GhostTunnel 4G Core Service — Servidor Cloud
Recebe conexões do celular 4G do usuário e roteia o tráfego do Android Redroid.
"""

import http.server
import socketserver
import json
import subprocess
import urllib.request
import threading
import os

TUNNEL_PORT = 9090
current_tunnel_status = {
    "connected": False,
    "ip": None,
    "isp": None,
    "city": None,
    "last_check": None
}

def get_current_outbound_ip():
    try:
        req = urllib.request.Request("https://ipinfo.io/json", headers={"User-Agent": "curl/7.68.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode())
            return {
                "ip": data.get("ip"),
                "isp": data.get("org", "Desconhecido"),
                "city": data.get("city", "Desconhecido"),
                "region": data.get("region", "")
            }
    except Exception as e:
        return {"ip": "Offline", "isp": str(e), "city": ""}

def set_android_proxy(host, port):
    if host and port:
        subprocess.run(["adb", "-s", "127.0.0.1:5555", "shell", "settings", "put", "global", "http_proxy", f"{host}:{port}"])
    else:
        subprocess.run(["adb", "-s", "127.0.0.1:5555", "shell", "settings", "put", "global", "http_proxy", ":0"])

class GhostTunnelHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/tunnel/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            info = get_current_outbound_ip()
            self.wfile.write(json.dumps({
                "code": 0,
                "status": "online",
                "tunnel_active": current_tunnel_status["connected"],
                "outbound": info
            }).encode())
            return
        
        if self.path == '/api/tunnel/reset_ip':
            set_android_proxy(None, None)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"code": 0, "status": "ip_reset_requested"}).encode())
            return

        super().do_GET()

    def do_POST(self):
        if self.path == '/api/tunnel/apply_proxy':
            content_len = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_len)
            data = json.loads(post_body.decode() or '{}')
            
            host = data.get('host')
            port = data.get('port')
            
            if host and port:
                set_android_proxy(host, port)
                current_tunnel_status["connected"] = True
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"code": 0, "status": "proxy_applied", "proxy": f"{host}:{port}"}).encode())
            else:
                set_android_proxy(None, None)
                current_tunnel_status["connected"] = False
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"code": 0, "status": "proxy_removed"}).encode())
            return

if __name__ == '__main__':
    print(f"🚀 GhostTunnel Core escutando na porta {TUNNEL_PORT}...")
    with socketserver.TCPServer(("", TUNNEL_PORT), GhostTunnelHandler) as httpd:
        httpd.serve_forever()

