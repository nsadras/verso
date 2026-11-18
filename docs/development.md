# Development and hosting

For the product introduction and local installation, start with the [README](../README.md). Design history is in the [devlog](../DEVLOG.md).

## Work on the app

Install dependencies with `uv sync --locked` and `npm ci`. Then run these in separate terminals:

```bash
uv run python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000 --no-use-colors
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

Build the frontend before running browser tests. Playwright starts its own backend on port 8011 with a deterministic provider and temporary SQLite database; it does not call a real model or paid provider. The suite covers desktop and mobile conversation, notebook durability, cancellation, conflicting edits, math and tables, focus behavior, contextual actions, sidebar preferences, pen input, ink recovery and conflicts, image actions, and writing during streaming and resizing.

On a minimal Linux host, Chromium may also need system libraries installed with `npx playwright install-deps chromium`, which requires administrator access.

## Architecture

React handles the current exchange and editor state. FastAPI serves the built UI and API from one origin. SQLite stores topics, notebook revisions, editable ink pages, conversation turns with optional PNG snapshots, and nonsecret settings. IndexedDB keeps tablet recovery drafts for ink; completed strokes are drawn with perfect-freehand and two canvas layers keep active pen movement independent of React renders. A small LiteLLM adapter handles model requests; no separate model gateway is deployed.

The backend separates storage, credentials, provider/context selection, conversation lifecycle, and HTTP routes. Run one backend worker: active generations are managed in that process, with one active generation per topic. SQLite writes do not hold transactions open during inference.

## Model settings and context

The default local model is `gemma4:12b`, and the default endpoint is `http://127.0.0.1:11434/v1`. Use the name of a model installed on your host; `ollama list` lists installed Ollama models. Include `/v1` for Ollama and other compatible servers that expose their API there. The app does not download models.

Match **Context window** to the server’s effective setting. The app defaults to 8,192. **Maximum response tokens** is optional; clear an older saved limit to use the provider’s default output limit.

When selecting history, the app reserves one quarter of the configured context window, up to 4,096 tokens, for the reply, or the explicit response limit when set. This reservation does not itself cap generation. For text, context selection uses a conservative UTF-8 byte budget so unfamiliar local tokenizers work without downloads. It may include fewer turns than the model could actually fit. The UI reports when older turns were omitted; no summaries or retrieval are generated.

If the provider reports a response or context limit, the partial reply is retained with an error instead of being presented as a completed exchange.

### Hosted providers and API keys

In **Model settings**, choose **Hosted provider** and select OpenAI/OpenAI-compatible, Anthropic, or Google Gemini. Enter the provider’s model ID without a LiteLLM prefix. Leave the endpoint blank for the provider default, or enter an HTTPS endpoint for an OpenAI-compatible service.

Hosted use is explicit: messages, recent hidden history, and notebook text or ink snapshots shared through contextual actions are sent to the selected provider. Actions share the selected passage, or the whole notebook when nothing is selected. There is no automatic cloud fallback. **Save & test connection** and **Save & verify images** make inference requests and may incur provider charges.

### Contextual notebook actions

**Explore**, **Check**, and **Test Me** remain at the right of the compact notebook header as muted text controls. Preview/Edit sits on the same line after a subtle divider. A small, borderless footer shows save status, word count, and action scope. Actions send a snapshot of the selected passage, or the current whole Markdown notebook when nothing is selected, alongside recent complete turns from the same topic. Selection works in both Edit and Preview and survives moving focus through the header; Escape clears it. Empty notebooks disable the model actions. Preview always applies to the whole notebook.

Actions do not require the notebook to have finished autosaving and cannot modify it. Explore develops the idea; Check reviews accuracy and qualifications using the model's knowledge; Test Me requests one conceptual question and waits for an answer before feedback. Model adherence to these instructions varies.

`POST /api/topics/{id}/messages` accepts an optional `action` (`explore`, `check`, or `test_me`); `content` holds the passage or whole notebook. The backend supplies action instructions and includes their size in the context budget. Completed action turns retain their instructions when used as follow-up context, subject to the same history budget as other turns. Oversized requests are rejected rather than silently shortening the text; select a shorter passage or increase the context window. Failed and stopped turns remain excluded from future context.

SQLite schema version 2 introduced a nullable action field; the current version 3 also adds ink pages, image attachments, and connection-specific image verification. Versions 1 and 2 migrate on startup. The latest-turn endpoint returns that field so the small action label survives refreshes and restarts. Existing notes, settings, and ordinary turns are preserved. There is no note provenance, historical search, or separate quiz state in this stage.

Keys stay on the host. When **Remember** is selected, the app uses a supported OS credential store if available. Otherwise, or if storage fails, the replacement key is held in memory until the backend restarts. The settings dialog reports the storage source. Stored and session keys are scoped to connection mode, provider, and endpoint; they are never stored in SQLite or returned by the API.

Headless hosts can set `VERSO_API_KEY` in the backend process environment. That fallback applies to the selected hosted connection rather than a stored connection-specific key. Remove it from the host configuration to clear it. Keep keys out of tracked files and shell history.

## Existing installations

The previous `EPHEMERAL_DB`, `EPHEMERAL_ORIGINS`, and `EPHEMERAL_API_KEY` environment variables are still accepted when the corresponding `VERSO_*` name is absent. Verso names take precedence. Existing browser preferences and OS credential entries are read under the old names as a compatibility fallback; new writes use the Verso names. The default database path stays `data/notebook.sqlite3`.

## Storage and recovery

The database defaults to `data/notebook.sqlite3`. Set `VERSO_DB` to use another path. For a simple backup, stop the backend before copying the database; SQLite uses WAL while running. Keep the data directory private and maintain backups yourself.

Each topic owns a Markdown document, ink pages, and its stored conversation. The UI shows only the latest exchange, including saved partial replies, and has no full-transcript browser or API. Reopening a partial reply does not resume generation automatically. The browser stores topic/view/sidebar preferences and ink recovery drafts; conversation text and shared image history remain on the host.

Text notebook saves are debounced by 500 ms, serialized, and revision-checked. **Saved on host** means the server acknowledged the write. A conflict preserves the local draft and offers export/reload. Navigation between topics waits for saves to succeed.

There is no routine export control in the notebook header. **Export my draft** remains available during a save conflict so unsaved work can be recovered before reloading. The existing Markdown export API is also retained.

Partial output is checkpointed about once a second, so a crash may lose the last second of a reply. Startup marks unfinished generations as interrupted. Only complete turns are eligible for future model context.

Deleting a topic removes its text and ink notebooks, conversation, and shared images after confirmation. The initiating browser also removes its ink drafts. It does not securely erase backups or other storage copies. Markdown exports contain the notebook only.

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

On a supporting browser, install the app through its browser menu. The PWA caches the app shell and bundled assets, not API data or credentials. Opening the workspace requires a connection to the host. Already-open ink notebooks retain completed edits in IndexedDB during brief outages and retry synchronization; pending drafts recover after a refresh once the host is reachable. Full offline opening and multi-device offline merging are not implemented. Keep the page open to retain unsaved text edits during an outage. Clearing browser data also removes tablet-only ink drafts. Service-worker updates wait for existing tabs to close.


## Handwriting on a tablet

Choose **Ink** beside **Text** in the notebook. Write with the S Pen or a mouse. **Eraser** removes whole strokes; **Undo/Redo** retain up to 50 edits per page in the current session. **+ Page** adds a portrait page. Pages use stable 1000 × 1414 document coordinates and scale to the panel without changing saved strokes. **Move** enables touch scrolling and browser pinch zoom. Pen, eraser, and selection modes suppress touch gestures to avoid accidental palm marks or page movement. Use private HTTPS for coalesced pen samples where supported; ordinary pointer events remain the fallback.

**Select** draws a rectangle. Explore, Check, and Test Me share that rectangle, or the current page when there is no selection. Snapshots include current strokes even before synchronization and are immutable once sent. Escape clears the selection and returns to the pen. The AI cannot edit the notebook. Text and ink views remain separate.

In Model settings, **Save & verify images** sends a generated image containing a random code, an equation, and an arrow. The code appears only in the pixels; the endpoint must read it to pass. This tests image input, not handwriting or mathematical accuracy. The check allows 1,024 output tokens for models that think before answering. Changing the model/endpoint/provider or replacing a key invalidates verification. If verification fails, text chat continues to work; there is no cloud fallback.

### Persistence and interfaces

`GET /api/topics/{topic}/ink-pages` returns ordered pages. `PUT /api/topics/{topic}/ink-pages/{page UUID}` creates or updates a page with `width`, `height`, `strokes`, `revision`, and a `mutation_id` UUID. Each stroke has a UUID, size, and `[x, y, pressure]` samples. Revision 0 creates a page; stale revisions return 409. Retrying an identical acknowledged mutation returns its existing revision, protecting against a lost response. Pages are bounded to 5,000 strokes, 10,000 samples per stroke, and 200,000 samples per page; continue on another page when full.

Completed edits enter a serialized IndexedDB queue before host synchronization. Only changed pages are written locally. Host saves are debounced, serialized, and retried on reconnect, visibility changes, or every ten seconds. A pending request snapshot is retained separately from newer edits so a lost acknowledgement or an edit during saving cannot overwrite newer writing. “Saved on tablet” means local recovery storage acknowledged the draft; “Saved on host” means the host acknowledged it. Local storage failures are visible and unsaved work triggers an unload warning.

Conflicts preserve the tablet draft and the host version. **Keep tablet page** explicitly overwrites the latest known host revision; **Use host page** discards the tablet draft after confirmation. A further competing save still conflicts. **Download ink draft** provides a JSON recovery copy; there is no general import UI yet. Navigation can proceed once pending ink is durably saved locally. Text edits still require host save success. Drafts on other devices are not remotely erased when a topic is deleted; a deleted topic cannot be recreated by draft synchronization.

Conversation requests accept an optional `image` containing a PNG data URL, capped at 3 MB decoded and 1536 pixels per side. The client also limits the short side to 1024 pixels so a whole page fits the default context budget. Pillow validates and normalizes it onto white before storage. Images are included in the latest-turn response and eligible completed history. Context selection reserves a model-independent image allowance (1,024 plus 512 per 512-pixel tile), with at most three images per request. This is an estimate: providers tokenize images differently. Oversized current inputs fail visibly; older turns can be omitted. With an unverified model, image-bearing history and older turns are omitted rather than silently stripping images from retained turns.

### Galaxy Tab acceptance check

Browser tests simulate pen events and cover software behavior; they cannot establish S Pen latency or palm comfort. On the actual tablet, try small subscripts, fractions, and a diagram; rest your palm before and during writing; erase and undo; scroll with Move; rotate the tablet; and keep writing while an answer streams. Disconnect briefly, confirm “Saved on tablet,” reconnect, and confirm “Saved on host.” Then select an equation or diagram and compare the model’s reading with what you wrote. The writing feel and handwriting accuracy remain a hardware/user check. Automatic transcription, handwriting search, PDF annotation, mixed text/ink layout, and full offline use remain deferred.
