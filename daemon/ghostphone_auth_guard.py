#!/usr/bin/env python3
"""
🛡️ GHOSTLENS LICENSE & HWID GUARD 3.0

Regras:
- A ativação de uma chave comercial é feita ONLINE contra /api/verify_license,
  que consulta public.ghost_licenses no Supabase.
- Não existe chave master hardcoded, auto-ativação por ambiente de dev nem
  aceitação de qualquer string "GHOST-*": sem registro no banco, não ativa.
- O arquivo local guarda a licença já validada e é checado a cada 60s
  (HWID + expiração). Falha = bloqueio das instâncias.

Variáveis de ambiente:
- GHOSTLENS_ACTIVATION_URL   (sobrepõe a lista de servidores)
- GHOSTLENS_ACTIVATION_URLS  (lista separada por vírgula)
- GHOSTLENS_ADMIN_TOKEN      (se ausente, é gerado em ~/.ghostphone/admin_token)
- GHOSTLENS_HTTP_TIMEOUT     (default 8s)
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

_DEFAULT_ACTIVATION_URLS = (
    "https://ghostlens.cloud/api/verify_license,"
    "https://www.ghostlens.cloud/api/verify_license,"
    "https://ghostlens.com.br/api/verify_license"
)

HTTP_TIMEOUT = float(os.environ.get("GHOSTLENS_HTTP_TIMEOUT", "8"))

_ERROR_MESSAGES = {
    "license_not_found": "Chave não encontrada. Confira a chave enviada por e-mail.",
    "hwid_mismatch": "🔒 Esta licença já está vinculada a outra máquina física.",
    "license_expired": "Licença expirada. Renove seu plano para continuar.",
    "license_inactive": "Licença revogada ou inativa. Fale com o suporte.",
    "invalid_license_format": "Formato de chave inválido.",
    "license_backend_unavailable": "Servidor de licenças indisponível. Tente novamente em instantes.",
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


def _activation_urls():
    override = os.environ.get("GHOSTLENS_ACTIVATION_URL", "").strip()
    if override:
        return [override]
    raw = os.environ.get("GHOSTLENS_ACTIVATION_URLS", _DEFAULT_ACTIVATION_URLS)
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
        """Calcula o Hardware ID exclusivo da máquina."""
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

        # Mantém a MESMA derivação das versões anteriores para não invalidar
        # licenças já instaladas. O namespace não é um segredo — é só um prefixo.
        hwid_namespace = "GHOSTPHONE_CORE_SECRET_2026_ANTI_REVERSE_789412"
        digest = hashlib.sha256((hwid_namespace + raw).encode("utf-8")).hexdigest()[:24].upper()
        return f"GP-{system[:3].upper()}-{digest[:4]}-{digest[4:8]}-{digest[8:12]}"

    # ── Comunicação com o servidor de licenças ────────────────────────────

    def _post_activation(self, url, key, email):
        payload = json.dumps({
            "key": key,
            "hwid": self.hwid,
            "email": email or ""
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "GhostLens/3.0",
                "X-GhostLens-Hwid": self.hwid
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", "ignore")

        try:
            return json.loads(raw)
        except Exception:
            raise ValueError("Resposta inválida do servidor de licenças.")

    def verify_with_cloud(self, key, email=""):
        """
        Consulta os servidores de licença em ordem.
        Retorna (True, license, msg) | (False, None, msg) | (None, None, msg).
        """
        last_error = None
        for url in _activation_urls():
            try:
                data = self._post_activation(url, key, email)
            except urllib.error.HTTPError as e:
                if e.code >= 500:
                    last_error = f"HTTP {e.code}"
                    continue
                # 4xx é resposta definitiva; não tenta o próximo host.
                try:
                    err = json.loads(e.read().decode("utf-8", "ignore"))
                except Exception:
                    err = {}
                error_code = err.get("error") or "license_not_found"
                return False, None, _ERROR_MESSAGES.get(error_code, "Licença recusada.")
            except Exception as e:
                last_error = str(e)
                continue

            if not data.get("success"):
                error_code = data.get("error") or "license_not_found"
                return False, None, _ERROR_MESSAGES.get(error_code, "Licença recusada.")

            lic = data.get("license") or {}
            if not lic.get("key"):
                return False, None, "Resposta inválida do servidor de licenças."

            bound = str(lic.get("target_hwid") or "").upper()
            if bound and bound != self.hwid.upper():
                return False, None, _ERROR_MESSAGES["hwid_mismatch"]

            return True, lic, data.get("message") or "Licença validada."

        sys.stderr.write(f"[GhostGuard] Servidores de licença inacessíveis: {last_error}\n")
        return None, None, _ERROR_MESSAGES["license_backend_unavailable"]

    def activate_license(self, license_key, email="cliente@ghostlens.cloud"):
        """Ativa uma chave consultando o servidor central. Falha fechada."""
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

            cloud_ok, lic, message = self.verify_with_cloud(key, email)
            if cloud_ok is not True:
                return {
                    "success": False,
                    "message": message,
                    "error": "license_rejected" if cloud_ok is False else "license_backend_unavailable"
                }

            try:
                expires_at = int(lic.get("expires_at"))
            except (TypeError, ValueError):
                return {
                    "success": False,
                    "message": "Resposta inválida do servidor de licenças.",
                    "error": "invalid_expiry"
                }

            if expires_at <= int(time.time()):
                return {
                    "success": False,
                    "message": _ERROR_MESSAGES["license_expired"],
                    "error": "license_expired"
                }

            self.license_data = {
                "key": key,
                "email": lic.get("email") or email,
                "plan": lic.get("plan") or "GhostLens",
                "hwid": self.hwid,
                "max_devices": int(lic.get("max_devices") or 1),
                "expires_at": expires_at,
                "status": "active",
                "verified_at": int(time.time())
            }
            self.save_license()
            self.is_active = True

            sys.stdout.write(f"[GhostGuard] ✓ Licença ativada: {self.license_data['plan']}\n")
            sys.stdout.flush()
            return {
                "success": True,
                "message": f"Licença ativada com sucesso! Plano: {self.license_data['plan']}",
                "data": self.license_data
            }

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
        """Valida HWID, status e expiração do arquivo local. Sem auto-ativação."""
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

            if data.get("status") != "active":
                self.license_data = data
                self.is_active = False
                return

            try:
                expires_at = int(data.get("expires_at", 0))
            except (TypeError, ValueError):
                expires_at = 0

            if expires_at <= int(time.time()):
                sys.stderr.write("[GhostGuard] ❌ Licença expirada.\n")
                self.license_data = data
                self.is_active = False
                return

            self.license_data = data
            self.is_active = True

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
        """Revalida o arquivo local a cada 60s; desliga o emulador se cair."""
        def sentinel():
            while True:
                time.sleep(60)
                was_active = self.is_active
                self.load_and_validate_license()
                if was_active and not self.is_active:
                    sys.stderr.write("[GhostGuard] ⚠️ Licença inválida. Bloqueando instâncias.\n")
                    try:
                        subprocess.run(
                            ["adb", "emu", "kill"],
                            capture_output=True,
                            timeout=5
                        )
                    except Exception:
                        pass

        t = threading.Thread(target=sentinel, daemon=True)
        t.start()
        self.heartbeat_thread = t

    def get_status(self):
        with self.lock:
            return {
                "active": self.is_active,
                "hwid": self.hwid,
                "email": self.license_data.get("email") if self.license_data else None,
                "plan": self.license_data.get("plan") if self.license_data else "Não Ativado",
                "max_devices": self.license_data.get("max_devices") if self.license_data else 0,
                "expires_at": self.license_data.get("expires_at") if self.license_data else 0,
                "status": "authorized" if self.is_active else "unauthorized"
            }


auth_guard = GhostAuthGuard()


if __name__ == "__main__":
    print("=== [GHOSTLENS AUTH GUARD 3.0] ===")
    print("HWID:", auth_guard.hwid)
    print("Admin token file:", ADMIN_TOKEN_FILE)
    print("Status:", json.dumps(auth_guard.get_status(), indent=2))
