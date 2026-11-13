# Development and hosting

For the product introduction and local installation, start with the [README](../README.md). Design history is in the [devlog](../DEVLOG.md).

## Work on the app

Install dependencies with `uv sync --locked` and `npm ci`. Then run these in separate terminals:

```bash
uv run python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

```bash
npm run dev
```

Open the Vite URL, normally http://127.0.0.1:5173. Vite proxies `/api` to FastAPI. PWA caching is enabled only in production builds. For a production build, use `npm run build` followed by `uv run main.py`.

### Checks

```bash
uv run --locked python -m pytest
npm run build
npx playwright install chromium
npm test
```

Build the frontend before running browser tests. Playwright starts its own backend on port 8011 with a deterministic provider and temporary SQLite database; it does not call a real model or paid provider. The suite covers desktop and mobile conversation, notebook durability, cancellation, export, conflicting edits, math and tables, focus behavior, and sidebar preferences.

On a minimal Linux host, Chromium may also need system libraries installed with `npx playwright install-deps chromium`, which requires administrator access.

## Architecture

React handles the current exchange and editor state. FastAPI serves the built UI and API from one origin. SQLite stores topics, notebook revisions, conversation turns, and nonsecret settings. A small LiteLLM adapter handles model requests; no separate model gateway is deployed.

The backend separates storage, credentials, provider/context selection, conversation lifecycle, and HTTP routes. Run one backend worker: active generations are managed in that process, with one active generation per topic. SQLite writes do not hold transactions open during inference.

## Model settings and context

The default local model is `gemma4:12b`, and the default endpoint is `http://127.0.0.1:11434/v1`. Use the name of a model installed on your host; `ollama list` lists installed Ollama models. Include `/v1` for Ollama and other compatible servers that expose their API there. The app does not download models.

Match **Context window** to the server’s effective setting. The app defaults to 8,192. **Maximum response tokens** is optional; clear an older saved limit to use the provider’s default output limit.

When selecting history, the app reserves one quarter of the configured context window, up to 4,096 tokens, for the reply, or the explicit response limit when set. This reservation does not itself cap generation. Context selection uses a conservative UTF-8 byte budget so unfamiliar local tokenizers work without downloads. It may include fewer turns than the model could actually fit. The UI reports when older turns were omitted; no summaries or retrieval are generated.

If the provider reports a response or context limit, the partial reply is retained with an error instead of being presented as a completed exchange.

### Hosted providers and API keys

In **Model settings**, choose **Hosted provider** and select OpenAI/OpenAI-compatible, Anthropic, or Google Gemini. Enter the provider’s model ID without a LiteLLM prefix. Leave the endpoint blank for the provider default, or enter an HTTPS endpoint for an OpenAI-compatible service.

Hosted use is explicit: messages and recent hidden history are sent to the selected provider. The notebook is not sent, and there is no automatic cloud fallback. **Save & test connection** makes a small inference request and may incur provider charges.

Keys stay on the host. When **Remember** is selected, the app uses a supported OS credential store if available. Otherwise, or if storage fails, the replacement key is held in memory until the backend restarts. The settings dialog reports the storage source. Stored and session keys are scoped to connection mode, provider, and endpoint; they are never stored in SQLite or returned by the API.

Headless hosts can set `VERSO_API_KEY` in the backend process environment. That fallback applies to the selected hosted connection rather than a stored connection-specific key. Remove it from the host configuration to clear it. Keep keys out of tracked files and shell history.

## Existing installations

The previous `EPHEMERAL_DB`, `EPHEMERAL_ORIGINS`, and `EPHEMERAL_API_KEY` environment variables are still accepted when the corresponding `VERSO_*` name is absent. Verso names take precedence. Existing browser preferences and OS credential entries are read under the old names as a compatibility fallback; new writes use the Verso names. The default database path stays `data/notebook.sqlite3`.

## Storage and recovery

The database defaults to `data/notebook.sqlite3`. Set `VERSO_DB` to use another path. For a simple backup, stop the backend before copying the database; SQLite uses WAL while running. Keep the data directory private and maintain backups yourself.

Each topic owns a Markdown document and its stored conversation. The UI shows only the latest exchange, including saved partial replies, and has no full-transcript browser or API. Reopening a partial reply does not resume generation automatically. The browser stores the selected topic ID and sidebar preference; conversation text remains on the host.

Notebook saves are debounced by 500 ms, serialized, and revision-checked. **Saved on host** means the server acknowledged the write. A conflict preserves the local draft and offers export/reload. Navigation between topics waits for saves to succeed.

Partial output is checkpointed about once a second, so a crash may lose the last second of a reply. Startup marks unfinished generations as interrupted. Only complete turns are eligible for future model context.

Deleting a topic removes its notebook and conversation after confirmation. It does not securely erase backups or other storage copies. Markdown exports contain the notebook only.

### Markdown and math

AI replies and notebook previews support Markdown tables and LaTeX: `$…$` for inline math and `$$…$$` for display math, including display expressions on a single line. Math also renders inside table cells. KaTeX and its fonts are bundled locally. Wide tables and equations scroll within the panel.

Notebook editing and export preserve the original source. Code remains literal, raw HTML is not executed, and embedded images appear as text labels.

## Private access from other devices

Run the backend and model server on the same host. With Tailscale installed and authenticated, allow only trusted devices and users through your tailnet policy. The app has no separate login: anyone who can reach it can read notebooks, generate responses, and change settings.

Enable private HTTPS access through Tailscale Serve:

```bash
tailscale serve --bg http://127.0.0.1:8000
```

Use the actual HTTPS origin printed by Tailscale in place of the example below, then restart the app with that origin allowed:

```bash
VERSO_ORIGINS=https://your-host.your-tailnet.ts.net uv run main.py
```

`VERSO_ORIGINS` accepts comma-separated origins without paths. Keep the backend bound to loopback and proxy the application port through Serve. Use private Serve, not public Funnel. Remote browsers connect to the app; model endpoints and API keys are accessed by the host.

### Installed app and offline behavior

On a supporting browser, install the app through its browser menu. The PWA caches the app shell and bundled assets, not API data or credentials. Remote use requires a connection to the host; offline synchronization is not implemented. Keep the page open to retain unsaved edits during an outage. Service-worker updates wait for existing tabs to close.
