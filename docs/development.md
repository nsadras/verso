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

Build the frontend before running browser tests. Playwright starts its own backend on port 8011 with a deterministic provider and temporary SQLite database; it does not call a real model or paid provider. The suite covers desktop and mobile conversation, notebook durability, cancellation, conflicting edits, math and tables, focus behavior, contextual actions, sidebar preferences, pen input, ink recovery and conflicts, image actions, handwriting conversion and append recovery, and writing during streaming and resizing.

On a minimal Linux host, Chromium may also need system libraries installed with `npx playwright install-deps chromium`, which requires administrator access.

## Architecture

React handles the current exchange and editor state. FastAPI serves the built UI and API from one origin. SQLite stores topics, notebook revisions, editable ink sections, conversation turns with optional PNG snapshots, and nonsecret settings. IndexedDB keeps tablet recovery drafts for ink; perfect-freehand renders the strokes, and two viewport-sized canvas layers keep active pen movement independent of React renders. Offscreen sections and strokes are skipped when drawing. A small LiteLLM adapter handles model requests; no separate model gateway is deployed.

The backend separates storage, credentials, provider/context selection, conversation lifecycle, and HTTP routes. Run one backend worker: active generations are managed in that process, with one active generation per topic. SQLite writes do not hold transactions open during inference.

## Model settings and context

The default local model is `gemma4:12b`, and the default endpoint is `http://127.0.0.1:11434/v1`. Use the name of a model installed on your host; `ollama list` lists installed Ollama models. Include `/v1` for Ollama and other compatible servers that expose their API there. The app does not download models.

Match **Context window** to the server’s effective setting. The app defaults to 8,192. **Maximum response tokens** is optional; clear an older saved limit to use the provider’s default output limit.

When selecting history, the app reserves one quarter of the configured context window, up to 4,096 tokens, for the reply, or the explicit response limit when set. This reservation does not itself cap generation. For text, context selection uses a conservative UTF-8 byte budget so unfamiliar local tokenizers work without downloads. It may include fewer turns than the model could actually fit. The UI reports when older turns were omitted; no summaries or retrieval are generated.

If the provider reports a response or context limit, the partial reply is retained with an error instead of being presented as a completed exchange.

### Hosted providers and API keys

In **Model settings**, choose **Hosted provider** and select OpenAI/OpenAI-compatible, Anthropic, or Google Gemini. Enter the provider’s model ID without a LiteLLM prefix. Leave the endpoint blank for the provider default, or enter an HTTPS endpoint for an OpenAI-compatible service.

Hosted use is explicit: messages, recent hidden history, and notebook text or ink snapshots shared through contextual actions are sent to the selected provider. Text actions share the selected passage or whole text notebook; conversational ink actions share the selected rectangle or visible writing. Handwriting conversion sends the selected area or all handwriting, in separate image requests for long notebooks. There is no automatic cloud fallback. These model operations, **Save & test connection**, and **Save & verify images** may incur provider charges.

### Contextual notebook actions

**Explore**, **Check**, and **Test Me** remain at the right of the compact notebook header as muted text controls. Preview/Edit sits on the same line after a subtle divider. A small, borderless footer shows save status, word count, and action scope. Actions send a snapshot of the selected passage, or the current whole Markdown notebook when nothing is selected, alongside recent complete turns from the same topic. Selection works in both Edit and Preview and survives moving focus through the header; Escape clears it. Empty notebooks disable the model actions. Preview always applies to the whole notebook.

Actions do not require the notebook to have finished autosaving and cannot modify it. Explore develops the idea; Check reviews accuracy and qualifications using the model's knowledge; Test Me requests one conceptual question and waits for an answer before feedback. Model adherence to these instructions varies.

`POST /api/topics/{id}/messages` accepts an optional `action` (`explore`, `check`, or `test_me`); `content` holds the passage or whole notebook. The backend supplies action instructions and includes their size in the context budget. Completed action turns retain their instructions when used as follow-up context, subject to the same history budget as other turns. Oversized requests are rejected rather than silently shortening the text; select a shorter passage or increase the context window. Failed and stopped turns remain excluded from future context.

SQLite schema version 2 introduced a nullable action field; version 3 added ink pages, image attachments, and connection-specific image verification. The current version 4 adds receipts for retryable handwriting-to-text appends. Versions 1–3 migrate on startup. The latest-turn endpoint returns the action field so the small action label survives refreshes and restarts. Existing notes, settings, and ordinary turns are preserved. There is no historical search or separate quiz state in this stage.

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


## Workspace layout

The expand icon beside **Text / Ink** switches to notes-only and hides the desktop sidebar. The same button returns to split view and restores the sidebar's previous collapsed/expanded preference. Both editors stay mounted, so unfinished chat drafts, notebook selections and scrolling, ink strokes, and ongoing responses are retained. Using a notebook action returns to split view to show the response alongside the notes. On phones, Chat, Notebook, and Split shortcuts remain available above the workspace.

Split view follows viewport orientation: conversation above notes in portrait, conversation left of notes in landscape. Drag the small divider with a finger, pen, or mouse. Its touch target extends beyond the visible handle. Minimum pane sizes keep controls usable; in very small windows those minimums shrink together. The browser remembers a separate divider ratio for each orientation. Layout mode itself starts at split on larger screens and chat on phones when the app opens.

The divider can also receive keyboard focus: use Left/Right in landscape or Up/Down in portrait to adjust by 2%, with Shift for 10%. Home and End reach the available size limits; Enter or a double-click balances the panes. This is a workspace layout change, so it does not invoke the browser's fullscreen API or change browser zoom.

## Handwriting on a tablet

Choose **Ink** beside **Text** in the notebook. Write with the S Pen or a mouse on a continuous surface with room downward and sideways. **Eraser** removes whole strokes; **Undo/Redo** retain up to 50 edits across the notebook in the current session. Storage boundaries never clip a stroke or move existing writing. Use private HTTPS for coalesced pen samples where supported; ordinary pointer events remain the fallback.

Use **two fingers to pan and pinch to zoom**, anchored between your fingers. Zoom changes the notebook only, from 25% to 400%; 100% fits the starting writing width to the panel. **Move** also allows one-finger or mouse dragging. A single touch in Pen mode does nothing, and touch navigation is ignored while the pen is down. On a computer, use the wheel to pan, Shift+wheel to pan sideways, and Ctrl/Command+wheel to zoom at the pointer. The focused canvas also supports arrows and Page Up/Down.

The tiny footer includes the zoom percentage (click to reset zoom) and **Return to writing** (or Home), which restores the normal writing scale near your latest pen position. For older notes with no remembered pen location, it finds the bottommost writing. Each topic's view and writing position are remembered in this browser, including after refresh. The surrounding interface keeps its normal scale.

**Select** draws a rectangle in document coordinates, including across former page boundaries. Explore, Check, and Test Me share that rectangle, or the **visible writing** when there is no selection; the footer says `selection` or `view`. A view that would shrink the handwriting too far asks you to zoom in or select a smaller area. Snapshots include current strokes even before synchronization and are immutable once sent. Escape clears the selection and returns to the pen. These conversational actions leave notes unchanged. Moving selected handwriting remains a later stage; text and ink views remain separate.

In Model settings, **Save & verify images** sends a generated image containing a random code, an equation, and an arrow. The code appears only in the pixels; the endpoint must read it to pass. This tests image input, not handwriting or mathematical accuracy. The check allows 1,024 output tokens for models that think before answering. Changing the model/endpoint/provider or replacing a key invalidates verification. If verification fails, text chat continues to work; there is no cloud fallback.

### Persistence and interfaces

The existing `/api/topics/{topic}/ink-pages` API and ink tables introduced in SQLite schema v3 remain in use. GET returns ordered storage sections; PUT to `/{section UUID}` creates or updates a section with `width`, `height`, `space`, `strokes`, `revision`, and a `mutation_id` UUID. New sections use `space: "canvas"` and world coordinates. The 1000 × 1414 dimensions describe storage cells, not visible page edges. Strokes belong to the cell where they start and remain intact across its boundaries. Coordinates are finite and bounded to ±1,000,000 units; pressure stays between 0 and 1.

Existing page documents (without `space`, or with `space: "page"`) retain their original validation and exact retry format. On first opening, the client stacks them vertically in their saved order and upgrades their editable drafts to world coordinates. It preserves any pending old request until acknowledged, then saves the upgraded draft using the new revision. No startup rewrite of the database is needed. Existing conversations and shared snapshots remain unchanged.

Revision 0 creates a section; stale revisions return 409. Retrying an identical acknowledged mutation returns its existing revision. The server retains the original limits of 5,000 strokes, 10,000 samples per stroke, and 200,000 samples per section for compatibility. New writing automatically starts another section before exceeding 500 strokes or 20,000 samples; long individual strokes ask for a pen lift at 10,000 samples. Erasing across sections is one undoable edit. Canvas bitmaps remain viewport-sized; bounds and stroke outlines are cached. All sections are still loaded into memory for an open notebook; paging them from the host can wait until actual notebook sizes justify it.

Completed edits enter a serialized IndexedDB queue before host synchronization. Only changed sections are written locally. Host saves are debounced, serialized, and retried on reconnect, visibility changes, or every ten seconds. A pending request snapshot is retained separately from newer edits so a lost acknowledgement or an edit during saving cannot overwrite newer writing. “Saved on tablet” means local recovery storage acknowledged the draft; “Saved on host” means the host acknowledged it. Local storage failures are visible and unsaved work triggers an unload warning.

Conflicts preserve the tablet draft and the host version. **Keep tablet ink** explicitly overwrites the conflicting section's latest known host revision; **Use host ink** discards that tablet section after confirmation. A further competing save still conflicts. **Download ink draft** provides a JSON recovery copy; there is no general import UI yet. Navigation can proceed once pending ink is durably saved locally. Text edits still require host save success. Drafts on other devices are not remotely erased when a topic is deleted; a deleted topic cannot be recreated by draft synchronization.

Conversation requests accept an optional `image` containing a PNG data URL, capped at 3 MB decoded and 1536 pixels per side. The client also limits the short side to 1024 pixels for the default context budget, and refuses snapshots below 0.7 pixels per document unit to avoid compressing a large view into unreadable handwriting. Pillow validates and normalizes images onto white before storage. Images are included in the latest-turn response and eligible completed history. Context selection reserves a model-independent image allowance (1,024 plus 512 per 512-pixel tile), with at most three images per request. This is an estimate: providers tokenize images differently. Oversized current inputs fail visibly; older turns can be omitted. With an unverified model, image-bearing history and older turns are omitted rather than silently stripping images from retained turns.

### Galaxy Tab acceptance check

Browser tests simulate pen events and browser touch gestures; they cannot establish S Pen latency or palm comfort. On the actual tablet, write below the original page and add a side diagram; pan and pinch with two fingers; lift them and keep writing at the new scale. Rest your palm before and during writing, try Move, rotate the tablet, and keep writing while an answer streams. Erase across a large area and undo. Refresh to check the restored view, then try Return to writing. Disconnect briefly, confirm “Saved on tablet,” reconnect, and confirm “Saved on host.” Finally share a visible view and a selected equation, and compare the model's reading with what you wrote. Basic pressure-sensitive writing, handwriting recognition, and pinch zoom have passed a Galaxy Tab trial. Selection movement, handwriting search, PDF annotation, mixed text/ink layout, and full offline use remain deferred.

### Handwriting to Markdown

In Ink, **Convert all** transcribes every stroke in the topic, including offscreen writing. With a rectangular selection, **Convert** uses only that area. This broader default is specific to conversion: Explore, Check, and Test Me still use the visible writing when nothing is selected. Conversion requires verified image support and uses the currently selected model; no OCR service or additional dependency is installed.

The client captures completed strokes when clicked, including unsynchronized local edits. Long notebooks are divided into readable sections, preferring whitespace between strokes and processing upper regions before lower ones and left before right within each region. Images are generated and sent one at a time. One conversion is limited to 64 images and 500,000 output characters; larger work asks for a smaller selection. Progress and Cancel remain available while the model works. You can continue writing ink or text, but chat requests, topic navigation, and model changes wait until conversion finishes.

The transcription prompt preserves the author's wording, questions, headings, lists, and tables; equations use `$…$` inline and `$$` on separate lines for display math. It asks the model to mark illegible or uncertain text `[unclear]` and describe diagrams briefly without inventing details. Review the output: recognition and reading order depend on the model, and complex diagrams or strokes spanning image boundaries may need smaller selections or manual corrections. There is no semantic layout analysis or automatic source-to-text linking.

All sections must finish successfully before anything is appended. Cancelled, failed, disconnected, and token-limited responses do not append partial transcriptions. A complete result is first kept in IndexedDB, then pending text edits are flushed and the result is appended atomically to the latest host text. Existing text is preserved as an exact prefix; ink and conversation history stay unchanged. The new section has dividers, a dated heading, its source scope, and `<!-- verso:handwriting:UUID:begin -->` / `:end` comments. Preview hides those comments and renders the equations. Text opens in Preview at the new section; if you are still drawing or navigating the canvas, that switch waits until you lift the pen or fingers. Edit exposes the Markdown for corrections.

If appending fails, **Retry append**, **Download Markdown**, and **Discard conversion** remain available. Completed pending conversions recover after refresh in this browser; clearing browser storage removes these local copies. A text-save conflict must be resolved first, using the existing draft export/reload controls. If local recovery storage fails, keep the page open or download the conversion until a host save succeeds. A deliberate new conversion appends a new section; retrying the same one cannot duplicate it, even after a lost acknowledgement or server restart.

`POST /api/topics/{id}/transcribe` accepts one validated PNG `image` and returns SSE start/keepalive, a complete `transcription` event, and done/error events. It reuses model cancellation and the topic's active-generation guard but creates no conversation turn. Images are transient for conversion; this endpoint does not persist them. `POST /api/topics/{id}/notebook/append-conversion` accepts a UUID `id`, `markdown`, and `scope` (`notebook` or `selection`). SQLite schema v4 stores an append receipt with a content hash, and the transaction reads the latest text before appending. Receipts are removed with their topic. IndexedDB v3 adds pending conversions while preserving earlier ink drafts.

For a tablet trial, select a handwritten equation and convert it, check the rendered math and editable LaTeX, then convert notes spread over several screens. Check that existing text, strokes, and the chat remain intact. Automated tests use a deterministic model; they do not establish the accuracy of real lecture-note transcription.
