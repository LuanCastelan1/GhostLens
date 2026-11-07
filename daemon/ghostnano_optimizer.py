#!/usr/bin/env python3
"""
GhostNano Optimizer — Demonstração da "Fórmula Nano" no Android
Desativa serviços e daemons inúteis para marketing/contingência
e força a compactação de memória RAM.
"""

import subprocess
import time
import sys

PACKAGES_TO_STRIP = [
    # Chamadas e SMS tradicionais
    "com.android.dialer",
    "com.android.messaging",
    "com.android.mms.service",
    "com.android.server.telecom",
    
    # Calendário e relógio de mesa
    "com.android.calendar",
    "com.android.providers.calendar",
    "com.android.deskclock",
    
    # Mídia pesada e galeria antiga
    "com.android.gallery3d",
    "com.android.music",
    "com.android.musicfx",
    "com.android.wallpaper.livepicker",
    "com.android.dreams.basic",
    "com.android.dreams.phototable",
    
    # Impressão e periféricos físicos inexistentes
    "com.android.printspooler",
    "com.android.bips",
    "com.android.printservice.recommendation",
    "com.android.bluetooth",
    "com.android.bluetoothmidiservice",
    "com.android.nfc",
    "com.android.apps.tag",
    "com.android.se",
    
    # Multidisplay e emulação desnecessária
    "com.android.emulator.multidisplay",
    "com.android.traceur",
    "com.android.emergency",
    "com.android.quicksearchbox",
    "com.android.bookmarkprovider",
    "com.android.providers.partnerbookmarks",
    "com.android.hotspot2.osulogin",
    "com.android.service.ims",
    "com.android.service.ims.presence",
]

def run_adb(args):
    cmd = ["adb", "-s", "emulator-5554"] + args
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout.strip()

def get_ram_info():
    out = run_adb(["shell", "dumpsys", "meminfo"])
    used_kb = 0
    free_kb = 0
    total_kb = 0
    for line in out.splitlines():
        if "Used RAM:" in line:
            parts = line.split("Used RAM:")[1].split("(")[0].strip().replace("K", "").replace(",", "")
            used_kb = int(parts)
        elif "Free RAM:" in line:
            parts = line.split("Free RAM:")[1].split("(")[0].strip().replace("K", "").replace(",", "")
            free_kb = int(parts)
        elif "Total RAM:" in line:
            parts = line.split("Total RAM:")[1].split("(")[0].strip().replace("K", "").replace(",", "")
            total_kb = int(parts)
    return used_kb // 1024, free_kb // 1024, total_kb // 1024

def main():
    print("=" * 60)
    print(" 🚀 INICIANDO OTIMIZADOR GHOSTNANO (STRIP-DOWN)")
    print("=" * 60)
    
    used_before, free_before, total = get_ram_info()
    print(f"📊 RAM ANTES DA OTIMIZAÇÃO:")
    print(f"   • Total de RAM:  {total} MB")
    print(f"   • Usada pelo SO: {used_before} MB")
    print(f"   • Livre:         {free_before} MB")
    print("-" * 60)
    
    print("✂️  Desativando daemons e bloatware inúteis...")
    disabled_count = 0
    for pkg in PACKAGES_TO_STRIP:
        res = run_adb(["shell", "pm", "disable-user", "--user", "0", pkg])
        if "disabled" in res.lower() or "new state" in res.lower():
            disabled_count += 1
            print(f"   ✓ Desativado: {pkg}")
    
    print(f"\n⚡ Total de pacotes desativados: {disabled_count}")
    print("🧹 Executando compactação de memória e coleta de lixo (GC)...")
    
    # Forçar trim-memory em processos do sistema
    run_adb(["shell", "am", "trim-memory", "com.android.systemui", "COMPLETE"])
    run_adb(["shell", "am", "trim-memory", "com.android.launcher3", "COMPLETE"])
    
    # Dropar caches de disco do Linux
    run_adb(["shell", "su", "0", "echo 3 > /proc/sys/vm/drop_caches"])
    
    time.sleep(3)
    
    used_after, free_after, _ = get_ram_info()
    saved = used_before - used_after
    pct = (saved / used_before) * 100 if used_before > 0 else 0
    
    print("=" * 60)
    print(" 🎉 RESULTADO DA FÓRMULA NANO:")
    print(f"   • RAM Usada Antes:  {used_before} MB")
    print(f"   • RAM Usada Depois: {used_after} MB")
    print(f"   • RAM Economizada:  {saved} MB ({pct:.1f}% de redução no sistema)")
    print(f"   • RAM Livre Agora:  {free_after} MB")
    print("=" * 60)

if __name__ == "__main__":
    main()

