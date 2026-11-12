# Choosing an AI

Tolle needs an AI model to write studies, insights and plans. The desktop setup assistant can set one up for you; you can change it any time in **Settings → AI**. Every AI button also has a model picker so you can switch provider, model or thinking for a single request.

| Provider | Runs where | Setup | Thinking | Reads images |
|---|---|---|---|---|
| **Ollama** | your server / PC | Ollama URL, e.g. `http://192.168.1.50:11434` | qwen3, deepseek-r1, gpt-oss, magistral… | gemma3, llava, qwen2.5-vl, llama3.2-vision |
| **OpenAI (ChatGPT)** | cloud | API key | o-series, GPT-5 family (reasoning effort high/low) | GPT-4o, GPT-4.1, GPT-5 |
| **Google Gemini** | cloud | API key from aistudio.google.com | Gemini 2.5 / 3 (thinking budget) | yes |
| **Anthropic Claude** | cloud | API key | extended thinking | yes |
| **OpenAI-compatible** | anywhere | base URL (+ key) | if the server returns reasoning | depends |
| **On-device** | the browser/phone you're using | nothing – downloads once | Qwen3 models | no |

## Thinking mode

When on, models that support it reason step by step before answering. Answers are usually more careful – especially for **In-depth** studies – but slower. The reasoning is saved with the note under **Model reasoning**. If a model doesn't support thinking, Tolle silently retries without it.

## Recommended local models (Ollama)

| Hardware | Model | Notes |
|---|---|---|
| 8 GB RAM / Raspberry Pi 5 | `qwen3:4b`, `gemma3:4b`, `llama3.2:3b` | slow on a Pi but works; use the **Small model** settings |
| 16 GB RAM or 8 GB GPU | `qwen3:8b`, `gemma3:12b` | good everyday quality |
| 24 GB+ GPU | `qwen3:32b`, `gpt-oss:20b`, `gemma3:27b` | best local results |

Pull one vision model (e.g. `gemma3:4b`) if you upload photos of handwritten notes.

## Long answers

Every model has a limit on how long one answer can be. When an answer reaches it, Tolle notices and asks the model to carry on from exactly where it stopped, then joins the parts so the note reads as one piece. It does this up to **Keep going** times (Settings → AI → Answers and model size, normally 3).

If an answer still reaches the limit, it ends with a short note. Then:

- raise **Longest answer** (Settings → AI). 8,000 tokens is roughly 6,000 words.
- choose a lower depth, or ask for less at once
- with Gemini, turn **Thinking** off for long studies, because its thinking counts towards the same limit

## Small models and modest computers

Small instruct models (about 1–8 billion parameters, for example `llama3.2:3b`, `qwen3:4b`, `gemma3:4b`, `phi4-mini`) can write good studies if they're asked the right way. Go to **Settings → AI → Answers and model size** and tap **Small model (1–8B, low-end computer)**. This fills in:

| Setting | Small model | Larger model |
|---|---|---|
| Prompt style | Compact | Detailed |
| Longest answer | 3,000 tokens | 8,000 tokens |
| Keep going | 2 times | 3 times |
| Source text budget | 6,000 characters | 24,000 characters |
| Context window (Ollama) | 8,192 | 16,384 |
| Creativity | 0.4 | 0.6 |
| Repetition penalty (Ollama) | 1.15 | 1.12 |
| Thinking | off | your choice |

**Compact** prompts give the model a few short rules instead of many long ones, put the study sites *before* the task (small models follow what they read last), and ask for every section briefly rather than a few at length. Every value can still be changed. The compact rules themselves can be edited in **Settings → AI instructions → Ground rules – compact**.

Prompt style **Automatic** (the default) uses compact prompts for on-device models and detailed prompts for everything else. The installers choose the small-model settings automatically on computers with less than 20 GB of memory.

## On-device

Uses [WebLLM](https://webllm.mlc.ai) with WebGPU (Chrome/Edge 113+, Safari 18+, recent Android/iOS WebViews). The first run downloads the model (1–2.5 GB) and caches it. Research and source fetching still happen on the server; only the writing runs on your device, so your notes and prompts never go to a cloud AI.

## If a study repeats itself

Smaller local models sometimes get stuck repeating a phrase. Tolle watches for this while the answer is being written: it stops the loop, tries once more with a stronger repetition penalty, and removes any repeats before saving, adding a short note at that point.

If it keeps happening:

- make sure **Settings → AI → Context window** is at least 16384 (Ollama otherwise uses a short window and silently drops part of the request)
- choose a lower depth, or lower the **Source text budget**
- use a bigger model, e.g. `qwen3:14b` instead of `qwen3:4b`

## Source text budget

Each study sends the Bible text and material from the study sites to the model ([what it reads](study-sites.md)). **Settings → AI → Source text budget** limits how many characters (40,000 by default). The more room, the more commentators, historical writings and pastoral material the AI can weigh. With Ollama, Tolle also keeps within the context window. Small models work better with about 6,000. Cloud models are fine with 40,000–80,000.

## Privacy

Cloud providers receive the prompt (your question, notes being analysed and source excerpts). Use Ollama or On-device to keep everything private. API keys are stored encrypted and never shown again after saving.
