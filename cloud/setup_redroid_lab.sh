#!/usr/bin/env bash
# ============================================================================
# GhostDroid LAB — sobe UM Redroid ARM64 para validação técnica
#
# Uso (Ubuntu ARM64, Oracle Ampere ou VM Linux ARM64):
#   sudo bash cloud/setup_redroid_lab.sh
#
# Baseline sem GApps:
#   REDROID_IMAGE=redroid/redroid:12.0.0_64only-latest sudo -E bash cloud/setup_redroid_lab.sh
#
# ATENÇÃO: a imagem padrão com GApps é de terceiros. Audite antes de produção.
# Nunca exponha a porta 5555/ADB na internet sem VPN/SSH tunnel.
# ============================================================================
set -euo pipefail

IMAGE="${REDROID_IMAGE:-hrtrex/redroid:12.0.0_arm64-latest}"
CONTAINER="${REDROID_CONTAINER:-ghostdroid_lab}"
DATA_DIR="${REDROID_DATA_DIR:-/opt/ghostlens/lab/ghostdroid_01}"
MEMORY="${REDROID_MEMORY:-3g}"
CPUS="${REDROID_CPUS:-2}"
PORT="${REDROID_PORT:-5555}"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "============================================================"
echo " GhostDroid LAB — validação Redroid ARM64"
echo " Imagem: $IMAGE"
echo " Container: $CONTAINER"
echo " Dados: $DATA_DIR"
echo "============================================================"

# 1. Arquitetura
ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "❌ Este script é para Linux ARM64. Detectado: $ARCH"
  echo "   Redroid _64only ARM64 não roda em x86_64."
  exit 1
fi
echo "✓ Arquitetura: $ARCH"

# 2. cgroup v1 (Redroid exige)
CGROUP_TYPE="$(stat -fc %T /sys/fs/cgroup 2>/dev/null || true)"
if [ "$CGROUP_TYPE" = "cgroup2fs" ] || [ ! -d /sys/fs/cgroup/memory ]; then
  cat <<'EOF'
❌ cgroup v1 não está ativo. O Redroid precisa do controlador memory v1.
   No Ubuntu 22.04/24.04:
     1) Edite /etc/default/grub e adicione systemd.unified_cgroup_hierarchy=0
        em GRUB_CMDLINE_LINUX_DEFAULT
     2) sudo update-grub
     3) sudo reboot
     4) Confirme: ls /sys/fs/cgroup/memory
   Depois rode este script novamente.
EOF
  exit 1
fi
echo "✓ cgroup v1 presente"

# 3. Dependências
echo "→ Instalando dependências (docker, adb, módulos de kernel)..."
$SUDO apt-get update -y
$SUDO apt-get install -y docker.io android-tools-adb "linux-modules-extra-$(uname -r)" || true

# 4. Binder
echo "→ Carregando binder_linux..."
if ! $SUDO modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null; then
  echo "❌ binder_linux não carregou. O kernel/instância pode não ter o módulo."
  echo "   Verifique: modinfo binder_linux"
  echo "   Em alguns kernels use binderfs ou uma imagem Ubuntu compatível."
  exit 1
fi
if [ -d /sys/module/binder_linux ]; then
  echo "✓ binder_linux carregado"
else
  echo "⚠️ binder_linux não aparece em /sys/module; verifique /dev/binder"
fi
echo 'binder_linux' | $SUDO tee /etc/modules-load.d/binder.conf >/dev/null
echo 'options binder_linux devices="binder,hwbinder,vndbinder"' | $SUDO tee /etc/modprobe.d/binder.conf >/dev/null

# 5. Docker
$SUDO systemctl enable --now docker
$SUDO docker info >/dev/null
echo "✓ Docker ativo"

# 6. Imagem
echo "→ Baixando imagem $IMAGE ..."
$SUDO docker pull "$IMAGE"

# 7. Container
$SUDO mkdir -p "$DATA_DIR"
$SUDO docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "→ Subindo $CONTAINER (RAM=$MEMORY, CPUs=$CPUS, porta 127.0.0.1:$PORT)..."
$SUDO docker run -d \
  --name "$CONTAINER" \
  --privileged \
  --restart unless-stopped \
  --memory="$MEMORY" \
  --cpus="$CPUS" \
  -v "$DATA_DIR:/data" \
  -p "127.0.0.1:${PORT}:5555" \
  "$IMAGE" \
  androidboot.hardware=redroid \
  androidboot.redroid_width=720 \
  androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=320 \
  androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest \
  androidboot.use_memfd=1

# 8. ADB
echo "→ Conectando ADB em 127.0.0.1:$PORT ..."
adb start-server >/dev/null 2>&1 || true
adb connect "127.0.0.1:${PORT}" || true
for i in $(seq 1 60); do
  STATE="$(adb -s "127.0.0.1:${PORT}" get-state 2>/dev/null || true)"
  if [ "$STATE" = "device" ]; then break; fi
  sleep 2
done
echo
adb devices -l || true
echo
echo "============================================================"
echo " Container: $CONTAINER"
echo " ADB:       adb -s 127.0.0.1:${PORT} shell"
echo " Logs:      sudo docker logs -f $CONTAINER"
echo " Stats:     sudo docker stats --no-stream $CONTAINER"
echo " Parar:     sudo docker stop $CONTAINER"
echo " Iniciar:   sudo docker start $CONTAINER"
echo " Dados:     $DATA_DIR"
echo "============================================================"
echo "TESTES:"
echo "  adb -s 127.0.0.1:${PORT} shell getprop ro.build.version.release"
echo "  adb -s 127.0.0.1:${PORT} shell getprop sys.boot_completed"
echo "  adb -s 127.0.0.1:${PORT} shell settings get secure android_id"
echo "  free -h"
echo "  sudo docker stats --no-stream"
echo
if [ -n "$LAN_IP" ]; then
  echo "⚠️ A porta está ligada somente em 127.0.0.1. Para acessar de fora, use SSH tunnel/VPN:"
  echo "   ssh -L ${PORT}:127.0.0.1:${PORT} ubuntu@${LAN_IP}"
fi
echo "⚠️ Imagem de terceiros: audite antes de produção. GApps/Play Integrity podem falhar."
