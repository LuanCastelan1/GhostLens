#!/usr/bin/env python3
"""
🛡️ GHOSTLENS LOCAL BRIDGE DAEMON 2.0 (GHOSTSTEALTH NATIVE API)
Permite controle completo dos perfis antidetect isolados pelo ghostlens_studio.html
ou via chamadas REST padronizadas (/api/env/list, /api/env/start, /api/env/stop).
"""
import os
import sys
import json
import signal
import urllib.parse
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 4444
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EROS_DIR = os.path.dirname(BASE_DIR)
PERFIS_DIR = os.path.join(EROS_DIR, "perfis_antidetect")

os.makedirs(PERFIS_DIR, exist_ok=True)

import time
import base64
import shutil
import mimetypes
import io
import threading
import PIL.Image

try:
    from ghostphone_auth_guard import auth_guard
except ImportError:
    sys.path.append(BASE_DIR)
    from ghostphone_auth_guard import auth_guard

ADB_BIN = "/opt/homebrew/bin/adb"

LATEST_FRAME = None
FRAME_LOCK = threading.Lock()
FRAME_LAST_TIME = 0

def screencap_background_worker():
    global LATEST_FRAME, FRAME_LAST_TIME
    while True:
        try:
            # Se scrcpy estiver rodando, reduz frequência para liberar 100% de banda de hardware
            scrcpy_check = subprocess.run(['pgrep', '-f', 'scrcpy'], capture_output=True).stdout
            if scrcpy_check:
                time.sleep(1.0)
                continue

            res = subprocess.run([ADB_BIN, 'exec-out', 'screencap', '-p'], capture_output=True, timeout=2)
            if res.returncode == 0 and res.stdout:
                im = PIL.Image.open(io.BytesIO(res.stdout)).convert('RGB')
                im = im.resize((540, 1200), PIL.Image.Resampling.BILINEAR)
                buf = io.BytesIO()
                im.save(buf, format='JPEG', quality=75)
                data = buf.getvalue()
                with FRAME_LOCK:
                    LATEST_FRAME = data
                    FRAME_LAST_TIME = time.time()
        except Exception:
            pass
        time.sleep(0.08)

# Inicia sentinela de captura de tela contínua em segundo plano
threading.Thread(target=screencap_background_worker, daemon=True).start()

def run_adb_async(args):
    """Executa comandos ADB em segundo plano sem travar o servidor HTTP."""
    try:
        subprocess.Popen([ADB_BIN] + args)
    except Exception:
        pass

def get_fast_screencap():
    global LATEST_FRAME
    with FRAME_LOCK:
        if LATEST_FRAME:
            return LATEST_FRAME
    # Se ainda não houver frame, faz captura síncrona inicial
    try:
        res = subprocess.run([ADB_BIN, 'exec-out', 'screencap', '-p'], capture_output=True, timeout=3)
        if res.returncode == 0 and res.stdout:
            im = PIL.Image.open(io.BytesIO(res.stdout)).convert('RGB')
            im = im.resize((540, 1200), PIL.Image.Resampling.BILINEAR)
            buf = io.BytesIO()
            im.save(buf, format='JPEG', quality=75)
            data = buf.getvalue()
            with FRAME_LOCK:
                LATEST_FRAME = data
                FRAME_LAST_TIME = time.time()
            return data
    except Exception:
        pass
    return LATEST_FRAME

def run_adb(args):
    try:
        res = subprocess.run([ADB_BIN] + args, capture_output=True, text=True, timeout=10)
        return res.stdout.strip()
    except Exception:
        return ""


def is_pid_running(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False

def get_profile_status(profile_name):
    pid_file = os.path.join(PERFIS_DIR, profile_name, "chrome.pid")
    if os.path.exists(pid_file):
        try:
            with open(pid_file, "r") as f:
                pid = int(f.read().strip())
            if is_pid_running(pid):
                return "Active", pid
        except Exception:
            pass
    return "Stopped", None

def list_profiles():
    profiles = []
    if os.path.exists(PERFIS_DIR):
        for name in sorted(os.listdir(PERFIS_DIR)):
            p_dir = os.path.join(PERFIS_DIR, name)
            if os.path.isdir(p_dir) and not name.startswith('.'):
                status, pid = get_profile_status(name)
                ext_exists = os.path.exists(os.path.join(p_dir, "ghost_stealth_extension"))
                profiles.append({
                    "id": name,
                    "name": name.capitalize(),
                    "status": status,
                    "pid": pid,
                    "stealth_engine": "Manifest V3 (Apple GPU / Canvas / WebRTC Kill)" if ext_exists else "Standard",
                    "path": p_dir
                })
    return profiles

class GhostBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Log simplificado no terminal
        sys.stdout.write(f"[GhostBridge] {self.command} {self.path}\n")
        sys.stdout.flush()

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, data, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def parse_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                return json.loads(body)
            except Exception:
                return urllib.parse.parse_qs(body)
        return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        # AUTH STATUS
        if parsed.path == '/api/auth/status':
            self.send_json({"code": 0, "auth": auth_guard.get_status()})
            return

        # LIST ISSUED LICENSES (ADMIN MASTER)
        if parsed.path == '/api/auth/issued_licenses':
            self.send_json({"code": 0, "licenses": auth_guard.get_issued_licenses()})
            return

        # LAUNCH SCRCPY NATIVE VIA GET (TELA SOLTA)
        if parsed.path == '/api/phone/launch_native':
            musa = params.get('musa', ['Leninha'])[0]
            pkg = params.get('package', ['com.instagram.android'])[0]
            if pkg:
                run_adb_async(['shell', 'monkey', '-p', pkg, '1'])

            scrcpy_pids = subprocess.run(['pgrep', '-f', 'scrcpy'], capture_output=True).stdout.decode().split()
            if not scrcpy_pids:
                scrcpy_bin = '/opt/homebrew/bin/scrcpy' if os.path.exists('/opt/homebrew/bin/scrcpy') else 'scrcpy'
                cmd = [
                    scrcpy_bin,
                    '-s', 'emulator-5554',
                    '--window-title', f'GhostPhone™ • {musa}',
                    '--always-on-top',
                    '--stay-awake',
                    '--window-width', '440'
                ]
                subprocess.Popen(cmd)

            self.send_json({"code": 0, "status": "native_window_launched", "musa": musa})
            return

        # 1. STATUS
        if parsed.path == '/status':
            self.send_json({
                "code": 0,
                "status": "online",
                "engine": "GhostLens Stealth 2.0 (GhostStealth Engine 2.0)",
                "port": PORT,
                "profiles_count": len(list_profiles()),
                "auth": auth_guard.get_status()
            })

        # GUARDA DE SEGURANÇA ANTIPIRATARIA (GHOSTPHONE HWID LOCK)
        elif parsed.path.startswith('/api/phone/') and not auth_guard.is_active:
            self.send_json({
                "code": 403,
                "error": "🔒 ACESSO BLOQUEADO: Máquina não autorizada ou assinatura pendente.",
                "hwid": auth_guard.hwid,
                "status": "unauthorized"
            }, code=403)
            return

        # GHOSTPHONE CLOUD ANDROID STFXM PLAYER
        elif parsed.path in ('/ghostphone', '/player'):
            player_path = os.path.join(BASE_DIR, 'ghostphone_player.html')
            if os.path.exists(player_path):
                with open(player_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return
            else:
                self.send_json({"error": "Player não encontrado"}, code=404)
                return

        # GHOSTLENS STUDIO WEB INTERFACE
        elif parsed.path in ('/', '/studio', '/ghostlens', '/ghostlens_studio.html'):
            studio_path = os.path.join(BASE_DIR, 'ghostlens_studio.html')
            if os.path.exists(studio_path):
                with open(studio_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return
            else:
                self.send_json({"error": "GhostLens Studio não encontrado"}, code=404)
                return

        # 2. LIST PROFILES (/api/env/list ou /profiles)
        elif parsed.path in ('/api/env/list', '/profiles'):
            profs = list_profiles()
            self.send_json({
                "code": 0,
                "data": {
                    "total": len(profs),
                    "list": profs
                }
            })

        # 3. LAUNCH INSTANCE (/launch ou /api/env/start)
        elif parsed.path in ('/launch', '/api/env/start'):
            musa = params.get('musa', params.get('envId', ['luana']))[0]
            proxy = params.get('proxy', [''])[0]
            device = params.get('device', ['iphone16promax'])[0]
            ios = params.get('ios', ['18_2'])[0]
            app = params.get('app', ['instagram'])[0]
            default_url = 'https://www.tiktok.com/' if app == 'tiktok' else 'https://www.instagram.com/'
            target_url = params.get('url', [default_url])[0]

            script_path = os.path.join(BASE_DIR, 'launch_isolated_musa.sh')
            subprocess.Popen(['bash', script_path, musa, proxy, device, ios, '', target_url])

            self.send_json({
                "code": 0,
                "status": "ok",
                "launched": True,
                "musa": musa,
                "device": device,
                "app": app,
                "url": target_url
            })

        # 4. STOP INSTANCE (/stop ou /api/env/stop)
        elif parsed.path in ('/stop', '/api/env/stop'):
            musa = params.get('musa', params.get('envId', ['']))[0]
            stopped = False
            if musa:
                status, pid = get_profile_status(musa)
                if pid:
                    try:
                        os.kill(pid, signal.SIGTERM)
                        stopped = True
                    except Exception:
                        pass

            self.send_json({
                "code": 0,
                "status": "stopped" if stopped else "not_running",
                "musa": musa
            })

        # 5. GHOSTPHONE API: DEVICES
        elif parsed.path == '/api/phone/devices':
            out = run_adb(['devices', '-l'])
            devs = []
            for line in out.splitlines()[1:]:
                line = line.strip()
                if line and not line.startswith('*'):
                    parts = line.split()
                    devs.append({"id": parts[0], "status": parts[1] if len(parts) > 1 else "device", "info": line})
            self.send_json({
                "code": 0,
                "devices": devs,
                "count": len(devs),
                "current": devs[0]["id"] if devs else None,
                "adb_bin": ADB_BIN
            })

        # 6. GHOSTPHONE API: SCREENCAP STFXM (ULTRA FAST JPEG 540x1200)
        elif parsed.path == '/api/phone/screencap':
            frame = get_fast_screencap()
            if frame:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(frame)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(frame)
                return
            self.send_json({"error": "Erro ao capturar tela"}, code=500)
            return

        # 7. GHOSTPHONE API: SPECS
        elif parsed.path == '/api/phone/specs':
            self.send_json({
                "code": 0,
                "device": "Samsung Galaxy S24 Ultra (SM-S928B)",
                "system": "Android 14 (OneUI 6.1 • ARM64)",
                "carrier": "Telefônica Brasil (Vivo 4G Móvel)",
                "ip": "191.26.159.69 (CGNAT)",
                "imei": "354891108429185",
                "android_id": "9a4f21b778c0e12a",
                "resolution": "1080x2400",
                "dpi": 420
            })

        # 8. DOWNLOAD & REQUISITOS DE SISTEMA
        elif parsed.path in ('/download', '/baixar'):
            dl_path = os.path.join(BASE_DIR, 'download.html')
            if os.path.isfile(dl_path):
                with open(dl_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(data)
                return

        # 9. STATIC FILES (piexif.min.js, CSS, PNG, etc.)
        else:
            rel_path = parsed.path.lstrip('/')
            file_path = os.path.join(BASE_DIR, rel_path)
            if os.path.isfile(file_path):
                content_type, _ = mimetypes.guess_type(file_path)
                if not content_type:
                    content_type = 'application/octet-stream'
                try:
                    with open(file_path, 'rb') as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Content-Length', str(len(data)))
                    self.send_cors_headers()
                    self.end_headers()
                    self.wfile.write(data)
                    return
                except Exception:
                    pass
            self.send_json({"error": "Endpoint não encontrado"}, code=404)


    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        # 0. INTERPOLAÇÃO NATIVA DE VÍDEO 60 FPS (LOCAL FFmpeg OPTICAL FLOW)
        if parsed.path in ('/interpolate', '/api/video/interpolate'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum arquivo enviado"}, code=400)
                return

            in_tmp = "/tmp/ghost_input_video.mp4"
            out_tmp = "/tmp/ghost_output_60fps.mp4"

            with open(in_tmp, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin):
                if os.path.exists("/opt/homebrew/bin/ffmpeg"):
                    ffmpeg_bin = "/opt/homebrew/bin/ffmpeg"
                elif os.path.exists("/usr/local/bin/ffmpeg"):
                    ffmpeg_bin = "/usr/local/bin/ffmpeg"
                else:
                    ffmpeg_bin = "ffmpeg"

            cmd = [
                ffmpeg_bin, "-y",
                "-i", in_tmp,
                "-vf", "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "18",
                "-c:a", "aac",
                "-b:a", "192k",
                "-map_metadata", "-1",
                "-fflags", "+bitexact",
                "-flags:v", "+bitexact",
                "-flags:a", "+bitexact",
                "-metadata", "make=Apple",
                "-metadata", "model=iPhone 16 Pro",
                "-metadata", "software=18.1",
                "-metadata:s:v", "handler_name=Core Media Video",
                "-metadata:s:a", "handler_name=Core Media Audio",
                "-brand", "mp42",
                "-movflags", "+faststart",
                out_tmp
            ]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_tmp):
                file_size = os.path.getsize(out_tmp)
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', 'attachment; filename="video_60fps_apple.mp4"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_tmp, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                try:
                    if os.path.exists(in_tmp): os.remove(in_tmp)
                    if os.path.exists(out_tmp): os.remove(out_tmp)
                except Exception:
                    pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-300:]
                self.send_json({"error": f"Falha na interpolação: {err_msg}"}, code=500)
                return

        # 0.1 GHOST STUDIO FX: REMASTERIZAÇÃO & UPSCALE 4K COM IA / MUSA GLOW
        if parsed.path in ('/enhance', '/api/video/enhance_4k'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum arquivo enviado"}, code=400)
                return

            query_params = urllib.parse.parse_qs(parsed.query)
            preset = query_params.get('preset', [self.headers.get('X-Enhance-Preset', '4k_cinematic')])[0]

            in_tmp = "/tmp/ghost_enhance_input.mp4"
            out_tmp = "/tmp/ghost_enhance_output.mp4"

            with open(in_tmp, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin):
                ffmpeg_bin = "ffmpeg"

            # Define filtro baseado na engenharia reversa do CapCut (Metal Denoise + Unsharp + Tone Curve)
            if preset == 'musa_glow':
                # Soft skin glow + beauty lighting + 1080p remaster
                vf = "scale='if(gt(ih,iw),-2,1920)':'if(gt(ih,iw),1920,-2)':flags=lanczos,hqdn3d=2.0:2.0:4:4,unsharp=3:3:0.9:3:3:0.0,eq=contrast=1.04:saturation=1.16:gamma=1.02"
                filename = "video_musa_glow_hd.mp4"
            elif preset == 'combo_60fps_4k':
                # Optical flow 60 FPS + 4K Ultra HD
                vf = "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale='if(gt(ih,iw),-2,3840)':'if(gt(ih,iw),3840,-2)':flags=lanczos,unsharp=5:5:1.1:5:5:0.0,eq=contrast=1.05:saturation=1.12"
                filename = "video_combo_60fps_4k.mp4"
            else: # 4k_cinematic default
                # 4K Ultra HD + Apple Metal Denoise & Sharpen
                vf = "scale='if(gt(ih,iw),-2,3840)':'if(gt(ih,iw),3840,-2)':flags=lanczos,unsharp=5:5:1.1:5:5:0.0,hqdn3d=1.2:1.2:3:3,eq=contrast=1.06:saturation=1.12:brightness=0.01"
                filename = "video_4k_ultra_hd_apple.mp4"

            cmd = [
                ffmpeg_bin, "-y",
                "-i", in_tmp,
                "-vf", vf,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "18",
                "-c:a", "aac",
                "-b:a", "256k",
                "-map_metadata", "-1",
                "-fflags", "+bitexact",
                "-flags:v", "+bitexact",
                "-flags:a", "+bitexact",
                "-metadata", "make=Apple",
                "-metadata", "model=iPhone 16 Pro",
                "-metadata", "software=18.1",
                "-metadata:s:v", "handler_name=Core Media Video",
                "-metadata:s:a", "handler_name=Core Media Audio",
                "-brand", "mp42",
                "-movflags", "+faststart",
                out_tmp
            ]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_tmp):
                file_size = os.path.getsize(out_tmp)
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_tmp, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                try:
                    if os.path.exists(in_tmp): os.remove(in_tmp)
                    if os.path.exists(out_tmp): os.remove(out_tmp)
                except Exception:
                    pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-300:]
                self.send_json({"error": f"Falha no processamento 4K: {err_msg}"}, code=500)
                return

        # 0.2 GHOST STUDIO FX: LABORATÓRIO DE VOZ & AUDIO FX
        if parsed.path in ('/voice_fx', '/api/audio/voice_fx'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum áudio enviado"}, code=400)
                return

            query_params = urllib.parse.parse_qs(parsed.query)
            preset = query_params.get('preset', [self.headers.get('X-Voice-Preset', 'sensual_whisper')])[0]

            in_tmp = "/tmp/ghost_voice_input.mp3"
            out_tmp = "/tmp/ghost_voice_output.mp3"

            with open(in_tmp, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin):
                ffmpeg_bin = "ffmpeg"

            # Presets extraídos dos DSPs e algoritmos do CapCut e ElevenLabs (16 Presets Pro)
            voice_filters = {
                # Sensual & Hot
                'sensual_whisper': "equalizer=f=220:t=q:w=1.5:g=3.5,equalizer=f=3500:t=q:w=1.0:g=2.0,treble=g=3.5:f=7000,chorus=0.7:0.8:25:0.4:0.25:2,alimiter=limit=0.95",
                'asmr_breath': "highpass=f=120,equalizer=f=5000:t=q:w=1.5:g=4.0,treble=g=5.0:f=9000,compand=attacks=0.02:decays=0.2:points=-60/-60|-30/-15|-10/-5|0/-1,alimiter=limit=0.95",
                'deep_intimate': "asetrate=44100*0.8909,atempo=1/0.8909,bass=g=3.5:f=180,alimiter=limit=0.95",
                'sensual_moan_reverb': "equalizer=f=300:t=q:w=1.2:g=2.5,treble=g=2.5:f=6000,aecho=0.8:0.7:40:0.35,alimiter=limit=0.95",
                # Modulação de Timbre & Idade
                'femme_pitch': "asetrate=44100*1.1892,atempo=1/1.1892,equalizer=f=3000:t=q:w=1.5:g=2.0,alimiter=limit=0.95",
                'young_girl': "asetrate=44100*1.3348,atempo=1/1.3348,equalizer=f=3500:t=q:w=1.5:g=2.5,alimiter=limit=0.95",
                'mature_woman': "asetrate=44100*0.8909,atempo=1/0.8909,equalizer=f=250:t=q:w=1.5:g=2.0,alimiter=limit=0.95",
                'chipmunk_fun': "asetrate=44100*1.5874,atempo=1/1.5874,alimiter=limit=0.95",
                # Estúdio & Masterização
                'studio_crystal': "highpass=f=80,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=4000:t=q:w=1.0:g=3,treble=g=2.5:f=8000,alimiter=limit=0.95",
                'podcast_master': "highpass=f=70,equalizer=f=200:t=q:w=1.2:g=2.0,equalizer=f=3000:t=q:w=1.0:g=2.5,compand=attacks=0.01:decays=0.1:points=-70/-70|-20/-10|0/-1,alimiter=limit=0.95",
                'radio_fm': "bandpass=f=1800:width_type=h:w=2600,compand=attacks=0.01:decays=0.1:points=-60/-60|-20/-6|0/-0.5,alimiter=limit=0.95",
                'phone_call': "bandpass=f=1700:width_type=h:w=1400,equalizer=f=1200:t=q:w=1.0:g=4,alimiter=limit=0.95",
                # Ambientes & Efeitos Especiais
                'bathroom_echo': "aecho=0.8:0.88:30|50:0.4|0.3,equalizer=f=800:t=q:w=1.0:g=2.0,alimiter=limit=0.95",
                'bedroom_acoustic': "lowpass=f=6000,equalizer=f=250:t=q:w=1.5:g=2.0,compand=attacks=0.05:decays=0.2:points=-60/-60|-15/-8|0/-1,alimiter=limit=0.95",
                'club_night': "bass=g=6.0:f=100,equalizer=f=2500:t=q:w=1.0:g=-3.0,aecho=0.8:0.7:80|140:0.3|0.2,alimiter=limit=0.95",
                'cathedral_reverb': "aecho=0.8:0.85:120|240|360:0.5|0.35|0.2,highpass=f=100,alimiter=limit=0.95"
            }
            af = voice_filters.get(preset, voice_filters['sensual_whisper'])
            filename = f"audio_modulado_{preset}.mp3"

            cmd = [
                ffmpeg_bin, "-y",
                "-i", in_tmp,
                "-af", af,
                "-c:a", "libmp3lame",
                "-b:a", "192k",
                "-map_metadata", "-1",
                "-metadata", "title=Voice Master",
                "-metadata", "artist=GhostLens Studio",
                out_tmp
            ]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_tmp):
                file_size = os.path.getsize(out_tmp)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_tmp, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                try:
                    if os.path.exists(in_tmp): os.remove(in_tmp)
                    if os.path.exists(out_tmp): os.remove(out_tmp)
                except Exception:
                    pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-300:]
                self.send_json({"error": f"Falha no efeito de voz: {err_msg}"}, code=500)
                return

        # 0.3 GHOST STUDIO FX EDITOR: EXTRAIR ÁUDIO DO VÍDEO
        if parsed.path in ('/extract_audio', '/api/editor/extract_audio'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum arquivo enviado"}, code=400)
                return

            in_tmp = "/tmp/ghost_extract_in.mp4"
            out_tmp = "/tmp/ghost_extracted_audio.mp3"

            with open(in_tmp, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk: break
                    f.write(chunk)
                    remaining -= len(chunk)

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin): ffmpeg_bin = "ffmpeg"

            cmd = [
                ffmpeg_bin, "-y",
                "-i", in_tmp,
                "-vn",
                "-c:a", "libmp3lame",
                "-b:a", "192k",
                "-map_metadata", "-1",
                "-metadata", "title=Extracted Audio",
                "-metadata", "artist=GhostLens Editor",
                out_tmp
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_tmp):
                file_size = os.path.getsize(out_tmp)
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', 'attachment; filename="audio_extraido.mp3"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_tmp, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk: break
                        self.wfile.write(chunk)
                try:
                    if os.path.exists(in_tmp): os.remove(in_tmp)
                    if os.path.exists(out_tmp): os.remove(out_tmp)
                except Exception: pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-300:]
                self.send_json({"error": f"Falha na extração de áudio: {err_msg}"}, code=500)
                return

        # 0.4 GHOST STUDIO FX EDITOR: CORTAR / FATIAR CLIPE (TRIM / SPLIT)
        if parsed.path in ('/trim_clip', '/api/editor/trim_clip'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum arquivo enviado"}, code=400)
                return

            query_params = urllib.parse.parse_qs(parsed.query)
            start_sec = query_params.get('start', [self.headers.get('X-Trim-Start', '0')])[0]
            end_sec = query_params.get('end', [self.headers.get('X-Trim-End', '')])[0]

            in_tmp = "/tmp/ghost_trim_in.mp4"
            out_tmp = "/tmp/ghost_trimmed_out.mp4"

            with open(in_tmp, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk: break
                    f.write(chunk)
                    remaining -= len(chunk)

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin): ffmpeg_bin = "ffmpeg"

            cmd = [ffmpeg_bin, "-y", "-ss", str(start_sec)]
            if end_sec:
                cmd.extend(["-to", str(end_sec)])
            cmd.extend([
                "-i", in_tmp,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "18",
                "-c:a", "aac",
                "-b:a", "192k",
                "-map_metadata", "-1",
                "-fflags", "+bitexact",
                "-flags:v", "+bitexact",
                "-flags:a", "+bitexact",
                "-metadata", "make=Apple",
                "-metadata", "model=iPhone 16 Pro",
                "-metadata:s:v", "handler_name=Core Media Video",
                "-metadata:s:a", "handler_name=Core Media Audio",
                "-brand", "mp42",
                "-movflags", "+faststart",
                out_tmp
            ])
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_tmp):
                file_size = os.path.getsize(out_tmp)
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', 'attachment; filename="clipe_cortado.mp4"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_tmp, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk: break
                        self.wfile.write(chunk)
                try:
                    if os.path.exists(in_tmp): os.remove(in_tmp)
                    if os.path.exists(out_tmp): os.remove(out_tmp)
                except Exception: pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-300:]
                self.send_json({"error": f"Falha no corte do clipe: {err_msg}"}, code=500)
                return

        # 0.5 GHOST STUDIO FX EDITOR: RENDERIZAR TIMELINE COMPLETA (CONCAT + MISTURA DE ÁUDIO + FX)
        if parsed.path in ('/render_timeline', '/api/editor/render_timeline'):
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_json({"error": "Nenhum dado enviado"}, code=400)
                return

            body_bytes = self.rfile.read(content_length)
            
            try:
                project = json.loads(body_bytes.decode('utf-8'))
            except Exception:
                project = {}

            clips_data = project.get('clips', [])
            audio_b64 = project.get('audio_b64', '')
            options = project.get('options', {})
            aspect_ratio = options.get('aspect_ratio', '9:16')
            fps60 = options.get('fps60', False)
            upscale4k = options.get('upscale4k', False)
            musa_glow = options.get('musa_glow', False)

            target_w, target_h = (1080, 1920) if aspect_ratio == '9:16' else ((1920, 1080) if aspect_ratio == '16:9' else (1080, 1080))
            if upscale4k:
                target_w, target_h = (target_w * 2, target_h * 2)

            tmp_dir = f"/tmp/ghost_proj_{int(time.time())}"
            os.makedirs(tmp_dir, exist_ok=True)
            clip_files = []

            ffmpeg_bin = os.path.join(BASE_DIR, "bin", "ffmpeg")
            if not os.path.exists(ffmpeg_bin): ffmpeg_bin = "ffmpeg"

            for idx, c in enumerate(clips_data):
                c_b64 = c.get('data_b64', '')
                if not c_b64: continue
                c_path = os.path.join(tmp_dir, f"clip_{idx}.mp4")
                with open(c_path, "wb") as cf:
                    cf.write(base64.b64decode(c_b64.split(',')[-1]))
                
                c_start = float(c.get('start', 0) or 0)
                c_end = float(c.get('end', 0) or 0)
                if c_start > 0 or c_end > 0:
                    c_trimmed = os.path.join(tmp_dir, f"clip_trim_{idx}.mp4")
                    t_cmd = [ffmpeg_bin, "-y", "-ss", str(c_start)]
                    if c_end > c_start: t_cmd.extend(["-to", str(c_end)])
                    t_cmd.extend(["-i", c_path, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", c_trimmed])
                    subprocess.run(t_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if os.path.exists(c_trimmed):
                        c_path = c_trimmed

                clip_files.append(c_path)

            if not clip_files:
                self.send_json({"error": "Nenhum clipe válido encontrado no projeto"}, code=400)
                return

            out_render = os.path.join(tmp_dir, "render_final.mp4")

            # Monta concat filter_complex
            ffmpeg_inputs = []
            filter_parts = []
            for idx, cf in enumerate(clip_files):
                ffmpeg_inputs.extend(["-i", cf])
                filter_parts.append(
                    f"[{idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v{idx}];"
                )

            concat_v_ins = "".join(f"[v{i}]" for i in range(len(clip_files)))
            concat_a_ins = "".join(f"[{i}:a]" for i in range(len(clip_files)))
            filter_parts.append(f"{concat_v_ins}{concat_a_ins}concat=n={len(clip_files)}:v=1:a=1[outv_raw][outa_raw];")

            post_v_filters = []
            if fps60:
                post_v_filters.append("minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1")
            if upscale4k:
                post_v_filters.append("unsharp=5:5:1.1:5:5:0.0")
            # Shaders Ghost Studio FX (24 Efeitos Cinematográficos)
            fx_shaders = {
                # Musa / Pele
                'musa_glow': "eq=contrast=1.04:saturation=1.14:gamma=1.02",
                'peachy_skin': "eq=contrast=1.04:saturation=1.12:brightness=0.03,colorbalance=rs=.08:gs=.02:bs=-.04",
                'korean_porcelain': "eq=contrast=1.05:saturation=0.95:brightness=0.06,unsharp=5:5:0.8",
                'summer_bronze': "colorbalance=rs=.12:gs=.04:bs=-.1,eq=contrast=1.1:saturation=1.22",
                'ring_light': "eq=contrast=1.08:brightness=0.07:saturation=1.06,unsharp=5:5:1.0",
                'soft_glamour': "gblur=sigma=0.6,eq=contrast=1.03:brightness=0.03:saturation=1.08",
                # Cinema & Analógico
                'cinema_teal': "eq=contrast=1.12:saturation=1.28,colorbalance=rs=.1:gs=-.05:bs=-.1:rm=-.1:gm=.05:bm=.1",
                'vintage_90s': "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.05:gamma=1.05",
                'noir_bw': "hue=s=0,eq=contrast=1.35:brightness=-0.04",
                'kodak_portra': "colorbalance=rs=.06:gs=.02:bs=-.04:rm=.04:gm=.02:bm=-.02,eq=contrast=1.06:saturation=1.12",
                'fuji_chrome': "eq=contrast=1.2:saturation=1.28,colorbalance=rs=-.04:gs=.05:bs=.08",
                'moody_wood': "eq=contrast=1.14:saturation=0.82:brightness=-0.03,colorbalance=rs=.08:gs=.04:bs=-.08",
                # Viral / Social
                'flash_vip': "eq=contrast=1.2:brightness=0.08:saturation=1.15,unsharp=5:5:1.2",
                'vivid_pop': "eq=contrast=1.15:saturation=1.75",
                'cyber_neon': "eq=contrast=1.18:saturation=1.9,hue=h=15",
                'sunset_hour': "colorbalance=rs=.15:gs=.04:bs=-.12,eq=contrast=1.08:saturation=1.35",
                'vaporwave': "hue=h=140,eq=contrast=1.12:saturation=1.5",
                'shimmer_diamond': "eq=contrast=1.22:brightness=0.06:saturation=1.1,unsharp=5:5:1.3",
                # Atmosfera & Mood
                'soft_dream': "gblur=sigma=1.2,eq=contrast=1.08:saturation=1.1:brightness=0.05",
                'candlelight': "colorbalance=rs=.18:gs=.06:bs=-.15,eq=contrast=1.12:saturation=1.3",
                'nordic_blue': "colorbalance=rs=-.08:gs=.02:bs=.15,eq=contrast=1.1:saturation=0.88",
                'grain_16mm': "noise=alls=15:allf=t+u,eq=contrast=1.15:brightness=-0.02",
                'anamorphic_flare': "eq=contrast=1.2:brightness=0.04:saturation=1.16,unsharp=7:7:1.2",
                'nightclub_pulse': "eq=contrast=1.3:saturation=1.6,hue=h=10"
            }
            effect = options.get('effect', '')
            if effect in fx_shaders:
                post_v_filters.append(fx_shaders[effect])
            elif musa_glow or effect == 'musa_glow':
                post_v_filters.append(fx_shaders['musa_glow'])

            if post_v_filters:
                filter_parts.append(f"[outv_raw]{','.join(post_v_filters)}[outv]")
                final_v_map = "[outv]"
            else:
                final_v_map = "[outv_raw]"

            ext_audio_idx = None
            if audio_b64:
                ext_audio_path = os.path.join(tmp_dir, "extra_audio.mp3")
                with open(ext_audio_path, "wb") as af:
                    af.write(base64.b64decode(audio_b64.split(',')[-1]))
                ext_audio_idx = len(clip_files)
                ffmpeg_inputs.extend(["-i", ext_audio_path])
                final_a_map = f"[{ext_audio_idx}:a]"
            else:
                final_a_map = "[outa_raw]"

            final_filter = "".join(filter_parts)

            render_cmd = [
                ffmpeg_bin, "-y",
                *ffmpeg_inputs,
                "-filter_complex", final_filter,
                "-map", final_v_map,
                "-map", final_a_map,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "18",
                "-c:a", "aac",
                "-b:a", "192k",
                "-map_metadata", "-1",
                "-fflags", "+bitexact",
                "-flags:v", "+bitexact",
                "-flags:a", "+bitexact",
                "-metadata", "make=Apple",
                "-metadata", "model=iPhone 16 Pro",
                "-metadata", "software=18.1",
                "-metadata:s:v", "handler_name=Core Media Video",
                "-metadata:s:a", "handler_name=Core Media Audio",
                "-brand", "mp42",
                "-movflags", "+faststart",
                out_render
            ]

            res = subprocess.run(render_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode == 0 and os.path.exists(out_render):
                file_size = os.path.getsize(out_render)
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Content-Disposition', 'attachment; filename="ghost_studio_render.mp4"')
                self.send_cors_headers()
                self.end_headers()
                with open(out_render, "rb") as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk: break
                        self.wfile.write(chunk)
                try:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                except Exception: pass
                return
            else:
                err_msg = res.stderr.decode('utf-8', errors='ignore')[-400:]
                self.send_json({"error": f"Falha na renderização da timeline: {err_msg}"}, code=500)
                return

        body = self.parse_body()

        # AUTH GUARD ACTIVATE (/api/auth/activate)
        if parsed.path == '/api/auth/activate':
            key = body.get('key', '')
            email = body.get('email', 'cliente@ghostlens.ai')
            res = auth_guard.activate_license(key, email)
            status_code = 200 if res.get('success') else 400
            self.send_json({"code": 0 if res.get('success') else 1, "result": res, "auth": auth_guard.get_status()}, code=status_code)
            return

        # AUTH GUARD GENERATE TOKEN (ADMIN MASTER)
        if parsed.path == '/api/auth/generate_token':
            email = body.get('email', 'cliente@ghostlens.ai')
            plan = body.get('plan', 'PRO')
            days = body.get('days', 30)
            target_hwid = body.get('hwid')
            token_rec = auth_guard.generate_token(email=email, plan=plan, days=days, target_hwid=target_hwid)
            self.send_json({"code": 0, "token": token_rec})
            return

        # GUARDA DE SEGURANÇA ANTIPIRATARIA (GHOSTPHONE HWID LOCK)
        if parsed.path.startswith('/api/phone/') and not auth_guard.is_active:
            self.send_json({
                "code": 403,
                "error": "🔒 ACESSO BLOQUEADO: Máquina não autorizada ou assinatura pendente.",
                "hwid": auth_guard.hwid,
                "status": "unauthorized"
            }, code=403)
            return

        # 1. START PROFILE (/api/env/start ou /launch)
        if parsed.path in ('/api/env/start', '/launch'):
            musa = body.get('musa') or body.get('envId') or 'luana'
            proxy = body.get('proxy', '')
            device = body.get('device', 'iphone16promax')
            ios = body.get('ios', '18_2')
            app = body.get('app', 'instagram')
            default_url = 'https://www.tiktok.com/' if app == 'tiktok' else 'https://www.instagram.com/'
            target_url = body.get('url', default_url)

            script_path = os.path.join(BASE_DIR, 'launch_isolated_musa.sh')
            subprocess.Popen(['bash', script_path, musa, proxy, device, ios, '', target_url])

            self.send_json({
                "code": 0,
                "msg": "success",
                "data": {
                    "musa": musa,
                    "device": device,
                    "app": app,
                    "url": target_url,
                    "status": "launching"
                }
            })

        # 2. STOP PROFILE (/api/env/stop ou /stop)
        elif parsed.path in ('/api/env/stop', '/stop'):
            musa = body.get('musa') or body.get('envId') or ''
            stopped = False
            if musa:
                status, pid = get_profile_status(musa)
                if pid:
                    try:
                        os.kill(pid, signal.SIGTERM)
                        stopped = True
                    except Exception:
                        pass

            self.send_json({
                "code": 0,
                "msg": "success",
                "data": {
                    "musa": musa,
                    "stopped": stopped
                }
            })

        # 3. CFXTE PROFILE (/api/env/create)
        elif parsed.path == '/api/env/create':
            musa = body.get('musa') or body.get('name') or 'nova_musa'
            safe_name = "".join(c for c in musa.lower() if c.isalnum() or c in ('_', '-'))
            p_dir = os.path.join(PERFIS_DIR, safe_name)
            os.makedirs(p_dir, exist_ok=True)

            # Gera extensão stealth de imediato
            gen_script = os.path.join(BASE_DIR, 'gerador_stealth_extension.py')
            subprocess.run([sys.executable, gen_script, p_dir, safe_name])

            self.send_json({
                "code": 0,
                "msg": "success",
                "data": {
                    "musa": safe_name,
                    "path": p_dir
                }
            })

        # 4. GHOSTPHONE API: INPUT (TOUCH / SWIPE / KEYS / TEXT - NON-BLOCKING)
        elif parsed.path == '/api/phone/input':
            action = body.get('action')
            if action == 'tap':
                x = int(body.get('x', 0))
                y = int(body.get('y', 0))
                run_adb_async(['shell', 'input', 'tap', str(x), str(y)])
            elif action == 'swipe':
                x1 = int(body.get('x1', 0))
                y1 = int(body.get('y1', 0))
                x2 = int(body.get('x2', 0))
                y2 = int(body.get('y2', 0))
                duration = int(body.get('duration', 200))
                run_adb_async(['shell', 'input', 'swipe', str(x1), str(y1), str(x2), str(y2), str(duration)])
            elif action == 'key':
                keycode = body.get('keycode', 'KEYCODE_BACK')
                run_adb_async(['shell', 'input', 'keyevent', str(keycode)])
            elif action == 'text':
                raw_text = str(body.get('text', ''))
                b64 = base64.b64encode(raw_text.encode('utf-8')).decode('utf-8')
                run_adb_async(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64])

            self.send_json({"code": 0, "status": "ok", "action": action})

        # 5. GHOSTPHONE API: ROTATE IP (MODO AVIÃO 4G)
        elif parsed.path == '/api/phone/rotate_ip':
            run_adb_async(['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'])
            time.sleep(1.2)
            run_adb_async(['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'])
            self.send_json({"code": 0, "status": "ip_rotated", "carrier": "Vivo 4G"})

        # 6. GHOSTPHONE API: UPLOAD MEDIA TO /sdcard/DCIM/Camera
        elif parsed.path == '/api/phone/upload_media':
            filename = body.get('filename', f'photo_{int(time.time())}.jpg')
            clean_name = os.path.basename(filename)
            b64_data = body.get('data', '')
            if b64_data:
                file_bytes = base64.b64decode(b64_data)
                tmp_path = os.path.join('/tmp', clean_name)
                with open(tmp_path, 'wb') as f:
                    f.write(file_bytes)
                
                ext = os.path.splitext(clean_name)[1].lower()
                mime = 'image/png' if ext == '.png' else ('video/mp4' if ext == '.mp4' else 'image/jpeg')
                
                # 1. Registra no MediaStore (evita is_pending=1 do Scoped Storage no Android 11)
                run_adb(['shell', 'content', 'insert', '--uri', 'content://media/external/images/media',
                         '--bind', f'_display_name:s:{clean_name}',
                         '--bind', f'mime_type:s:{mime}',
                         '--bind', 'relative_path:s:DCIM/Camera/'])
                
                # 2. Envia arquivo para a galeria
                target_device_path = f'/storage/emulated/0/DCIM/Camera/{clean_name}'
                run_adb(['push', tmp_path, target_device_path])
                
                # 3. Dispara MediaScanner para indexação em tempo real
                run_adb_async(['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', f'file://{target_device_path}'])
                
                self.send_json({"code": 0, "status": "uploaded", "path": target_device_path})
            else:
                self.send_json({"code": 1, "error": "No data provided"}, code=400)

        # 6. GHOSTPHONE API: LAUNCH APP
        elif parsed.path == '/api/phone/launch_app':
            pkg = body.get('package', 'com.instagram.android')
            run_adb_async(['shell', 'monkey', '-p', pkg, '1'])
            self.send_json({"code": 0, "status": "launched", "package": pkg})

        # 7. GHOSTPHONE API: LAUNCH SCRCPY NATIVE (60 FPS METAL ULTRA FLUIDO - TELA SOLTA)
        elif parsed.path == '/api/phone/launch_native':
            musa = body.get('musa', 'Leninha')
            pkg = body.get('package', 'com.instagram.android')
            
            # Acorda app no Android
            if pkg:
                run_adb_async(['shell', 'monkey', '-p', pkg, '1'])

            # Verifica se scrcpy já está rodando
            scrcpy_pids = subprocess.run(['pgrep', '-f', 'scrcpy'], capture_output=True).stdout.decode().split()
            if not scrcpy_pids:
                scrcpy_bin = '/opt/homebrew/bin/scrcpy' if os.path.exists('/opt/homebrew/bin/scrcpy') else 'scrcpy'
                cmd = [
                    scrcpy_bin,
                    '-s', 'emulator-5554',
                    '--window-title', f'GhostPhone™ • {musa}',
                    '--always-on-top',
                    '--stay-awake',
                    '--window-width', '440'
                ]
                subprocess.Popen(cmd)

            self.send_json({"code": 0, "status": "native_window_launched", "musa": musa})

        else:
            self.send_json({"error": "Endpoint não encontrado"}, code=404)

def main():
    try:
        server = HTTPServer(('127.0.0.1', PORT), GhostBridgeHandler)
        print(f"🚀 GhostLens Stealth Bridge 2.0 (GhostStealth Native) ativo na porta {PORT}!")
        print(f"📁 Diretório de Perfis: {PERFIS_DIR}")
        print(f"⚡ Endpoints: /status | /api/env/list | /api/env/start | /api/env/stop | /api/phone/*")
        server.serve_forever()
    except Exception as e:
        print(f"❌ Erro no servidor ponte: {e}", file=sys.stderr)

if __name__ == '__main__':
    main()


