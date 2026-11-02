#!/usr/bin/env python3
"""
🛡️ GHOSTLENS LICENSE & HWID GUARD 3.1

Modelo de segurança:
- A ativação e a renovação passam por /api/license_session (JWT curto).
- O servidor valida a licença e o device no Supabase a cada renovação.
- Revogação, limite de devices e expiração valem no servidor.
- O cliente guarda a sessão localmente, mas precisa renová-la periodicamente.
- Janelas de tolerância:
    * OFFLINE_GRACE_HOURS: tempo que uma sessão vencida ainda funciona offline.
    * LEGACY_GRACE_HOURS: janela de migração para licenças antigas sem sessão.

Variáveis de ambiente:
- GHOSTLENS_SESSION_URL / GHOSTLENS_SESSION_URLS
- GHOSTLENS_ADMIN_TOKEN (se ausente, gerado em ~/.ghostphone/admin_token)
- GHOSTLENS_HTTP_TIMEOUT (default 8s)
- GHOSTLENS_OFFLINE_GRACE_HOURS (default 24)
- GHOSTLENS_LEGACY_GRACE_HOURS (default 72)
- GHOSTLENS_REFRESH_RETRY_SECONDS (default 300)
"""

import os
import sys
import json
import time
import secrets
import hashlib
import platform
import threading
import subprocess
import urllib.request
import urllib.error


class _NullWriter:
    def write(self, s):
        pass

    def flush(self):
        pass

    def isatty(self):
        return False


if sys.stdout is None:
    try:
        log_dir = os.path.expanduser("~/.ghostphone")
        os.makedirs(log_dir, exist_ok=True)
        sys.stdout = open(os.path.join(log_dir, "ghostlens_auth.log"), "a", encoding="utf-8")
    except Exception:
        sys.stdout = _NullWriter()

if sys.stderr is None:
    try:
        log_dir = os.path.expanduser("~/.ghostphone")
        os.makedirs(log_dir, exist_ok=True)
        sys.stderr = open(os.path.join(log_dir, "ghostlens_auth_err.log"), "a", encoding="utf-8")
    except Exception:
        sys.stderr = _NullWriter()

LICENSE_DIR = os.path.expanduser("~/.ghostphone")
LICENSE_FILE = os.path.join(LICENSE_DIR, "license.key")
ADMIN_TOKEN_FILE = os.path.join(LICENSE_DIR, "admin_token")
ISSUED_FILE = os.path.join(LICENSE_DIR, "issued_licenses.json")

_DEFAULT_SESSION_URLS = (
    "https://ghostlens.cloud/api/license_session,"
    "https://www.ghostlens.cloud/api/license_session,"
    "https://ghostlens.com.br/api/license_session"
)

HTTP_TIMEOUT = float(os.environ.get("GHOSTLENS_HTTP_TIMEOUT", "8"))
OFFLINE_GRACE_HOURS = float(os.environ.get("GHOSTLENS_OFFLINE_GRACE_HOURS", "24"))
LEGACY_GRACE_HOURS = float(os.environ.get("GHOSTLENS_LEGACY_GRACE_HOURS", "72"))
REFRESH_RETRY_SECONDS = int(os.environ.get("GHOSTLENS_REFRESH_RETRY_SECONDS", "300"))
SESSION_REFRESH_MARGIN = 0.25

_ERROR_MESSAGES = {
    "license_not_found": "Chave não encontrada. Confira a chave enviada por e-mail.",
    "hwid_mismatch": "🔒 Esta licença já está vinculada a outra máquina física.",
    "license_expired": "Licença expirada. Renove seu plano para continuar.",
    "license_inactive": "Licença revogada ou inativa. Fale com o suporte.",
    "invalid_license_format": "Formato de chave inválido.",
    "license_backend_unavailable": "Servidor de licenças indisponível. Tente novamente em instantes.",
    "invalid_session": "Sessão inválida ou expirada.",
    "device_limit_reached": "Limite de dispositivos do seu plano foi atingido.",
    "device_revoked": "Este dispositivo foi desautorizado pelo administrador.",
    "rate_limited": "Muitas tentativas. Aguarde alguns minutos.",
    "invalid_server_response": "Resposta inválida do servidor de licenças.",
    "missing_service_role": "Servidor de licenças não configurado."
}

_ADMIN_TOKEN_CACHE = None


def get_admin_token():
    """Token local que protege os endpoints administrativos do daemon (porta 4444)."""
    global _ADMIN_TOKEN_CACHE
    if _ADMIN_TOKEN_CACHE is not None:
        return _ADMIN_TOKEN_CACHE

    env_token = os.environ.get("GHOSTLENS_ADMIN_TOKEN", "").strip()
    if env_token:
        _ADMIN_TOKEN_CACHE = env_token
        return _ADMIN_TOKEN_CACHE

    try:
        os.makedirs(LICENSE_DIR, exist_ok=True)
        if os.path.exists(ADMIN_TOKEN_FILE):
            with open(ADMIN_TOKEN_FILE, "r", encoding="utf-8") as f:
                token = f.read().strip()
            if token:
                _ADMIN_TOKEN_CACHE = token
                return _ADMIN_TOKEN_CACHE

        token = secrets.token_hex(24)
        fd = os.open(ADMIN_TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(token + "\n")
        try:
            os.chmod(ADMIN_TOKEN_FILE, 0o600)
        except Exception:
            pass
        _ADMIN_TOKEN_CACHE = token
        return _ADMIN_TOKEN_CACHE
    except Exception as e:
        sys.stderr.write(f"[GhostGuard] Não foi possível preparar o admin token: {e}\n")
        _ADMIN_TOKEN_CACHE = ""
        return _ADMIN_TOKEN_CACHE


def _session_urls():
    override = os.environ.get("GHOSTLENS_SESSION_URL", "").strip()
    if override:
        return [override]
    raw = os.environ.get("GHOSTLENS_SESSION_URLS", _DEFAULT_SESSION_URLS)
    return [u.strip() for u in raw.split(",") if u.strip()]


class GhostAuthGuard:
    def __init__(self):
        self.hwid = self.calculate_hwid()
        self.license_data = None
        self.is_active = False
        self.heartbeat_thread = None
        self.lock = threading.RLock()

        self.load_and_validate_license()
        self.start_heartbeat_sentinel()

    def calculate_hwid(self):
        """Calcula o Hardware ID exclusivo da máquina (mesma derivação das versões antigas)."""
        system = platform.system()
        raw = ""
        try:
            if system == "Darwin":
                out = subprocess.check_output(
                    ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                    stderr=subprocess.DEVNULL
                ).decode("utf-8", "ignore")
                for line in out.splitlines():
                    if "IOPlatformUUID" in line:
                        raw = line.split('"')[-2]
                        break
            elif system == "Windows":
                try:
                    import winreg
                    with winreg.OpenKey(
                        winreg.HKEY_LOCAL_MACHINE,
                        r"SOFTWARE\Microsoft\Cryptography"
                    ) as key:
                        raw, _ = winreg.QueryValueEx(key, "MachineGuid")
                except Exception:
                    raw = ""

                if not raw:
                    try:
                        raw = subprocess.check_output(
                            [
                                "powershell", "-NoProfile", "-Command",
                                "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"
                            ],
                            stderr=subprocess.DEVNULL,
                            timeout=3
                        ).decode("utf-8", "ignore").strip()
                    except Exception:
                        raw = ""

                if not raw:
                    try:
                        out = subprocess.check_output(
                            ["wmic", "csproduct", "get", "uuid"],
                            stderr=subprocess.DEVNULL,
                            timeout=3
                        ).decode("utf-8", "ignore")
                        lines = [l.strip() for l in out.splitlines() if l.strip() and "UUID" not in l]
                        raw = lines[0] if lines else ""
                    except Exception:
                        raw = ""
            else:
                with open("/etc/machine-id", "r", encoding="utf-8") as f:
                    raw = f.read().strip()
        except Exception:
            raw = platform.node() + platform.machine() + platform.processor()

        hwid_namespace = "GHOSTPHONE_CORE_SECRET_2026_ANTI_REVERSE_789412"
        digest = hashlib.sha256((hwid_namespace + raw).encode("utf-8")).hexdigest()[:24].upper()
        return f"GP-{system[:3].upper()}-{digest[:4]}-{digest[4:8]}-{digest[8:12]}"

    # ── Sessão server-side ─────────────────────────────────────────────────

    def _request_session(self, key, hwid, token=None):
        """Retorna (data, None) ou (None, error_code)."""
        payload = json.dumps({"key": key, "hwid": hwid}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "GhostLens/3.1",
            "X-GhostLens-Hwid": hwid,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        last_error = None
        for url in _session_urls():
            try:
                req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8", "ignore"))
            except urllib.error.HTTPError as e:
                if e.code >= 500:
                    last_error = f"HTTP {e.code}"
                    continue
                try:
                    err = json.loads(e.read().decode("utf-8", "ignore"))
                except Exception:
                    err = {}
                code = err.get("error") or ("invalid_session" if e.code == 401 else "license_not_found")
                return None, code
            except Exception as e:
                last_error = str(e)
                continue

            if not data.get("success"):
                return None, data.get("error") or "license_not_found"

            if not data.get("token") or not data.get("license"):
                return None, "invalid_server_response"

            return data, None

        sys.stderr.write(f"[GhostGuard] Servidores de sessão inacessíveis: {last_error}\n")
        return None, "license_backend_unavailable"

    def _apply_session(self, data, email_fallback=""):
        lic = data.get("license") or {}
        token = data.get("token") or ""

        try:
            license_expires = int(lic.get("expires_at"))
            session_expires = int(data.get("expires_at"))
        except (TypeError, ValueError):
            return False, "invalid_server_response"

        now = int(time.time())
        if not token or session_expires <= now or license_expires <= now:
            return False, "invalid_server_response"

        self.license_data = {
            "key": str(lic.get("key") or "").strip().upper(),
            "email": lic.get("email") or email_fallback,
            "plan": lic.get("plan") or "GhostLens",
            "hwid": self.hwid,
            "max_devices": int(lic.get("max_devices") or 1),
            "expires_at": license_expires,
            "status": "active",
            "verified_at": now,
            "session_token": token,
            "session_expires_at": session_expires,
            "session_updated_at": now,
        }
        self.save_license()
        self.is_active = True
        return True, None

    def _mark_session_rejected(self, reason):
        if self.license_data:
            self.license_data["session_rejected"] = True
            self.license_data["session_rejected_reason"] = reason
            self.license_data["session_rejected_at"] = int(time.time())
            self.save_license()
        self.is_active = False
        sys.stderr.write(f"[GhostGuard] Sessão recusada: {reason}\n")

    def _in_legacy_grace(self):
        if not self.license_data:
            return False
        if self.license_data.get("session_token"):
            return False
        started = self.license_data.get("legacy_grace_started_at")
        if not started:
            return False
        return time.time() < float(started) + (LEGACY_GRACE_HOURS * 3600)

    def activate_license(self, license_key, email="cliente@ghostlens.cloud"):
        """Ativa uma chave via /api/license_session. Falha fechada."""
        with self.lock:
            key = (license_key or "").strip().upper()
            if not key:
                return {"success": False, "message": "Informe uma chave de licença."}

            if not (key.startswith("GHOST-") and len(key) >= 20):
                return {
                    "success": False,
                    "message": _ERROR_MESSAGES["invalid_license_format"],
                    "error": "invalid_license_format"
                }

            data, error = self._request_session(key, self.hwid)
            if not data:
                return {
                    "success": False,
                    "message": _ERROR_MESSAGES.get(error, "Licença recusada."),
                    "error": error
                }

            ok, apply_error = self._apply_session(data, email)
            if not ok:
                return {
                    "success": False,
                    "message": _ERROR_MESSAGES.get(apply_error, "Resposta inválida do servidor."),
                    "error": apply_error
                }

            sys.stdout.write(f"[GhostGuard] ✓ Licença ativada: {self.license_data['plan']}\n")
            sys.stdout.flush()
            return {
                "success": True,
                "message": f"Licença ativada com sucesso! Plano: {self.license_data['plan']}",
                "data": self.license_data
            }

    def ensure_session(self):
        """
        Renova a sessão usando o token atual; se ele já venceu/foi rejeitado,
        tenta uma sessão nova com a chave armazenada.
        """
        with self.lock:
            if not self.license_data:
                return False, "no_license"

            key = self.license_data.get("key")
            token = self.license_data.get("session_token")

            data = None
            error = None
            if token:
                data, error = self._request_session(key, self.hwid, token=token)

            if not data and error in (None, "invalid_session"):
                data, error = self._request_session(key, self.hwid)

            if not data:
                return False, error or "license_backend_unavailable"

            ok, apply_error = self._apply_session(data, self.license_data.get("email", ""))
            return ok, apply_error

    def refresh_session(self):
        return self.ensure_session()

    # ── Persistência local ─────────────────────────────────────────────────

    def save_license(self):
        try:
            os.makedirs(LICENSE_DIR, exist_ok=True)
            with open(LICENSE_FILE, "w", encoding="utf-8") as f:
                json.dump(self.license_data, f, indent=2)
            try:
                os.chmod(LICENSE_FILE, 0o600)
            except Exception:
                pass
        except Exception as e:
            sys.stderr.write(f"[GhostGuard] Erro ao salvar licença: {e}\n")

    def load_and_validate_license(self):
        """Valida HWID, expiração e a janela da sessão local. Sem auto-ativação."""
        with self.lock:
            if not os.path.exists(LICENSE_FILE):
                self.license_data = None
                self.is_active = False
                return

            try:
                with open(LICENSE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                sys.stderr.write(f"[GhostGuard] Falha ao ler licença: {e}\n")
                self.is_active = False
                return

            if not data or data.get("hwid") != self.hwid:
                sys.stderr.write("[GhostGuard] ❌ Licença vinculada a outra máquina (HWID mismatch).\n")
                self.license_data = None
                self.is_active = False
                return

            if data.get("status") != "active" or data.get("session_rejected"):
                self.license_data = data
                self.is_active = False
                return

            try:
                license_expires = int(data.get("expires_at", 0))
            except (TypeError, ValueError):
                license_expires = 0

            now = time.time()
            if license_expires <= now:
                sys.stderr.write("[GhostGuard] ❌ Licença expirada.\n")
                self.license_data = data
                self.is_active = False
                return

            token = data.get("session_token") or ""
            try:
                session_expires = int(data.get("session_expires_at", 0))
            except (TypeError, ValueError):
                session_expires = 0

            if token and session_expires + (OFFLINE_GRACE_HOURS * 3600) > now:
                self.license_data = data
                self.is_active = True
                return

            # Licença antiga sem sessão: abre janela de migração uma única vez.
            if not token:
                if "legacy_grace_started_at" not in data:
                    data["legacy_grace_started_at"] = int(now)
                    self.license_data = data
                    self.save_license()
                self.license_data = data
                if self._in_legacy_grace():
                    self.is_active = True
                    return

            self.license_data = data
            self.is_active = False

    # ── Emissão manual (admin) ─────────────────────────────────────────────

    def generate_token(self, email, plan="PRO", days=30, target_hwid=None):
        """
        Gera uma chave para registro manual. A chave só ativa se for inserida
        em public.ghost_licenses (os webhooks de pagamento fazem isso
        automaticamente). Endpoint protegido por token admin no daemon.
        """
        plan_clean = str(plan).upper()
        if "SOLO" in plan_clean:
            code, max_devs, plan_name = "SOLO", 1, "GhostLens Solo (1 Dispositivo)"
        elif "AGENCY" in plan_clean or "SCALE" in plan_clean:
            code, max_devs, plan_name = "AGENCY", 10, "GhostLens Agency (10 Dispositivos)"
        elif "MASTER" in plan_clean:
            code, max_devs, plan_name = "MASTER", 50, "GhostLens Master (Ilimitado)"
        else:
            code, max_devs, plan_name = "PRO", 3, "GhostLens Pro (3 Dispositivos)"

        part = lambda: secrets.token_hex(2).upper()
        key = f"GHOST-{code}-{part()}-{part()}-{part()}"

        days_int = max(1, int(days))
        expires_at = int(time.time()) + (days_int * 86400)
        record = {
            "key": key,
            "email": email,
            "plan": plan_name,
            "code": code,
            "max_devices": max_devs,
            "days": days_int,
            "expires_at": expires_at,
            "target_hwid": (target_hwid or "").strip().upper() or None,
            "created_at": int(time.time()),
            "status": "pending_registration",
            "registered": False,
            "note": "Registre esta chave em public.ghost_licenses para ativá-la via servidor."
        }

        issued = self.get_issued_licenses()
        issued.insert(0, record)
        try:
            os.makedirs(LICENSE_DIR, exist_ok=True)
            with open(ISSUED_FILE, "w", encoding="utf-8") as f:
                json.dump(issued, f, indent=2)
        except Exception as e:
            sys.stderr.write(f"[GhostGuard] Erro ao salvar issued_licenses: {e}\n")

        return record

    def get_issued_licenses(self):
        if os.path.exists(ISSUED_FILE):
            try:
                with open(ISSUED_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    # ── Sentinela ──────────────────────────────────────────────────────────

    def start_heartbeat_sentinel(self):
        """Revalida a cada 60s e renova a sessão antes de vencer."""
        def sentinel():
            last_attempt = 0
            while True:
                time.sleep(60)
                was_active = self.is_active
                self.load_and_validate_license()
                now = time.time()

                needs_session = False
                if self.license_data and not self.license_data.get("session_rejected"):
                    license_expires = int(self.license_data.get("expires_at") or 0)
                    token = self.license_data.get("session_token") or ""
                    session_expires = int(self.license_data.get("session_expires_at") or 0)
                    updated = int(self.license_data.get("session_updated_at") or session_expires)
                    ttl = max(session_expires - updated, 1)

                    if license_expires > now:
                        if not token:
                            needs_session = True
                        elif session_expires + (OFFLINE_GRACE_HOURS * 3600) <= now:
                            needs_session = True
                        elif session_expires - now <= ttl * SESSION_REFRESH_MARGIN:
                            needs_session = True

                if needs_session and (now - last_attempt) >= REFRESH_RETRY_SECONDS:
                    last_attempt = now
                    ok, error = self.ensure_session()
                    if not ok:
                        if error == "license_not_found" and self._in_legacy_grace():
                            sys.stderr.write(
                                "[GhostGuard] Chave ainda não registrada no servidor; "
                                "mantendo janela de migração.\n"
                            )
                        elif error in ("license_backend_unavailable", "no_license", "invalid_server_response"):
                            sys.stderr.write(
                                f"[GhostGuard] Não foi possível renovar sessão ({error}); "
                                "mantendo até o limite offline.\n"
                            )
                        else:
                            self._mark_session_rejected(error)

                if was_active and not self.is_active:
                    sys.stderr.write("[GhostGuard] ⚠️ Sessão inválida. Bloqueando instâncias.\n")
                    try:
                        subprocess.run(["adb", "emu", "kill"], capture_output=True, timeout=5)
                    except Exception:
                        pass

        t = threading.Thread(target=sentinel, daemon=True)
        t.start()
        self.heartbeat_thread = t

    def get_status(self):
        with self.lock:
            token = self.license_data.get("session_token") if self.license_data else ""
            session_expires = self.license_data.get("session_expires_at", 0) if self.license_data else 0
            return {
                "active": self.is_active,
                "hwid": self.hwid,
                "email": self.license_data.get("email") if self.license_data else None,
                "plan": self.license_data.get("plan") if self.license_data else "Não Ativado",
                "max_devices": self.license_data.get("max_devices") if self.license_data else 0,
                "expires_at": self.license_data.get("expires_at") if self.license_data else 0,
                "session_expires_at": session_expires,
                "session_valid": bool(token and session_expires > time.time()),
                "status": "authorized" if self.is_active else "unauthorized"
            }


auth_guard = GhostAuthGuard()


if __name__ == "__main__":
    print("=== [GHOSTLENS AUTH GUARD 3.1] ===")
    print("HWID:", auth_guard.hwid)
    print("Admin token file:", ADMIN_TOKEN_FILE)
    print("Status:", json.dumps(auth_guard.get_status(), indent=2))
