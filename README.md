# komik

## Pakai model router lain (Pareto Inference)

Claude Code bicara **Anthropic Messages API** (`/v1/messages`).
`https://api.paretoinference.com/v1` cuma menyediakan **OpenAI chat completions**
(`/v1/chat/completions`) — tidak ada `/v1/messages`. Jadi `ANTHROPIC_BASE_URL`
tidak bisa langsung diarahkan ke sana; perlu jembatan penerjemah di tengah.

Repo ini menyiapkan jembatan itu memakai LiteLLM proxy.

```
Claude Code  ──Anthropic /v1/messages──▶  LiteLLM (127.0.0.1:4000)
                                              │
                                              └──OpenAI /v1/chat/completions──▶  api.paretoinference.com
```

### Model yang tersedia di router

| Nama di Claude Code | Model upstream            |
| ------------------- | ------------------------- |
| `glm-5.3`           | `z-ai/glm-5.3`            |
| `glm-5.3-flash`     | `z-ai/glm-5.3-flash`      |
| `deepseek-v4-flash` | `deepseek/deepseek-v4-flash` |

### Cara pakai

```sh
cp .env.example .env
# isi PARETO_API_KEY di .env

./router/start-router.sh --bg     # sekali install venv + LiteLLM, lalu jalan di :4000
source router/claude-env.sh       # arahkan Claude Code ke jembatan
claude
```

Berhenti: `./router/stop-router.sh`.

Ganti model utama sebelum `source`:

```sh
ANTHROPIC_MODEL=deepseek-v4-flash source router/claude-env.sh
```

### Cek jembatan tanpa Claude Code

```sh
curl -s --noproxy '*' http://127.0.0.1:4000/v1/messages \
  -H 'x-api-key: sk-local-dev' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'content-type: application/json' \
  -d '{"model":"glm-5.3","max_tokens":100,"messages":[{"role":"user","content":"halo"}]}'
```

### Catatan

- **Kunci API tidak pernah masuk git.** `.env` ada di `.gitignore`; yang di-commit
  hanya `.env.example`.
- `.claude/settings.json` memetakan ketiga model ke perilaku klien yang dikenal
  Claude Code lewat `modelPicker.behavesAs`, karena nama modelnya tidak ada di
  katalog bawaan. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` di `claude-env.sh` menyetel
  jendela konteks (default 128k) supaya auto-compact tidak salah asumsi —
  sesuaikan kalau jendela aslinya berbeda.
- Ketiga model mengembalikan blok `thinking` tanpa `signature`. Streaming dan
  tool calling sudah diuji jalan; kalau ada percakapan panjang yang tiba-tiba
  ditolak, itu penyebab pertama yang perlu dicurigai.
