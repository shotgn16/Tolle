"""AI provider adapters.

Every adapter takes the same input – a list of {"role","content"} messages,
an optional list of images on the last user message and a thinking flag – and
returns {"text": str, "thinking": str}.

Provider "ondevice" never runs on the server: the job is handed to the browser
or mobile app, which runs the model locally (WebLLM / WebGPU) and posts the
result back.
"""
import base64
import json
import re

import httpx

from . import repetition

TIMEOUT = httpx.Timeout(connect=15, read=900, write=60, pool=15)

PROVIDERS = {
    "ollama": "Ollama (local / self-hosted)",
    "openai": "OpenAI (ChatGPT)",
    "gemini": "Google Gemini",
    "anthropic": "Anthropic Claude",
    "openai_compat": "OpenAI-compatible (LM Studio, LocalAI, OpenRouter, vLLM…)",
    "ondevice": "On-device (runs in your browser / phone)",
}

ONDEVICE_MODELS = [
    {"id": "Qwen3-4B-q4f16_1-MLC", "thinking": True, "note": "~2.5 GB download, best quality"},
    {"id": "Qwen3-1.7B-q4f16_1-MLC", "thinking": True, "note": "~1.2 GB, phones/tablets"},
    {"id": "Llama-3.2-3B-Instruct-q4f16_1-MLC", "thinking": False, "note": "~1.8 GB"},
    {"id": "Phi-3.5-mini-instruct-q4f16_1-MLC", "thinking": False, "note": "~2.2 GB"},
    {"id": "gemma-2-2b-it-q4f16_1-MLC", "thinking": False, "note": "~1.4 GB"},
]


class AIError(Exception):
    pass


def _err(resp: httpx.Response, name: str) -> AIError:
    try:
        detail = resp.json()
    except ValueError:
        detail = resp.text[:400]
    return AIError(f"{name} returned HTTP {resp.status_code}: {detail}")


def _split(messages):
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    rest = [m for m in messages if m["role"] != "system"]
    return system, rest


def _guess_mime(b64: str) -> str:
    try:
        head = base64.b64decode(b64[:24])[:4]
    except ValueError:
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:3] == b"GIF":
        return "image/gif"
    if head[:4] == b"RIFF":
        return "image/webp"
    return "image/jpeg"


_THINK_TAG = re.compile(r"<think>(.*?)</think>", re.S)


def _strip_think(text: str) -> tuple[str, str]:
    thoughts = "\n".join(_THINK_TAG.findall(text or ""))
    return _THINK_TAG.sub("", text or "").strip(), thoughts.strip()


# ---------------------------------------------------------------- Ollama
def _ollama_url(cfg):
    return (cfg.get("ollama.url") or "http://localhost:11434").rstrip("/")


def ollama_models(cfg):
    base = _ollama_url(cfg)
    with httpx.Client(timeout=20) as c:
        r = c.get(f"{base}/api/tags")
        if r.status_code != 200:
            raise _err(r, "Ollama")
        out = []
        for m in r.json().get("models", [])[:60]:
            caps = []
            try:
                s = c.post(f"{base}/api/show", json={"model": m["name"]})
                caps = s.json().get("capabilities", []) if s.status_code == 200 else []
            except httpx.HTTPError:
                pass
            out.append({"id": m["name"], "thinking": "thinking" in caps if caps else None,
                        "vision": "vision" in caps if caps else None})
        return out


def out_tokens(cfg) -> int:
    """The longest answer to ask for, in tokens (Settings → AI → Longest answer)."""
    try:
        return max(256, int(cfg.get("ai.max_output_tokens") or 8000))
    except (TypeError, ValueError):
        return 8000


def _ollama_options(cfg, messages, temperature, repeat_penalty):
    """Size the context window to the request.

    Ollama otherwise uses a short default context and silently drops anything longer, so the model
    loses the sources – and its own earlier writing, which is a common cause of repetition loops.
    """
    prompt_chars = sum(len(m.get("content") or "") for m in messages)
    out = out_tokens(cfg)
    needed = int(prompt_chars / 3.2) + out + 512
    cap = int(cfg.get("ollama.num_ctx") or 16384)
    num_ctx = max(4096, min(cap, 1 << (needed - 1).bit_length()))  # round up to a power of two
    return {"temperature": temperature, "num_ctx": num_ctx, "num_predict": out,
            "repeat_penalty": repeat_penalty, "repeat_last_n": 256, "top_p": 0.9}


def ollama_chat(cfg, model, messages, images, thinking, temperature, repeat_penalty=1.12):
    """Streams the answer so a repetition loop can be stopped the moment it starts."""
    msgs = [dict(m) for m in messages]
    if images:
        msgs[-1]["images"] = images
    body = {"model": model, "messages": msgs, "stream": True, "think": bool(thinking),
            "options": _ollama_options(cfg, msgs, temperature, repeat_penalty)}
    url = f"{_ollama_url(cfg)}/api/chat"
    with httpx.Client(timeout=TIMEOUT) as c:
        for attempt in range(2):
            text, thoughts, looped, reason = [], [], False, ""
            with c.stream("POST", url, json=body) as r:
                if r.status_code != 200:
                    r.read()
                    if attempt == 0 and r.status_code == 400 and "think" in r.text.lower():
                        body.pop("think", None)  # model doesn't support thinking
                        continue
                    raise _err(r, "Ollama")
                n = 0
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError:
                        continue
                    if chunk.get("error"):
                        raise AIError(f"Ollama: {chunk['error']}")
                    msg = chunk.get("message") or {}
                    if msg.get("thinking"):
                        thoughts.append(msg["thinking"])
                    if msg.get("content"):
                        text.append(msg["content"])
                        n += 1
                        if n % 40 == 0 and repetition.is_looping("".join(text[-400:])):
                            looped = True
                            break  # closing the stream stops generation
                    if chunk.get("done"):
                        reason = chunk.get("done_reason") or ""
                        break
            body_text, tagged = _strip_think("".join(text))
            return {"text": body_text, "thinking": "".join(thoughts) or tagged, "looped": looped,
                    "truncated": reason == "length"}
    raise AIError("Ollama didn't return an answer.")


# ---------------------------------------------------------------- OpenAI + compatible
def _oa(cfg, compat):
    if compat:
        return (cfg.get("compat.base_url") or "").rstrip("/"), cfg.get("compat.key") or "none"
    return (cfg.get("openai.base_url") or "https://api.openai.com/v1").rstrip("/"), cfg.get("openai.key")


_REASONING = re.compile(r"^(o\d|gpt-5|gpt-oss)", re.I)


def openai_models(cfg, compat=False):
    base, key = _oa(cfg, compat)
    if not key:
        raise AIError("No API key set.")
    r = httpx.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"}, timeout=20)
    if r.status_code != 200:
        raise _err(r, "OpenAI")
    ids = sorted(m["id"] for m in r.json().get("data", []))
    if not compat:
        ids = [i for i in ids if re.match(r"^(gpt|o\d|chatgpt)", i) and not re.search(
            r"(audio|realtime|tts|transcribe|image|embedding|search|moderation)", i)]
    return [{"id": i, "thinking": bool(_REASONING.match(i)) or None, "vision": None} for i in ids]


def openai_chat(cfg, model, messages, images, thinking, temperature, compat=False):
    base, key = _oa(cfg, compat)
    if not key:
        raise AIError("No API key set for this provider (Settings → AI).")
    msgs = [dict(m) for m in messages]
    if images:
        parts = [{"type": "text", "text": msgs[-1]["content"]}]
        parts += [{"type": "image_url", "image_url": {"url": f"data:{_guess_mime(b)};base64,{b}"}} for b in images]
        msgs[-1]["content"] = parts
    body = {"model": model, "messages": msgs}
    if compat:
        body["max_tokens"] = out_tokens(cfg)   # local servers often default to a short answer
    if _REASONING.match(model):
        body["reasoning_effort"] = "high" if thinking else "low"
    else:
        body["temperature"] = temperature
    headers = {"Authorization": f"Bearer {key}"}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(f"{base}/chat/completions", json=body, headers=headers)
        if r.status_code == 400 and ("reasoning" in r.text or "temperature" in r.text):
            body.pop("reasoning_effort", None)
            body.pop("temperature", None)
            r = c.post(f"{base}/chat/completions", json=body, headers=headers)
        if r.status_code == 400 and "max_tokens" in r.text:
            body.pop("max_tokens", None)
            r = c.post(f"{base}/chat/completions", json=body, headers=headers)
        if r.status_code != 200:
            raise _err(r, "OpenAI-compatible API" if compat else "OpenAI")
        choice = r.json()["choices"][0]
        msg = choice["message"]
        text, tagged = _strip_think(msg.get("content") or "")
        return {"text": text, "thinking": msg.get("reasoning_content") or msg.get("reasoning") or tagged,
                "truncated": choice.get("finish_reason") == "length"}


# ---------------------------------------------------------------- Gemini
_GEM = "https://generativelanguage.googleapis.com/v1beta"


def gemini_models(cfg):
    key = cfg.get("gemini.key")
    if not key:
        raise AIError("No Gemini API key set.")
    r = httpx.get(f"{_GEM}/models", headers={"x-goog-api-key": key}, params={"pageSize": 200}, timeout=20)
    if r.status_code != 200:
        raise _err(r, "Gemini")
    out = []
    for m in r.json().get("models", []):
        if "generateContent" in m.get("supportedGenerationMethods", []) and "gemini" in m["name"]:
            out.append({"id": m["name"].split("/", 1)[1], "thinking": m.get("thinking"), "vision": True})
    return out


def gemini_chat(cfg, model, messages, images, thinking, temperature):
    key = cfg.get("gemini.key")
    if not key:
        raise AIError("No Gemini API key set (Settings → AI).")
    system, rest = _split(messages)
    contents = []
    for i, m in enumerate(rest):
        parts = [{"text": m["content"]}]
        if images and i == len(rest) - 1:
            parts += [{"inline_data": {"mime_type": _guess_mime(b), "data": b}} for b in images]
        contents.append({"role": "model" if m["role"] == "assistant" else "user", "parts": parts})
    # Gemini counts its thinking against the same limit as the answer, so leave room for both.
    body = {"contents": contents, "generationConfig": {
        "temperature": temperature,
        "maxOutputTokens": min(65536, out_tokens(cfg) + (16384 if thinking else 4096)),
        "thinkingConfig": {"includeThoughts": True, "thinkingBudget": -1 if thinking else 0},
    }}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    url = f"{_GEM}/models/{model}:generateContent"
    headers = {"x-goog-api-key": key}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(url, json=body, headers=headers)
        if r.status_code == 400 and "thinking" in r.text.lower():
            if thinking:
                body["generationConfig"].pop("thinkingConfig")
            else:
                body["generationConfig"]["thinkingConfig"] = {"includeThoughts": False}
            r = c.post(url, json=body, headers=headers)
            if r.status_code == 400:
                body["generationConfig"].pop("thinkingConfig", None)
                r = c.post(url, json=body, headers=headers)
        if r.status_code == 400 and "maxoutputtokens" in r.text.lower():
            body["generationConfig"]["maxOutputTokens"] = 8192   # older models allow less
            r = c.post(url, json=body, headers=headers)
        if r.status_code != 200:
            raise _err(r, "Gemini")
        data = r.json()
        cands = data.get("candidates") or []
        if not cands:
            raise AIError(f"Gemini returned no answer: {data.get('promptFeedback', data)}")
        text, thoughts = [], []
        for p in cands[0].get("content", {}).get("parts", []):
            (thoughts if p.get("thought") else text).append(p.get("text", ""))
        return {"text": "".join(text).strip(), "thinking": "\n".join(thoughts).strip(),
                "truncated": cands[0].get("finishReason") == "MAX_TOKENS"}


# ---------------------------------------------------------------- Anthropic
_ANT = "https://api.anthropic.com/v1"


def _ant_headers(key):
    return {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}


def anthropic_models(cfg):
    key = cfg.get("anthropic.key")
    if not key:
        raise AIError("No Anthropic API key set.")
    r = httpx.get(f"{_ANT}/models", headers=_ant_headers(key), params={"limit": 100}, timeout=20)
    if r.status_code != 200:
        raise _err(r, "Anthropic")
    return [{"id": m["id"], "thinking": True, "vision": True} for m in r.json().get("data", [])]


def anthropic_chat(cfg, model, messages, images, thinking, temperature):
    key = cfg.get("anthropic.key")
    if not key:
        raise AIError("No Anthropic API key set (Settings → AI).")
    system, rest = _split(messages)
    msgs = []
    for i, m in enumerate(rest):
        content = [{"type": "text", "text": m["content"]}]
        if images and i == len(rest) - 1:
            content = [{"type": "image", "source": {"type": "base64", "media_type": _guess_mime(b), "data": b}}
                       for b in images] + content
        msgs.append({"role": m["role"], "content": content})
    body = {"model": model, "max_tokens": out_tokens(cfg) + (8000 if thinking else 0), "messages": msgs}
    if system:
        body["system"] = system
    if thinking:
        body["thinking"] = {"type": "enabled", "budget_tokens": 8000}
    else:
        body["temperature"] = temperature
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(f"{_ANT}/messages", json=body, headers=_ant_headers(key))
        if r.status_code == 400 and "thinking" in r.text:
            body.pop("thinking", None)
            r = c.post(f"{_ANT}/messages", json=body, headers=_ant_headers(key))
        if r.status_code != 200:
            raise _err(r, "Anthropic")
        data = r.json()
        text, thoughts = [], []
        for block in data.get("content", []):
            if block["type"] == "text":
                text.append(block["text"])
            elif block["type"] == "thinking":
                thoughts.append(block.get("thinking", ""))
        return {"text": "".join(text).strip(), "thinking": "\n".join(thoughts).strip(),
                "truncated": data.get("stop_reason") == "max_tokens"}


# ---------------------------------------------------------------- dispatch
def list_models(cfg, provider):
    if provider == "ollama":
        return ollama_models(cfg)
    if provider == "openai":
        return openai_models(cfg)
    if provider == "openai_compat":
        return openai_models(cfg, compat=True)
    if provider == "gemini":
        return gemini_models(cfg)
    if provider == "anthropic":
        return anthropic_models(cfg)
    if provider == "ondevice":
        return ONDEVICE_MODELS
    raise AIError(f"Unknown provider {provider}")


def _chat_once(cfg, provider, model, messages, images, thinking, temperature, penalty):
    if provider == "ollama":
        return ollama_chat(cfg, model, messages, images, thinking, temperature, penalty)
    if provider == "openai":
        return openai_chat(cfg, model, messages, images, thinking, temperature)
    if provider == "openai_compat":
        return openai_chat(cfg, model, messages, images, thinking, temperature, compat=True)
    if provider == "gemini":
        return gemini_chat(cfg, model, messages, images, thinking, temperature)
    if provider == "anthropic":
        return anthropic_chat(cfg, model, messages, images, thinking, temperature)
    raise AIError(f"Provider {provider} can't run on the server.")


CONTINUE_PROMPT = ("Your answer above was cut off because it reached the length limit. Continue it from exactly where "
                   "it stopped – mid-sentence if need be. Do not repeat anything already written, do not start again, "
                   "and do not add an introduction or a note about continuing. Complete the remaining sections, "
                   "then stop.")
LIMIT_NOTE = ("*This answer reached the length limit. Raise “Longest answer” in Settings → AI, choose a lower depth, "
              "or ask for less at once.*")
LOOP_NOTE = ("*The model started repeating itself here, so Tolle stopped it. Try again, choose a lower depth, "
             "or use a larger model for a complete answer.*")


def join_continuation(done: str, more: str) -> str:
    """Stitch a continuation onto a cut-off answer, dropping any part the model repeated."""
    more = more.lstrip("\n")
    if not more:
        return done
    # The model sometimes repeats the last words before carrying on: remove the overlap.
    tail = done[-400:]
    for size in range(min(len(tail), len(more)), 3, -1):
        if not more.startswith(tail[-size:]):
            continue
        # Short overlaps only count when they are whole words ("…given" + "given to…").
        whole = (size == len(done) or not done[-size - 1].isalnum()) and (size == len(more) or not more[size].isalnum())
        if size >= 12 or whole:
            more = more[size:]
            break
    else:
        # ...or restarts the answer from the top: keep only what's new.
        head, m = done.strip()[:120], more.strip()
        if head and (m.startswith(head) or (len(m) >= 12 and head.startswith(m))):
            return done
    if not more.strip():
        return done
    joiner = "" if (done.endswith((" ", "\n")) or more.startswith((" ", "\n", ",", ".", ";", ":", ")"))) else (
        " " if done[-1:].isalnum() and more[:1].isalnum() and not done.endswith("-") else "")
    if more.lstrip().startswith(("#", "- ", "* ", "1.", "|")) and not done.endswith("\n"):
        joiner = "\n\n"
    return done + joiner + more


def _run(cfg, provider, model, messages, images, thinking, temperature):
    """One answer, retried once with a stronger penalty if it gets stuck repeating itself."""
    out = _chat_once(cfg, provider, model, messages, images, thinking, temperature, penalty(cfg))
    if out.get("looped") or repetition.has_loop(out["text"]):
        retry = _chat_once(cfg, provider, model, messages, images, thinking, min(1.0, temperature + 0.15),
                           penalty(cfg) + 0.13)
        if not (retry.get("looped") or repetition.has_loop(retry["text"])) or \
                len(repetition.clean(retry["text"])[0]) > len(repetition.clean(out["text"])[0]):
            out = retry
    return out


def penalty(cfg) -> float:
    try:
        return float(cfg.get("ai.repeat_penalty") or 1.12)
    except (TypeError, ValueError):
        return 1.12


def chat(cfg, provider, model, messages, images=None, thinking=False, temperature=0.6, progress=None):
    """Run a chat and return a complete, clean answer.

    - If the answer stops because it reached the length limit, the model is asked to carry on from where
      it stopped (up to “Keep going” times, Settings → AI) and the parts are joined seamlessly.
    - It never saves a repetition loop: a looping run is retried once with a stronger repetition penalty,
      and whatever comes back is cleaned, with a note.
    """
    if not model:
        raise AIError("No model selected. Choose one in Settings → AI or in the model picker.")
    out = _run(cfg, provider, model, messages, images, thinking, temperature)
    text, thoughts = out["text"], out.get("thinking", "")
    looped = bool(out.get("looped"))
    truncated = bool(out.get("truncated")) and not looped
    try:
        rounds = max(0, int(cfg.get("ai.auto_continue", 3)))
    except (TypeError, ValueError):
        rounds = 3
    n = 0
    while truncated and n < rounds and text.strip():
        n += 1
        if progress:
            progress(f"The answer is long – continuing ({n})…")
        more = _run(cfg, provider, model, list(messages) + [
            {"role": "assistant", "content": text}, {"role": "user", "content": CONTINUE_PROMPT}], None, False, temperature)
        before = text
        text = join_continuation(text, more["text"])
        looped = bool(more.get("looped"))
        truncated = bool(more.get("truncated")) and not looped and text != before
    text, changed = repetition.clean(text)
    if changed or looped:
        text = text.rstrip() + "\n\n" + LOOP_NOTE
    elif truncated:
        text = text.rstrip() + "\n\n" + LIMIT_NOTE
    return {"text": text, "thinking": thoughts}
