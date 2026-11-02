#!/usr/bin/env python3
"""
Migra as licenças emitidas localmente (~/.ghostphone/issued_licenses.json)
para public.ghost_licenses no Supabase.

Uso:
  export SUPABASE_URL=https://mbelyevitfksmknlyhgr.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...
  python3 tools/migrate_issued_licenses.py [caminho/issued_licenses.json]

O script NÃO imprime chaves completas nem e-mails. Chaves já existentes no
banco são ignoradas (idempotente).
"""

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for candidate in (os.environ.get("SSL_CERT_FILE"), "/etc/ssl/cert.pem"):
        if candidate and os.path.exists(candidate):
            try:
                return ssl.create_default_context(cafile=candidate)
            except Exception:
                pass
    return ssl.create_default_context()


SSL_CONTEXT = _ssl_context()

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "https://mbelyevitfksmknlyhgr.supabase.co").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SOURCE = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.ghostphone/issued_licenses.json")


def api(path, method="GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=data,
        method=method,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(req, timeout=20, context=SSL_CONTEXT) as resp:
        raw = resp.read().decode("utf-8", "ignore")
    return json.loads(raw) if raw else None


def mask(key):
    key = str(key or "")
    return f"{key[:11]}…{key[-4:]}" if len(key) > 16 else "…"


def to_iso(value):
    if value is None:
        return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    return str(value)


def main():
    if not SERVICE_KEY:
        print("❌ Defina SUPABASE_SERVICE_ROLE_KEY no ambiente.")
        return 1

    if not os.path.exists(SOURCE):
        print(f"❌ Arquivo não encontrado: {SOURCE}")
        return 1

    with open(SOURCE, "r", encoding="utf-8") as f:
        records = json.load(f)

    if not isinstance(records, list):
        print("❌ Formato inesperado: esperado uma lista JSON.")
        return 1

    imported = 0
    skipped = 0
    failed = 0

    for rec in records:
        key = str(rec.get("key") or "").strip().upper()
        if not key:
            skipped += 1
            continue

        try:
            existing = api(f"ghost_licenses?key=eq.{urllib.parse.quote(key)}&select=key")
            if existing:
                print(f"↷ já existe: {mask(key)}")
                skipped += 1
                continue

            payload = [{
                "key": key,
                "email": rec.get("email") or "",
                "plan": rec.get("plan") or "GhostLens",
                "code": (rec.get("code") or "PRO").upper(),
                "max_devices": int(rec.get("max_devices") or 1),
                "provider": "manual",
                "target_hwid": rec.get("target_hwid") or None,
                "status": "revoked" if rec.get("status") == "revoked" else "active",
                "expires_at": to_iso(rec.get("expires_at")),
            }]
            api("ghost_licenses", "POST", payload)
            print(f"✓ importada: {mask(key)}")
            imported += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")[:200]
            print(f"❌ falha em {mask(key)}: HTTP {e.code} {body}")
            failed += 1
        except Exception as e:
            print(f"❌ falha em {mask(key)}: {e}")
            failed += 1

    print(f"\nResumo: {imported} importadas, {skipped} ignoradas, {failed} falhas.")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
