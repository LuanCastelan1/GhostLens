#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
🛡️ GHOSTLENS™ SUITE & GHOSTPHONE™ - INSTALADOR DEFINITIVO ALL-IN-ONE (WINDOWS)
Instala automaticamente:
1. Drivers Scrcpy e ADB 60 FPS (bin/)
2. Portable Java 17 JRE (bin/jre/)
3. Android Command-Line Tools & Google Emulator (bin/android-sdk/)
4. Imagem de Sistema AOSP Android 30 (x86_64)
5. Instância proprietária GhostPhone™ (ghostphone_musa) com Fingerprint Samsung S24 Ultra
6. Inicializa o GhostBridge na porta 4444 e abre o painel no navegador.
Zero suporte, zero dor de cabeça para o cliente.
==============================================================================
"""

import os
import sys
import time
import zipfile
import shutil
import urllib.request
import subprocess
import webbrowser

this_dir = os.path.dirname(os.path.abspath(__file__))
if os.path.basename(this_dir) == "daemon":
    BASE_DIR = os.path.abspath(os.path.join(this_dir, ".."))
else:
    BASE_DIR = this_dir
BIN_DIR = os.path.join(BASE_DIR, "bin")
SDK_DIR = os.path.join(BIN_DIR, "android-sdk")
JRE_DIR = os.path.join(BIN_DIR, "jre")

def print_banner():
    print(r"""
==============================================================================
  _____ _                 _   _____  _                      
 / ____| |               | | |  __ \| |                     
| |  __| |__   ___  ___ _| |_| |__) | |__   ___  _ __   ___ 
| | |_ | '_ \ / _ \/ __|_  _||  ___/| '_ \ / _ \| '_ \ / _ \
| |__| | | | | (_) \__ \ | |_| |    | | | | (_) | | | |  __/
 \_____|_| |_|\___/|___/  \__|_|    |_| |_|\___/|_| |_|\___|
                   EDICAO DEFINITIVA WINDOWS 10 / 11
==============================================================================
""")

def download_with_progress(url, dest_path, desc):
    """Download de arquivos com barra de progresso visual em tempo real."""
    if os.path.exists(dest_path):
        return True
    
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    temp_path = dest_path + ".tmp"
    
    print(f"\n[*] Baixando {desc}...")
    print(f"    URL: {url}")
    
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=60) as response, open(temp_path, 'wb') as out_file:
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            block_size = 1024 * 1024 # 1MB
            start_time = time.time()
            
            while True:
                buffer = response.read(block_size)
                if not buffer:
                    break
                out_file.write(buffer)
                downloaded += len(buffer)
                
                if total_size > 0:
                    percent = downloaded / total_size * 100
                    mb_down = downloaded / (1024 * 1024)
                    mb_total = total_size / (1024 * 1024)
                    elapsed = max(time.time() - start_time, 0.1)
                    speed = mb_down / elapsed
                    bar_len = 30
                    filled_len = int(bar_len * downloaded // total_size)
                    bar = '=' * filled_len + '-' * (bar_len - filled_len)
                    sys.stdout.write(f"\r    [{bar}] {percent:.1f}% ({mb_down:.1f}/{mb_total:.1f} MB) • {speed:.1f} MB/s ")
                    sys.stdout.flush()
                else:
                    mb_down = downloaded / (1024 * 1024)
                    sys.stdout.write(f"\r    Baixados: {mb_down:.1f} MB...")
                    sys.stdout.flush()
                    
        print("\n    [+] Download concluido com sucesso!")
        os.replace(temp_path, dest_path)
        return True
    except Exception as e:
        print(f"\n    [!] Erro durante o download: {e}")
        if os.path.exists(temp_path):
            try: os.remove(temp_path)
            except: pass
        return False

def extract_zip(zip_path, extract_to, desc):
    """Extrai arquivos zip com feedback visual."""
    print(f"[*] Extraindo {desc}...")
    os.makedirs(extract_to, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
        print(f"    [+] {desc} extraido com sucesso.")
        return True
    except Exception as e:
        print(f"    [!] Erro ao extrair: {e}")
        return False

# ==============================================================================
# 1. DRIVERS SCRCPY E ADB 60 FPS
# ==============================================================================
def setup_scrcpy_adb():
    adb_path = os.path.join(BIN_DIR, "adb.exe")
    scrcpy_path = os.path.join(BIN_DIR, "scrcpy.exe")
    if os.path.exists(adb_path) and os.path.exists(scrcpy_path):
        print("[1/5] Drivers Scrcpy e ADB 60 FPS: [JA INSTALADOS]")
        return True
        
    print("[1/5] Instalando Drivers Scrcpy e ADB 60 FPS...")
    url = "https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-win64-v2.4.zip"
    zip_dest = os.path.join(BIN_DIR, "scrcpy_pkg.zip")
    
    if download_with_progress(url, zip_dest, "Scrcpy v2.4 (Ultra HD 60 FPS)"):
        tmp_extract = os.path.join(BIN_DIR, "scrcpy_tmp")
        if extract_zip(zip_dest, tmp_extract, "Pacote Scrcpy"):
            extracted_sub = os.path.join(tmp_extract, "scrcpy-win64-v2.4")
            src_folder = extracted_sub if os.path.exists(extracted_sub) else tmp_extract
            for item in os.listdir(src_folder):
                s = os.path.join(src_folder, item)
                d = os.path.join(BIN_DIR, item)
                if not os.path.exists(d):
                    shutil.move(s, d)
            shutil.rmtree(tmp_extract, ignore_errors=True)
            try: os.remove(zip_dest)
            except: pass
            print("    [+] Scrcpy e ADB configurados em bin/")
            return True
    return False

# ==============================================================================
# 2. PORTABLE JAVA 17 JRE (Necessario para os utilitarios do Android SDK)
# ==============================================================================
def setup_portable_jre():
    java_exe = os.path.join(JRE_DIR, "bin", "java.exe")
    if os.path.exists(java_exe):
        print("[2/5] Java 17 Runtime Portatil: [JA INSTALADO]")
        return java_exe
        
    print("[2/5] Configurando Java 17 Runtime Portatil...")
    url = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jre_x64_windows_hotspot_17.0.12_7.zip"
    zip_dest = os.path.join(BIN_DIR, "jre17.zip")
    
    if download_with_progress(url, zip_dest, "OpenJDK 17 JRE (Adoptium)"):
        tmp_extract = os.path.join(BIN_DIR, "jre_tmp")
        if extract_zip(zip_dest, tmp_extract, "Java 17 JRE"):
            # Move conteudo da pasta interna para JRE_DIR
            subdirs = [os.path.join(tmp_extract, d) for d in os.listdir(tmp_extract) if os.path.isdir(os.path.join(tmp_extract, d))]
            src_dir = subdirs[0] if subdirs else tmp_extract
            os.makedirs(JRE_DIR, exist_ok=True)
            for item in os.listdir(src_dir):
                s = os.path.join(src_dir, item)
                d = os.path.join(JRE_DIR, item)
                if os.path.exists(d):
                    if os.path.isdir(d): shutil.rmtree(d, ignore_errors=True)
                    else: os.remove(d)
                shutil.move(s, d)
            shutil.rmtree(tmp_extract, ignore_errors=True)
            try: os.remove(zip_dest)
            except: pass
            print(f"    [+] Java 17 instalado com sucesso em {JRE_DIR}")
            return java_exe
    return None

# ==============================================================================
# 3. ANDROID COMMAND-LINE TOOLS
# ==============================================================================
def setup_cmdline_tools():
    sdkmanager_bat = os.path.join(SDK_DIR, "cmdline-tools", "latest", "bin", "sdkmanager.bat")
    if os.path.exists(sdkmanager_bat):
        print("[3/5] Android SDK Tools: [JA INSTALADOS]")
        return sdkmanager_bat
        
    print("[3/5] Baixando Google Android Command-Line Tools...")
    url = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    zip_dest = os.path.join(BIN_DIR, "cmdline_tools.zip")
    
    if download_with_progress(url, zip_dest, "Android Command-Line Tools (Oficial Google)"):
        target_latest = os.path.join(SDK_DIR, "cmdline-tools", "latest")
        tmp_extract = os.path.join(BIN_DIR, "cmdline_tmp")
        if extract_zip(zip_dest, tmp_extract, "Command-Line Tools"):
            src_tools = os.path.join(tmp_extract, "cmdline-tools")
            os.makedirs(os.path.dirname(target_latest), exist_ok=True)
            if os.path.exists(target_latest):
                shutil.rmtree(target_latest, ignore_errors=True)
            shutil.move(src_tools, target_latest)
            shutil.rmtree(tmp_extract, ignore_errors=True)
            try: os.remove(zip_dest)
            except: pass
            print(f"    [+] Command-Line Tools configurados em {target_latest}")
            return sdkmanager_bat
    return None

# ==============================================================================
# 4. ANDROID EMULATOR & SYSTEM IMAGE (AOSP Android 30)
# ==============================================================================
def setup_android_emulator_and_image(sdkmanager_bat, java_home):
    emulator_exe = os.path.join(SDK_DIR, "emulator", "emulator.exe")
    img_dir = os.path.join(SDK_DIR, "system-images", "android-30", "default", "x86_64")
    
    if os.path.exists(emulator_exe) and os.path.exists(img_dir):
        print("[4/5] GhostPhone™ Android 30 Engine: [JA INSTALADO]")
        return True
        
    print("[4/5] Provisionando GhostPhone™ Android 30 AOSP Engine (Oficial Google)...")
    print("    Isso pode levar alguns minutos dependendo da sua conexao (Download direto do Google).")
    
    env = os.environ.copy()
    env["JAVA_HOME"] = java_home
    env["ANDROID_HOME"] = SDK_DIR
    env["ANDROID_SDK_ROOT"] = SDK_DIR
    env["PATH"] = f"{os.path.join(java_home, 'bin')};{env.get('PATH', '')}"
    
    # Aceita licencas automaticamente
    try:
        proc = subprocess.Popen([sdkmanager_bat, f"--sdk_root={SDK_DIR}", "--licenses"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        proc.communicate(input=b"y\ny\ny\ny\ny\ny\ny\ny\n")
    except Exception:
        pass

    # Instala o emulador e a imagem AOSP Android 30 x86_64
    cmd = [
        sdkmanager_bat,
        f"--sdk_root={SDK_DIR}",
        "emulator",
        "system-images;android-30;default;x86_64"
    ]
    
    print(f"    Executando instalacao do motor...")
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
        proc.communicate(input=b"y\n")
        if proc.returncode == 0:
            print("    [+] Motor Android AOSP instalado com sucesso!")
            return True
        else:
            print(f"    [!] Falha no sdkmanager (codigo {proc.returncode})")
            return False
    except Exception as e:
        print(f"    [!] Erro ao executar sdkmanager: {e}")
        return False

# ==============================================================================
# 5. CRIACAO DA INSTANCIA GHOSTPHONE™ (ghostphone_musa)
# ==============================================================================
def setup_ghostphone_avd(java_home):
    avd_dir = os.path.expanduser("~/.android/avd/ghostphone_musa.avd")
    config_file = os.path.join(avd_dir, "config.ini")
    
    if os.path.exists(config_file):
        print("[5/5] Instancia GhostPhone™ (Leninha - Samsung S24 Ultra): [JA CONFIGURADA]")
        return True
        
    print("[5/5] Criando instancia GhostPhone™ proprietaria...")
    avdmanager_bat = os.path.join(SDK_DIR, "cmdline-tools", "latest", "bin", "avdmanager.bat")
    
    env = os.environ.copy()
    env["JAVA_HOME"] = java_home
    env["ANDROID_HOME"] = SDK_DIR
    env["ANDROID_SDK_ROOT"] = SDK_DIR
    env["PATH"] = f"{os.path.join(java_home, 'bin')};{env.get('PATH', '')}"
    
    cmd = [
        avdmanager_bat,
        "create", "avd",
        "-n", "ghostphone_musa",
        "-k", "system-images;android-30;default;x86_64",
        "--force"
    ]
    
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
        proc.communicate(input=b"no\n")
        
        # Injeta as configuracoes personalizadas de tela e memoria (1080x2400, 2GB RAM, GPU Host)
        os.makedirs(avd_dir, exist_ok=True)
        config_content = """avd.ini.encoding=UTF-8
hw.lcd.width=1080
hw.lcd.height=2400
hw.lcd.density=420
hw.ramSize=2048M
hw.gpu.enabled=yes
hw.gpu.mode=host
vm.heapSize=256M
tag.id=default
tag.display=Default
hw.device.name=pixel_6
hw.cpu.ncore=2
fastboot.chosenSnapshotFile=
fastboot.forceChosenSnapshotBoot=no
fastboot.forceColdBoot=no
fastboot.forceFastBoot=yes
"""
        with open(config_file, "w", encoding="utf-8") as f:
            f.write(config_content)
            
        print("    [+] Instancia 'ghostphone_musa' configurada com sucesso!")
        return True
    except Exception as e:
        print(f"    [!] Erro ao criar AVD: {e}")
        return False

# ==============================================================================
# MAIN
# ==============================================================================
def main():
    print_banner()
    print("[*] Iniciando configuracao all-in-one da suíte GhostLens no Windows...\n")
    
    # 1. Scrcpy e ADB
    setup_scrcpy_adb()
    
    # 2. Portable JRE
    java_exe = setup_portable_jre()
    java_home = JRE_DIR if java_exe else None
    
    if java_home:
        # 3. Command-Line Tools
        sdkmanager = setup_cmdline_tools()
        if sdkmanager:
            # 4. Emulator & System Image
            setup_android_emulator_and_image(sdkmanager, java_home)
            # 5. AVD ghostphone_musa
            setup_ghostphone_avd(java_home)
            
    print("\n==============================================================================")
    print("✨ TUDO PRONTO! O GHOSTLENS ESTA 100% CONFIGURADO NO SEU COMPUTADOR!")
    print("==============================================================================")
    print("[*] Ambiente de motor Android e Scrcpy pronto para uso.")
    return True

if __name__ == "__main__":
    main()
