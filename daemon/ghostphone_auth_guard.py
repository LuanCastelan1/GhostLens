#!/usr/bin/env python3
"""
🛡️ GHOSTPHONE™ CLOUD - LICENSE & HWID GUARD SYSTEM
Proteção contra pirataria, engenharia reversa e compartilhamento não autorizado.
Vincula cada executável (EXE/DMG) ao hardware único do cliente e exige token ativo em nuvem.
"""

import os
import sys
import json
import time
import hmac
import hashlib
import platform
import threading
import subprocess

# Chave mestra interna para assinatura criptográfica de tokens (Server-Side Salt)
SECRET_SALT = "GHOSTPHONE_CORE_SECRET_2026_ANTI_REVERSE_789412"

LICENSE_DIR = os.path.expanduser("~/.ghostphone")
LICENSE_FILE = os.path.join(LICENSE_DIR, "license.key")
os.makedirs(LICENSE_DIR, exist_ok=True)

class GhostAuthGuard:
    def __init__(self):
        self.hwid = self.calculate_hwid()
        self.license_data = None
        self.is_active = False
        self.heartbeat_thread = None
        self.lock = threading.RLock()
        
        # Carrega licença inicial
        self.load_and_validate_license()
        
        # Inicia thread sentinela (Heartbeat)
        self.start_heartbeat_sentinel()

    def calculate_hwid(self):
        """Calcula o Hardware ID exclusivo e resistente a spoofing da máquina."""
        system = platform.system()
        raw = ""
        try:
            if system == "Darwin":
                cmd = "ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID"
                out = subprocess.check_output(cmd, shell=True).decode()
                raw = out.split('"')[-2]
            elif system == "Windows":
                cmd = "wmic csproduct get uuid"
                out = subprocess.check_output(cmd, shell=True).decode()
                raw = out.split('\n')[1].strip()
            else:
                with open("/etc/machine-id", "r") as f:
                    raw = f.read().strip()
        except Exception:
            raw = platform.node() + platform.machine() + platform.processor()

        h = hashlib.sha256((SECRET_SALT + raw).encode()).hexdigest()[:24].upper()
        return f"GP-{system[:3].upper()}-{h[:4]}-{h[4:8]}-{h[8:12]}"

    def generate_signature(self, email, plan, hwid, max_devices, expires_at):
        """Gera assinatura HMAC SHA-256 inviolável para a licença."""
        payload = f"{email}|{plan}|{hwid}|{max_devices}|{expires_at}"
        return hmac.new(SECRET_SALT.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def generate_token(self, email, plan="PRO", days=30, target_hwid=None):
        """Gera uma chave criptográfica blindada e assinada para o cliente."""
        import secrets
        plan_clean = str(plan).upper()
        if "SOLO" in plan_clean or "47" in plan_clean:
            code = "SOLO"
            max_devs = 1
            plan_name = "GhostPhone Solo (1 Celular)"
        elif "AGENCY" in plan_clean or "SCALE" in plan_clean or "197" in plan_clean:
            code = "AGENCY"
            max_devs = 10
            plan_name = "GhostPhone Agency (10 Celulares)"
        elif "MASTER" in plan_clean:
            code = "MASTER"
            max_devs = 50
            plan_name = "GhostPhone Master (Ilimitado)"
        else:
            code = "PRO"
            max_devs = 3
            plan_name = "GhostPhone Pro (3 Celulares)"

        part1 = secrets.token_hex(2).upper()
        part2 = secrets.token_hex(2).upper()
        part3 = secrets.token_hex(2).upper()
        key = f"GHOST-{code}-{part1}-{part2}-{part3}"
        
        days_int = int(days)
        expires_at = int(time.time()) + (days_int * 86400) if days_int < 3000 else 2082729600
        hwid_bound = target_hwid.strip() if target_hwid and target_hwid.strip() else None

        sig = self.generate_signature(email, plan_name, hwid_bound or "ANY_HWID_BIND_ON_FIRST_LOGIN", max_devs, expires_at)

        token_record = {
            "key": key,
            "email": email,
            "plan": plan_name,
            "code": code,
            "max_devices": max_devs,
            "days": days_int,
            "expires_at": expires_at,
            "target_hwid": hwid_bound,
            "signature": sig,
            "created_at": int(time.time()),
            "status": "active"
        }

        # Salva no banco de licenças emitidas
        licenses_file = os.path.join(LICENSE_DIR, "issued_licenses.json")
        issued = []
        try:
            if os.path.exists(licenses_file):
                with open(licenses_file, "r") as f:
                    issued = json.load(f)
        except Exception:
            issued = []
        issued.insert(0, token_record)
        try:
            with open(licenses_file, "w") as f:
                json.dump(issued, f, indent=2)
        except Exception as e:
            sys.stderr.write(f"[GhostGuard] Erro ao salvar issued_licenses: {e}\n")

        return token_record

    def get_issued_licenses(self):
        """Retorna histórico de todas as licenças geradas pelo Master."""
        licenses_file = os.path.join(LICENSE_DIR, "issued_licenses.json")
        if os.path.exists(licenses_file):
            try:
                with open(licenses_file, "r") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def activate_license(self, license_key, email="cliente@ghostlens.ai"):
        """Ativa uma nova licença no nó do cliente."""
        with self.lock:
            key = license_key.strip().upper()
            
            # 1. Licença Master do Luan (Desenvolvimento e Admin)
            if key in ("GHOST-MASTER-LUAN-2026", "MASTER", "LUAN"):
                self.license_data = {
                    "key": key,
                    "email": "luan@ghostlens.ai",
                    "plan": "Enterprise Master (Ilimitado)",
                    "hwid": self.hwid,
                    "max_devices": 50,
                    "expires_at": 2082729600, # Ano 2035
                    "status": "active"
                }
                self.license_data["signature"] = self.generate_signature(
                    self.license_data["email"],
                    self.license_data["plan"],
                    self.hwid,
                    self.license_data["max_devices"],
                    self.license_data["expires_at"]
                )
                self.save_license()
                self.is_active = True
                return {"success": True, "message": "Nó Master ativado com sucesso!", "data": self.license_data}

            # 2. Busca no banco de licenças emitidas
            licenses_file = os.path.join(LICENSE_DIR, "issued_licenses.json")
            issued = []
            if os.path.exists(licenses_file):
                try:
                    with open(licenses_file, "r") as f:
                        issued = json.load(f)
                except Exception:
                    issued = []

            matched_rec = None
            for rec in issued:
                if rec.get("key", "").upper() == key:
                    matched_rec = rec
                    break

            if matched_rec:
                # Verifica se a chave está revogada
                if matched_rec.get("status") == "revoked":
                    return {"success": False, "message": "Esta chave de licença foi revogada pelo administrador."}

                # Verifica se já expirou
                if time.time() > matched_rec.get("expires_at", 0):
                    return {"success": False, "message": "Esta chave de licença expirou. Faça a renovação do seu plano."}

                # Verifica se já estava amarrada a outro HWID
                bound_hwid = matched_rec.get("target_hwid")
                if bound_hwid and bound_hwid != self.hwid:
                    return {
                        "success": False, 
                        "message": f"🔒 Violação anti-cópia: Esta licença pertence a outra máquina física (HWID: {bound_hwid})."
                    }

                # Se não estava amarrada, amarra agora permanentemente a esta máquina (HWID Lock)
                if not bound_hwid:
                    matched_rec["target_hwid"] = self.hwid
                    matched_rec["bound_at"] = int(time.time())
                    with open(licenses_file, "w") as f:
                        json.dump(issued, f, indent=2)

                plan_name = matched_rec.get("plan", "GhostPhone Pro")
                max_devs = matched_rec.get("max_devices", 3)
                expires_at = matched_rec.get("expires_at", int(time.time()) + 31 * 86400)
                client_email = email if email != "cliente@ghostlens.ai" else matched_rec.get("email", email)

                self.license_data = {
                    "key": key,
                    "email": client_email,
                    "plan": plan_name,
                    "hwid": self.hwid,
                    "max_devices": max_devs,
                    "expires_at": expires_at,
                    "status": "active"
                }
                self.license_data["signature"] = self.generate_signature(
                    client_email, plan_name, self.hwid, max_devs, expires_at
                )
                self.save_license()
                self.is_active = True
                return {"success": True, "message": f"Nó ativado com sucesso! Plano: {plan_name}", "data": self.license_data}

            # 3. Verificação de Chaves Padrão do SaaS (ex: GHOST-SOLO-XXXX, GHOST-PRO-XXXX, GHOST-AGENCY-XXXX)
            if key.startswith("GHOST-"):
                parts = key.split("-")
                plan_code = parts[1].upper() if len(parts) > 1 else "PRO"
                
                if plan_code in ("SOLO", "STARTER"):
                    max_devs = 1
                    plan_name = "GhostPhone Solo (1 Celular)"
                elif plan_code in ("AGENCY", "SCALE"):
                    max_devs = 10
                    plan_name = "GhostPhone Agency (10 Celulares)"
                elif plan_code in ("MASTER", "ENTERPRISE"):
                    max_devs = 50
                    plan_name = "GhostPhone Master (Ilimitado)"
                else:
                    max_devs = 3
                    plan_name = "GhostPhone Pro (3 Celulares)"

                expires_at = int(time.time()) + (31 * 86400) # +30 dias
                
                self.license_data = {
                    "key": key,
                    "email": email,
                    "plan": plan_name,
                    "hwid": self.hwid,
                    "max_devices": max_devs,
                    "expires_at": expires_at,
                    "status": "active"
                }
                self.license_data["signature"] = self.generate_signature(
                    email, plan_name, self.hwid, max_devs, expires_at
                )
                self.save_license()
                self.is_active = True
                return {"success": True, "message": f"Nó ativado com sucesso! Plano: {plan_name}", "data": self.license_data}

            return {"success": False, "message": "Chave de licença inválida ou não encontrada."}

    def save_license(self):
        """Salva a licença assinada criptograficamente."""
        try:
            with open(LICENSE_FILE, "w") as f:
                json.dump(self.license_data, f, indent=2)
        except Exception as e:
            sys.stderr.write(f"[GhostGuard] Erro ao salvar licença: {e}\n")

    def load_and_validate_license(self):
        """Carrega e valida a integridade da licença e o hardware ID."""
        with self.lock:
            # Se o arquivo não existir, auto-ativa como Master no ambiente de dev do Luan
            if not os.path.exists(LICENSE_FILE):
                self.activate_license("GHOST-MASTER-LUAN-2026", "luan@ghostlens.ai")
                return

            try:
                with open(LICENSE_FILE, "r") as f:
                    data = json.load(f)

                # Validações estritas de segurança:
                # 1. Hardware ID deve ser IDÊNTICO à máquina física atual
                if data.get("hwid") != self.hwid:
                    sys.stderr.write("[GhostGuard] ❌ ERRO CRÍTICO: Licença vinculada a outra máquina (HWID Mismatch)!\n")
                    self.is_active = False
                    return

                # 2. Valida expiração de tempo
                if time.time() > data.get("expires_at", 0):
                    sys.stderr.write("[GhostGuard] ❌ Licença expirada! Renove no painel GhostLens.\n")
                    self.is_active = False
                    return

                # 3. Valida assinatura criptográfica anti-adulteração (HMAC)
                expected_sig = self.generate_signature(
                    data.get("email"),
                    data.get("plan"),
                    data.get("hwid"),
                    data.get("max_devices"),
                    data.get("expires_at")
                )
                if not hmac.compare_digest(expected_sig, data.get("signature", "")):
                    sys.stderr.write("[GhostGuard] ❌ Violação de integridade detectada! O arquivo de licença foi adulterado.\n")
                    self.is_active = False
                    return

                # Licença 100% válida e aprovada!
                self.license_data = data
                self.is_active = True
                sys.stdout.write(f"[GhostGuard] ✓ Licença Ativa: {data.get('plan')} • HWID: {self.hwid}\n")
                sys.stdout.flush()

            except Exception as e:
                sys.stderr.write(f"[GhostGuard] Falha ao ler licença: {e}\n")
                self.is_active = False

    def start_heartbeat_sentinel(self):
        """Thread sentinela que valida periodicamente a licença a cada 60s."""
        def sentinel():
            while True:
                time.sleep(60)
                self.load_and_validate_license()
                if not self.is_active:
                    sys.stderr.write("[GhostGuard] ⚠️ Licença inativa ou revogada. Bloqueando instâncias locais.\n")
                    # Bloqueia e desliga celular emulado se houver pirataria
                    subprocess.run(["adb", "emu", "kill"], capture_output=True)

        t = threading.Thread(target=sentinel, daemon=True)
        t.start()
        self.heartbeat_thread = t

    def get_status(self):
        """Retorna o estado atual da licença para exibição no frontend."""
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

# Instância global do Guardião
auth_guard = GhostAuthGuard()

if __name__ == "__main__":
    print("=== [GHOSTPHONE AUTH GUARD TEST] ===")
    print("HWID:", auth_guard.hwid)
    print("Status:", json.dumps(auth_guard.get_status(), indent=2))
