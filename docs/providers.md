# Providers

A provider is a model backend. ForgeAI ships four adapters
(`backend/src/providers/`):

| Kind | Contract | Notes |
|---|---|---|
| `openai-compatible` | `POST {baseUrl}{chatPath}` with `chat/completions` SSE | OpenAI, OpenRouter, LM Studio, llama.cpp, Groq, Together, vLLM… |
| `ollama` | native `/api/chat`, `/api/tags`, `/api/show`, `/api/ps` | models detected live (name, size, context, loaded/available) |
| `custom` | configurable path + response mode | `openai-sse`, `json-text`, `ndjson-ollama` |
| `demo` | local simulation | zero-config fallback, clearly labelled DEMO in the UI |

## Configurable per provider

Name, ID, kind, base URL, API version, API key (encrypted at rest, masked in
the UI), custom headers (JSON), custom body parameters (JSON), context window,
tags, icon, pricing input/output, enabled flag, default flag, chat path and
response mode.

## Adding one

Settings → Providers → **Add provider**, or seed via env:

```env
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=sk-...
OPENAI_COMPATIBLE_MODEL=gpt-4o-mini
```

When those env vars exist, setup seeds an enabled provider from
`providers/openai-compatible.json`.

## Ollama

Install Ollama and pull any model (`ollama pull llama3.2`). ForgeAI queries
`OLLAMA_BASE_URL` (default `http://localhost:11434`) and lists **only what the
API reports** — nothing is assumed installed. The model picker shows name,
size, context length and loaded/available state; System Status shows reachability.

## Model resolution order

`request.model → chat.model → settings.models.defaultModel → provider default
(first listed model)`. Provider resolution: `request.providerId →
chat.providerId → settings default provider → flagged default → first enabled
→ demo (when FORGEAI_DEMO_MODE=true)`.

## Error handling

Unreachable providers produce `PROVIDER_OFFLINE` with a human hint (connection
refused / DNS / timeout). The chat UI shows **Retry / Settings / Change
Provider** actions; full details stay in backend logs.
