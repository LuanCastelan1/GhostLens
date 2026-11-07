# Laboratório GhostDroid — validação Redroid ARM64

Este documento é para **testar** a arquitetura antes de vender. Não é a landing page nem a grade final de planos.
Objetivo: medir memória, densidade, GApps/Play Integrity, Instagram/TikTok, Smart Standby e streaming.

---

## O que é real e o que é hype

| Afirmação do Gemini | Realidade |
|---|---|
| Android de 400 MB roda Instagram/TikTok | 400 MB é Android **idle**. Instagram exige Play Store/GMS; apps ativos usam **1–2 GB**. Sem GApps, o Instagram falha com “requires Google Play Store” (testado). |
| microG 30 MB passa na integridade | microG **não passa Play Integrity/atestado de hardware**. Pode enganar a checagem de pacote em alguns apps, mas não é garantia; Instagram/TikTok podem restringir login. |
| ZRAM 3:1 → 60–80 celulares em 64 GB | ZRAM comprime memória **ociosa**; apps ativos continuam consumindo CPU/RAM. 60–80 **simultâneos** é irreal; 60–80 **parados** talvez. CPU, banda e streaming limitam antes da RAM. |
| 1 celular vira 8–12 personas isoladas | Android suporta **1 Work Profile** por aparelho; multiusuário é opcional/limitado. Todos compartilham hardware, IP, sensores e fingerprint. **8–12 celulares isolados em 1 celular não existe.** |
| Smart Standby acorda em 2–3s no estado exato | Parar o container libera RAM, mas o boot Android leva **10–30s**. `/data` persistente mantém login/cookies; estado exato do app exige CRIU/snapshot, que é frágil com Android. |
| Custo de R$ 250–350/mês para 200 slots | 25 Solo + 20 Pro×5 + 5 Agency×15 = **200 slots**, não 15–20. Oracle Free tem 4 vCPUs/24 GB; não hospeda 200 celulares. O modelo precisa ser por **sessões simultâneas**. |

---

## O que vale testar

- Redroid **ARM64 nativo** em Linux ARM64 (Oracle Ampere ou VM Linux ARM64).
- Imagem oficial `redroid/redroid:12.0.0_64only-latest` para baseline de memória/boot.
- Imagem com **GApps** para Instagram: `hrtrex/redroid:12.0.0_arm64-latest` (terceiros; auditar) ou build próprio com MindTheGapps via `ayasa520/redroid-script`.
- Persistência de `/data`: login/cookies sobrevivem a stop/start.
- Smart Standby: medir stop/start, `pause` (RAM não zero) e snapshot/CRIU (opcional).
- ZRAM: medir RAM real de containers ociosos e impacto de CPU.

---

## Pré-requisitos

- Linux **ARM64** real (Oracle `VM.Standard.A1.Flex` ou VM Linux ARM64 no Mac).
- Ubuntu 22.04/24.04 LTS.
- **cgroup v1** habilitado (Redroid exige). Ubuntu 22.04 usa v2 por padrão.
- Módulo **binder_linux**.
- Docker.
- Acesso SSH; **não exponha ADB/porta 5555 na internet**.

### cgroup v1 no Ubuntu

Se `/sys/fs/cgroup` for `cgroup2fs`, adicione ao GRUB:

```
systemd.unified_cgroup_hierarchy=0
```

Exemplo:

```
sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="/GRUB_CMDLINE_LINUX_DEFAULT="systemd.unified_cgroup_hierarchy=0 /' /etc/default/grub
sudo update-grub
sudo reboot
```

Depois do reboot, confirme que existe `/sys/fs/cgroup/memory`.

### Binder

```
sudo apt update
sudo apt install -y linux-modules-extra-$(uname -r) docker.io android-tools-adb
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
echo 'binder_linux' | sudo tee /etc/modules-load.d/binder.conf
echo 'options binder_linux devices="binder,hwbinder,vndbinder"' | sudo tee /etc/modprobe.d/binder.conf
```

Em kernels ≥5.18, use `androidboot.use_memfd=1` em vez de `ashmem_linux`.

---

## Subir o primeiro container

Use o script `cloud/setup_redroid_lab.sh` (padrão: imagem com GApps de terceiros).
Para baseline sem GApps, mude `REDROID_IMAGE` para a imagem oficial:

```
REDROID_IMAGE=redroid/redroid:12.0.0_64only-latest sudo -E bash cloud/setup_redroid_lab.sh
```

O script:

- valida ARM64, cgroup v1, binder e Docker;
- baixa a imagem;
- sobe 1 container com 2 GB de RAM e 2 CPUs;
- liga a porta 5555 **somente em 127.0.0.1**;
- conecta o ADB;
- imprime os comandos de teste.

---

## Testes obrigatórios

### 1. Boot e memória

```
free -h
docker stats --no-stream ghostdroid_lab
adb -s 127.0.0.1:5555 shell getprop ro.build.version.release
```

Anote:

- tempo de boot até `sys.boot_completed=1`;
- RAM real do container ocioso;
- RAM com Instagram/TikTok abertos;
- CPU em idle e ativo.

### 2. GApps e Play Integrity

Na imagem com GApps:

- abrir Play Store; verificar “Device isn’t Play Protect certified”;
- pegar `android_id` (`adb shell settings get secure android_id`) e registrar em `google.com/android/uncertified` se necessário;
- testar Play Integrity (app “Play Integrity API Checker” ou similar);
- instalar Instagram e TikTok; abrir, logar, postar/story, DM.

**Critério:** se Instagram/TikTok não instalam ou são restringidos por integridade, a promessa “nano” não se sustenta.

### 3. Teste de banimento

- 3–7 dias de uso real em uma conta de teste;
- login, story, DM, feed;
- observar “device temporarily restricted”, challenge, logout.

**Critério:** se tomar restrição em poucos dias, cloud/Redroid não é produto para essas apps.

### 4. Densidade

Suba 2, 4, 6, 8 containers no host e meça:

```
free -h
docker stats --no-stream
```

**Critério:** quantos **ativos** cabem com folga de CPU/banda, não quantos ociosos.

### 5. Smart Standby

- `docker stop` → medir tempo de `docker start` até boot completo;
- testar `docker pause` (RAM não é liberada);
- opcional: CRIU/snapshot; medir se o estado do app volta;
- confirmar que login/cookies persistem via volume `/data`.

**Critério:** wake de 10–30s pode ser aceitável; “2s no estado exato” provavelmente não.

---

## Critérios de go/no-go

Só siga para planos/landing page se:

- Instagram **e** TikTok instalam e logam;
- Play Integrity não bloqueia o uso básico;
- nenhuma restrição em 3–7 dias de teste;
- densidade ativa caber no custo do plano;
- wake/standby for aceitável para o cliente;
- streaming (scrcpy/WebRTC) tiver latência usável no Brasil.

Caso contrário, o produto continua sendo **celular físico/ARM real** ou cloud com dispositivos reais.

---

## Segurança

- Nunca exponha `5555`/ADB na internet. Use SSH tunnel/VPN.
- Imagens de terceiros (incluindo `hrtrex/redroid`) precisam ser auditadas; para produção, construa a sua.
- Redroid usa `--privileged`; um container comprometido tem poder sobre o host. Isole por VM/host dedicado.
- GApps/MicroG e “Play Integrity fix” violam termos do Google; há risco jurídico/operacional.

---

## Referências

- Redroid deploy: https://github.com/remote-android/redroid-doc/blob/master/deploy/README.md
- Redroid-script (GApps/MindTheGapps): https://github.com/ayasa520/redroid-script
- Imagem GApps de terceiros: https://hub.docker.com/r/hrtrex/redroid
- Work Profile único: https://www.androidenterprise.community/t5/admin-discussions/multiple-work-profile-in-one-android-device/m-p/3679
- Oracle Free Tier: https://www.oracle.com/cloud/free/
