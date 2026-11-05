# Tutorial — Android Virtual do GhostPhone

Este tutorial é para configurar o **Android virtual** do GhostPhone e rodar Instagram/TikTok.
O GhostPhone usa uma imagem Android x86_64. Para ela rodar em velocidade usável, o PC precisa de **virtualização ativada**.

---

## O que o Anthony precisa fazer agora

1. **Fechar o GhostLens completamente**
   - Feche a janela do app e a janela do daemon/servidor.
   - Se necessário, abra o Gerenciador de Tarefas e finalize `GhostLens.exe`, `pythonw.exe` e `python.exe`.

2. **Instalar a versão 3.5.4 por cima**
   - Baixe em: https://www.ghostlens.cloud/download
   - Não precisa desinstalar. A licença e os perfis continuam salvos.

3. **Verificar a virtualização**
   - Gerenciador de Tarefas → Desempenho → CPU.
   - Procure **Virtualização**.
   - Se estiver **Desabilitada**, siga a seção “Ativar virtualização na BIOS” abaixo.

4. **Ativar a Plataforma do Hipervisor do Windows**
   - Menu Iniciar → “Ativar ou desativar recursos do Windows”.
   - Marque **Plataforma do Hipervisor do Windows**.
   - Reinicie o PC.

5. **Configurar o motor Android**
   - Menu Iniciar → GhostLens → **Configurar Motor Android**.
   - Deixe a janela terminar. Ela instala/repaira o SDK e a AVD.

6. **Abrir o GhostPhone**
   - Abra o GhostLens.
   - Vá em **GhostPhone • Personas** e clique em **Abrir GhostPhone**.
   - O primeiro boot pode levar até 120 segundos.

7. **Se ainda der erro**
   - Abra no navegador do PC:
     `http://127.0.0.1:4444/api/android_diag`
   - Envie o resultado para o suporte (WhatsApp).

---

## Ativar virtualização na BIOS

1. Reinicie o PC.
2. Entre na BIOS/UEFI (teclas comuns: **Del**, **F2**, **F10** ou **Esc**).
3. Procure a opção de virtualização:
   - **Intel:** `Intel Virtualization Technology`, `VT-x` ou `Intel VMX`.
   - **AMD:** `SVM Mode`, `Secure Virtual Machine`, `AMD-V` ou `AMD Virtualization`.
4. Ative a opção, salve (**F10**) e reinicie.

### Onde fica em cada fabricante (AMD)

| Fabricante | Caminho comum |
|---|---|
| ASUS | `F7` (Advanced Mode) → Advanced → CPU Configuration → **SVM Mode** |
| MSI | Advanced → OC → Advanced CPU Configuration → **SVM Mode** |
| Gigabyte | Tweaker → Advanced CPU Settings → **SVM Mode** |
| ASRock | Advanced → CPU Configuration → **SVM** |
| Dell | `F2` → Virtualization Support → **Virtualization** (AMD-V/SVM) |
| HP | `F10` → System Configuration → **Virtualization Technology (AMD-V)** |
| Lenovo | `F1` → Security → Virtualization → **AMD-V** / Configuration → SVM |
| Acer | `F2` → Advanced → **SVM Mode** |

Se a BIOS tiver busca, procure por `SVM`. Em algumas placas AMD ele fica em **Advanced → AMD CBS → CPU Common Options → SVM** ou em **Overclocking → Advanced CPU Configuration**.

Se não encontrar SVM: atualize a BIOS ou envie o modelo da placa-mãe/PC para o suporte. PCs muito antigos ou CPUs AMD sem SVM não têm essa opção.

> Sem isso, o Android x86_64 não roda em velocidade usável. Não existe instalação que ligue a virtualização dentro do Windows: é uma configuração do firmware do PC.

---

## Como saber se o PC é compatível

| Item | Requisito |
|---|---|
| Processador | Windows x64 (Intel/AMD). **Windows ARM64 não é compatível** com a imagem x86_64. |
| Sistema | Windows 10 ou 11 64-bit |
| Virtualização | Ativada na BIOS/UEFI |
| Windows | Plataforma do Hipervisor do Windows ativada |
| RAM | 8 GB ou mais (recomendado) |
| Disco | 10 GB livres ou mais |
| Conflitos | Feche outros emuladores (BlueStacks, LDPlayer, Android Studio) antes de abrir o GhostPhone |

---

## Diagnóstico: valores esperados

Abra `http://127.0.0.1:4444/api/android_diag` e confira:

| Campo | Esperado |
|---|---|
| `host_arch` | `AMD64` |
| `image_x86_64_exists` | `true` |
| `platform_tools_exists` | `true` |
| `avd_values.hw.cpu.arch` | `x86_64` |
| `avd_values.image.sysdir.1` | `system-images/android-30/default/x86_64/` |
| `virtualization_enabled` | `true` |
| `adb_devices` | deve aparecer `emulator-5554` depois do boot |

---

## Erros comuns

| Erro | Causa | Solução |
|---|---|---|
| `CPU Architecture 'arm' is not supported` | Config antiga da AVD sem x86_64 | Instalar 3.5.2 ou superior; o daemon repara a AVD. |
| `platform-tools subdirectory is missing` / `Broken AVD system path` | SDK sem `platform-tools` | Instalar 3.5.4; o daemon cria automaticamente. |
| `Virtualização desativada` / `x86_64 emulation requires hardware acceleration` | VT-x/AMD-V desligado | Ativar na BIOS e a Plataforma do Hipervisor do Windows. |
| `Timeout aguardando Android` | Boot lento, RAM baixa ou virtualização desligada | Fechar outros emuladores, ativar virtualização, tentar novamente. |
| `host_arch: ARM64` | Windows em processador ARM | Não é compatível com a imagem x86_64; usar PC x64. |
| Emulador abre e fecha | SDK/AVD incompletos ou antivírus bloqueando | Rodar “Configurar Motor Android” e verificar o log em `C:\Users\<usuario>\.ghostphone\logs\android_emulator.log`. |

---

## Todos os PCs vão dar erro?

**Não.** Os erros recentes de `arm` e `platform-tools` eram bugs nossos de configuração e foram corrigidos nas versões 3.5.2/3.5.4.

Depois disso:

- PCs Windows x64 com virtualização ativada devem funcionar.
- PCs com virtualização desligada precisam da BIOS.
- PCs Windows ARM64 não são compatíveis com a imagem x86_64.
- PCs com pouca RAM, disco cheio, antivírus agressivo ou outro emulador aberto podem falhar.

Por isso o ideal é fazer uma **verificação de compatibilidade antes de vender** e orientar o cliente com este tutorial.

---

Suporte: WhatsApp `+55 17 99708-2645`
