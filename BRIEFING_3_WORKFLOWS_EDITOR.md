# 🎯 BRIEFING TÉCNICO — 3 WORKFLOWS DE EDIÇÃO EROS-IMAGE
## Sistema GhostHot | RunningHub (ComfyUI Cloud)

> **Data:** Novembro 2026  
> **Projeto:** GhostLens SaaS — Nicho Hot (OnlyFans / Privacy / Instagram)  
> **Destino dos arquivos:** `/workflows_runninghub/02_EDITOR_EROS_IMAGE/`

---

## 🧠 CONTEXTO DO SISTEMA

O sistema GhostHot entrega **conteúdo para influenciadoras IA** (perfis white e packs NSFW).  
Já temos o **Eros-Image Gerador** (`01_KREA2_RAW_TURBO_EROS_IMAGE_DUAL_LORA.json`) funcionando perfeitamente no RunningHub.

**O que falta:** 3 workflows de EDIÇÃO para:
1. Trocar a pose da musa sem mudar identidade (via LoRA + Prompt)
2. Copiar a pose de uma foto de referência (ex: Pinterest) e colocar a musa nela
3. Trocar/tirar roupa cirurgicamente via inpainting

---

## ✅ PARÂMETROS DO GERADOR BASE (referência — já funciona, NÃO alterar)

```
KSampler:
  steps: 8
  cfg: 1.0
  sampler: euler
  scheduler: beta
  denoise: 0.8 (gerador) / 0.85 (editor/inpaint)

LoRA Musa:
  strength_model: 1.5
  strength_clip: 0.75

LoRA Base (Phone Photography):
  strength_model: 0.8
  strength_clip: 0.45

ResolutionSelector:
  megapixels: 2.45  (≈ 2K nativo)

Modelos (nomes EXATOS no RunningHub):
  UNET:         krea2/krea2_turbo_int8_convrot.safetensors
  CLIP abliterated (NSFW sem censura): Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors
  CLIP oficial: qwen3vl_4b_fp8_scaled.safetensors
  VAE:          wan_2.1_vae.safetensors
  LoRA edição:  krea2_identity_edit_v1_2.safetensors
  
LoRAs das musas (já treinados, em Downloads):
  LENINHA - EROS-IMAGE KREA 2.safetensors
  CAMILA - EROS-IMAGE KREA 2.safetensors

Custom Node OBRIGATÓRIO para Workflows 2 e Edição:
  comfyui-krea2edit (github: stefanfalkok/comfyui-krea2edit)
  Nós: Krea2EditModelPatch | Krea2EditGroundedEncode
```

---

## 📦 WORKFLOW 1 — LoRA + Pose por Prompt
**Arquivo:** `02_EROS_IMAGE_LORA_POSE_PROMPT.json`  
**Branding UI:** "Eros-Image Pose (LoRA + Prompt)"  
**Créditos estimados:** 20 coins (igual ao gerador base)

### O que faz:
O cliente digita a pose em texto (ex: `"frente, biquíni vermelho, praia, mãos na cintura"`) e o sistema gera a Musa nessa pose, com identidade preservada pelo LoRA dela.

### Arquitetura dos nós (fluxo linear):

```
[UNETLoader]
  └─ ckpt_name: krea2/krea2_turbo_int8_convrot.safetensors

[CLIPLoader]
  └─ clip_name: Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors
  └─ type: flux  (ou auto)

[VAELoader]
  └─ vae_name: wan_2.1_vae.safetensors

[LoraLoader]  ← LoRA BASE (Phone Photography)
  └─ lora_name: [nome do lora base]
  └─ strength_model: 0.8
  └─ strength_clip: 0.45

[LoraLoader]  ← LoRA DA MUSA (configurável via API)
  └─ lora_name: "LENINHA - EROS-IMAGE KREA 2.safetensors"  ← INPUT PARAMETRIZÁVEL
  └─ strength_model: 1.5
  └─ strength_clip: 0.75

[CLIPTextEncode]  ← Prompt POSITIVO  ← INPUT PARAMETRIZÁVEL
  └─ text: "front view, hands on hips, red bikini, beach, [lora trigger word]..."

[CLIPTextEncode]  ← Prompt NEGATIVO (fixo)
  └─ text: "blurry, deformed, bad anatomy, watermark..."

[EmptyLatentImage]  ← ou ResolutionSelector
  └─ width: 1152
  └─ height: 1536  (proporção 3:4 portrait)

[KSampler]
  └─ steps: 8 | cfg: 1 | sampler: euler | scheduler: beta | denoise: 0.8
  └─ seed: INPUT PARAMETRIZÁVEL

[VAEDecode]

[SaveImage]
  └─ filename_prefix: "eros_lora_pose"
```

### Entradas que a API do RunningHub precisa receber (inputs do workflow):
| Input | Nó | Campo | Descrição |
|---|---|---|---|
| `prompt` | CLIPTextEncode positivo | `text` | Descrição da pose e cena |
| `lora_musa` | LoraLoader Musa | `lora_name` | Nome do arquivo .safetensors da musa |
| `seed` | KSampler | `seed` | Seed para reprodutibilidade |

---

## 📦 WORKFLOW 2 — Referência de Pose + Musa
**Arquivo:** `02_EROS_IMAGE_REF_POSE.json`  
**Branding UI:** "Eros-Image Referência de Pose"  
**Créditos estimados:** 15–20 coins

### O que faz:
O cliente pega uma foto do Pinterest (qualquer modelo em qualquer pose) e o sistema coloca a Musa exatamente naquela pose, mantendo o rosto/identidade da Musa. Pode usar LoRA ou foto de rosto da Musa como referência de identidade.

### Lógica:
Usa o `Krea2EditModelPatch` com até 5 slots de referência:
- **Slot 1:** Foto de pose de referência (Pinterest)
- **Slot 2:** Foto da Musa (rosto, para identidade) — opcional se usar LoRA
- O `Krea2EditGroundedEncode` codifica a imagem base + as referências + o prompt

### Arquitetura dos nós:

```
[UNETLoader]
  └─ ckpt_name: krea2/krea2_turbo_int8_convrot.safetensors

[CLIPLoader]
  └─ clip_name: Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors

[VAELoader]
  └─ vae_name: wan_2.1_vae.safetensors

[LoraLoader]  ← LoRA DA MUSA (opcional, mas recomendado)
  └─ lora_name: INPUT PARAMETRIZÁVEL
  └─ strength_model: 1.2
  └─ strength_clip: 0.6

[LoadImage] ← Foto da Musa (imagem base a editar)  ← INPUT PARAMETRIZÁVEL
[LoadImage] ← Foto de Pose Referência 1 (Pinterest)  ← INPUT PARAMETRIZÁVEL
[LoadImage] ← Foto de Pose Referência 2 (opcional)   ← INPUT PARAMETRIZÁVEL

[VAEEncode]  ← encoda cada imagem de referência

[Krea2EditModelPatch]
  └─ model: (recebe do UNETLoader)
  └─ ref_1: VAEEncode da foto de referência de pose
  └─ ref_2: VAEEncode da foto da musa (rosto)
  └─ ref_3..5: vazios / opcionais

[Krea2EditGroundedEncode]  ← Positivo
  └─ clip: (do CLIPLoader)
  └─ base_image: VAEEncode da imagem base da musa
  └─ text: "same person, front view, standing, [pose description]"  ← INPUT PARAMETRIZÁVEL

[Krea2EditGroundedEncode]  ← Negativo
  └─ text: "different person, blurry, deformed..."

[KSampler]
  └─ steps: 8 | cfg: 1 | sampler: euler | scheduler: beta | denoise: 0.75

[VAEDecode]

[SaveImage]
  └─ filename_prefix: "eros_ref_pose"
```

### Entradas da API:
| Input | Nó | Campo | Descrição |
|---|---|---|---|
| `base_image` | LoadImage (Musa) | `image` | Foto atual da musa |
| `reference_image` | LoadImage (Pinterest) | `image` | Foto de pose de referência |
| `prompt` | Krea2EditGroundedEncode | `text` | Instrução complementar da pose |
| `lora_musa` | LoraLoader | `lora_name` | LoRA da musa para identidade |
| `seed` | KSampler | `seed` | Seed |

---

## 📦 WORKFLOW 3 — Inpaint (Trocar / Tirar Roupa)
**Arquivo:** `02_EROS_IMAGE_INPAINT_ROUPA.json`  
**Branding UI:** "Eros-Image Editor Inpaint"  
**Créditos estimados:** 10–15 coins

### O que faz:
O cliente pega uma foto da Musa já gerada pelo Eros-Image 2K, pinta uma máscara sobre a peça de roupa que quer trocar ou tirar, e o sistema faz a substituição **cirurgicamente** — sem mexer no rosto, fundo ou resto do corpo.

### Lógica:
- `VAEEncodeForInpaint` recebe a imagem + a máscara pintada
- Apenas a área mascarada é re-gerada com o prompt novo
- `denoise: 0.85` para trocar roupa / `denoise: 0.95` para tirar

### Arquitetura dos nós:

```
[UNETLoader]
  └─ ckpt_name: krea2/krea2_turbo_int8_convrot.safetensors

[CLIPLoader]
  └─ clip_name: Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors

[VAELoader]
  └─ vae_name: wan_2.1_vae.safetensors

[LoraLoader]  ← LoRA DA MUSA (preserva identidade mesmo no inpaint)
  └─ lora_name: INPUT PARAMETRIZÁVEL
  └─ strength_model: 1.0
  └─ strength_clip: 0.5

[LoadImage]  ← Foto da Musa (já gerada pelo Eros-Image 2K)  ← INPUT PARAMETRIZÁVEL
[LoadImageMask] OU [ImageToMask]  ← Máscara pintada pelo cliente  ← INPUT PARAMETRIZÁVEL

[VAEEncodeForInpaint]
  └─ pixels: (da LoadImage)
  └─ vae: (do VAELoader)
  └─ mask: (da LoadImageMask)
  └─ grow_mask_by: 6  (dilata a máscara para evitar bordas duras)

[CLIPTextEncode]  ← Prompt POSITIVO (o que colocar)  ← INPUT PARAMETRIZÁVEL
  └─ Exemplo trocar: "white lace bra, same skin tone, realistic"
  └─ Exemplo tirar:  "bare chest, natural skin, no clothes, same lighting"

[CLIPTextEncode]  ← Prompt NEGATIVO (fixo)
  └─ text: "blurry, deformed, bad anatomy, artifacts, seam..."

[KSampler]
  └─ steps: 8 | cfg: 1 | sampler: euler | scheduler: beta
  └─ denoise: 0.85  ← INPUT PARAMETRIZÁVEL (0.7=sutil, 0.95=radical)
  └─ seed: INPUT PARAMETRIZÁVEL

[VAEDecode]

[SaveImage]
  └─ filename_prefix: "eros_inpaint"
```

### Entradas da API:
| Input | Nó | Campo | Descrição |
|---|---|---|---|
| `base_image` | LoadImage | `image` | Foto da musa gerada |
| `mask` | LoadImageMask | `image` | Máscara da área a editar (branco=editar) |
| `prompt` | CLIPTextEncode positivo | `text` | O que colocar ou tirar na área |
| `lora_musa` | LoraLoader | `lora_name` | LoRA da musa |
| `denoise` | KSampler | `denoise` | Intensidade da edição (0.7–0.95) |
| `seed` | KSampler | `seed` | Seed |

---

## 🎬 BONUS — GhostDirector (4 Poses em Lote)
**Não é um workflow ComfyUI — é uma feature do GhostLens backend**

### Fluxo:
```
1. Cliente digita o tema/cena (ex: "bedroom, provocante, fio dental")
2. Gemini API gera 4 prompts de poses fotográficas diferentes e coerentes
   (Gemini SÓ roteiriza texto — não gera imagens NSFW)
3. Cada prompt é enviado para o Workflow 1 (Eros-Image LoRA + Pose)
   via RunningHub API em sequência ou paralelo
4. Sistema entrega 4 fotos da Musa em 4 poses diferentes, prontas para carrossel
```

### Código já implementado em:
- `lib/vision.js` → `generateCarouselDirectorPrompts()`
- `lib/creator.js` → `planCarouselDirector()`
- `api/wavespeed_proxy.js` → `action: 'carousel_director'`
- `public/studio.html` → Modal `#modalGhostDirector`

---

## 📋 REGISTRO NO RUNNINGHUB_WORKFLOWS.JSON

Adicionar as seguintes entradas após os workflows existentes:

```json
"eros_image_lora_pose": {
  "workflowId": "WORKFLOW_ID_DO_RUNNINGHUB",
  "name": "Eros-Image Pose (LoRA + Prompt)",
  "description": "Gera a Musa em qualquer pose descrita por texto, identidade preservada pelo LoRA",
  "credits": 20,
  "inputs": {
    "prompt": {"nodeId": "NÓ_CLIP_POSITIVO", "field": "text"},
    "lora_musa": {"nodeId": "NÓ_LORA_MUSA", "field": "lora_name"},
    "seed": {"nodeId": "NÓ_KSAMPLER", "field": "seed"}
  }
},

"eros_image_ref_pose": {
  "workflowId": "WORKFLOW_ID_DO_RUNNINGHUB",
  "name": "Eros-Image Referência de Pose",
  "description": "Coloca a Musa na pose de uma foto de referência (ex: Pinterest)",
  "credits": 20,
  "inputs": {
    "base_image": {"nodeId": "NÓ_LOAD_IMAGE_MUSA", "field": "image"},
    "reference_image": {"nodeId": "NÓ_LOAD_IMAGE_REF", "field": "image"},
    "prompt": {"nodeId": "NÓ_KREA2_GROUNDED_ENCODE", "field": "text"},
    "lora_musa": {"nodeId": "NÓ_LORA_MUSA", "field": "lora_name"},
    "seed": {"nodeId": "NÓ_KSAMPLER", "field": "seed"}
  }
},

"eros_image_inpaint": {
  "workflowId": "WORKFLOW_ID_DO_RUNNINGHUB",
  "name": "Eros-Image Editor Inpaint",
  "description": "Troca ou remove roupa em área selecionada por máscara",
  "credits": 12,
  "inputs": {
    "base_image": {"nodeId": "NÓ_LOAD_IMAGE", "field": "image"},
    "mask": {"nodeId": "NÓ_LOAD_MASK", "field": "image"},
    "prompt": {"nodeId": "NÓ_CLIP_POSITIVO", "field": "text"},
    "lora_musa": {"nodeId": "NÓ_LORA_MUSA", "field": "lora_name"},
    "denoise": {"nodeId": "NÓ_KSAMPLER", "field": "denoise"},
    "seed": {"nodeId": "NÓ_KSAMPLER", "field": "seed"}
  }
}
```

> **IMPORTANTE:** Os `nodeId` acima são placeholders. Após criar e importar cada workflow no RunningHub, inspecione o JSON exportado para pegar os IDs reais dos nós e preencha aqui.

---

## 🗂️ ESTRUTURA DE PASTAS (após criar os workflows)

```
GhostLens/
├── workflows_runninghub/
│   ├── 01_GERADOR_FOTO_EROS_IMAGE/
│   │   ├── 01_KREA2_RAW_TURBO_EROS_IMAGE_DUAL_LORA.json  ✅ Funcional
│   │   ├── 01_KREA2_1K_FAST_EROS_IMAGE.json              ✅ Funcional
│   │   ├── 01_KREA2_FILM_CHECKPOINT_EROS_IMAGE.json       ✅ Criado
│   │   ├── 01_EROS_IMAGE_EDITOR_NSFW_KREA2.json           ✅ Criado
│   │   ├── 01_EROS_IMAGE_INPAINT_NSFW.json                ✅ Criado
│   │   └── 01_QWEN_SKIN_FIX_GLAMOUR.json                  ✅ Pre-existente
│   │
│   └── 02_EDITOR_EROS_IMAGE/   ← CRIAR ESTES AGORA
│       ├── 02_EROS_IMAGE_LORA_POSE_PROMPT.json             ⏳ A criar
│       ├── 02_EROS_IMAGE_REF_POSE.json                     ⏳ A criar
│       └── 02_EROS_IMAGE_INPAINT_ROUPA.json                ⏳ A criar
│
├── RUNNINGHUB_WORKFLOWS.json                               ← Atualizar após criar
├── RUNNINGHUB_WORKFLOWS.default.json
└── BRIEFING_3_WORKFLOWS_EDITOR.md                          ← ESTE ARQUIVO
```

---

## ⚡ CHECKLIST DE IMPLEMENTAÇÃO

### ETAPA 1 — Verificar Custom Node no RunningHub
- [ ] Confirmar se `comfyui-krea2edit` está instalado no RunningHub
  - Nó `Krea2EditModelPatch` deve aparecer na lista de nós
  - Nó `Krea2EditGroundedEncode` deve aparecer na lista de nós
- [ ] Se NÃO estiver: criar Workflow 2 com ControlNet (OpenPose ou Depth) como alternativa

### ETAPA 2 — Criar Workflow 1 (LoRA + Pose)
- [ ] Abrir ComfyUI no RunningHub
- [ ] Montar o grafo conforme arquitetura acima
- [ ] Testar com prompt: `"front view, white fio dental bikini, bedroom, hands on hips, [lora trigger]"`
- [ ] Verificar se o rosto da Musa é preservado
- [ ] Exportar JSON → salvar como `02_EROS_IMAGE_LORA_POSE_PROMPT.json`

### ETAPA 3 — Criar Workflow 2 (Referência de Pose)
- [ ] Montar com `Krea2EditModelPatch` (5 ref slots)
- [ ] Testar com 1 foto de referência do Pinterest + foto da Leninha
- [ ] Verificar se a pose é copiada e o rosto é mantido
- [ ] Exportar JSON → salvar como `02_EROS_IMAGE_REF_POSE.json`

### ETAPA 4 — Criar Workflow 3 (Inpaint)
- [ ] Montar com `VAEEncodeForInpaint`
- [ ] Testar: carregar foto gerada pelo Eros-Image, pintar máscara na roupa, prompt "bare chest"
- [ ] Verificar que apenas a área mascarada muda
- [ ] Exportar JSON → salvar como `02_EROS_IMAGE_INPAINT_ROUPA.json`

### ETAPA 5 — Atualizar RUNNINGHUB_WORKFLOWS.json
- [ ] Subir cada workflow no RunningHub (Get Workflow ID)
- [ ] Pegar os node IDs reais de cada nó parametrizável
- [ ] Adicionar as 3 entradas no JSON com IDs corretos

### ETAPA 6 — Integrar no GhostDirector
- [ ] Ajustar `api/wavespeed_proxy.js` para mandar os 4 prompts para o Workflow 1
- [ ] Testar geração de 4 poses em lote

### ETAPA 7 — Git Commit
```bash
cd "/Users/luancastellan/Saas Multiempresa/GhostLens"
git add -A
git commit -m "feat: 3 workflows de edição Eros-Image + GhostDirector 4 poses integrado"
```

---

## 🔑 NOTAS IMPORTANTES PARA O CLAUDE / OUTRO AGENTE

1. **Nomenclatura UI:** NUNCA escrever "Krea 2" ou "krea2" em texto visível ao usuário. Sempre "Eros-Image".

2. **Modelos — caminhos com `/`:** No JSON dos workflows, o UNET deve ser `krea2/krea2_turbo_int8_convrot.safetensors` com barra normal (não backslash).

3. **LoRA da Musa:** O usuário tem musas diferentes (Leninha, Camila, etc.). O campo `lora_name` DEVE ser um input parametrizável via API para trocar a musa sem mudar o workflow.

4. **CLIP abliterado:** `Huihui-Qwen3-VL-4B-Instruct-abliterated.safetensors` — este é o que remove a censura NSFW. Usar sempre este para conteúdo hot.

5. **Erro de Loop:** O arquivo `LustiKreaEdit2.json` original tem subgrafos circulares e dá erro no RunningHub. Não usar. Recriar os workflows do zero com nós lineares simples.

6. **denoise para Inpaint:**
   - `0.70` = mudança sutil (trocar cor da roupa)
   - `0.85` = trocar peça de roupa
   - `0.95` = remover roupa completamente

7. **Paralelismo no GhostDirector:** RunningHub cobra por run. Para 4 poses = 4 runs × 20 coins = 80 coins. Informar o usuário antes de rodar o lote.

