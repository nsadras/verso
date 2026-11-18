# Devlog

Design and implementation notes for Verso. This initial retrospective collects the prototype’s iterations by milestone; it does not assign release dates to earlier work.

## Prototype retrospective

### Start with a working conversation and notebook

The first priority was a usable local model conversation alongside a persistent text notebook. React and TypeScript handle the interface; FastAPI serves the built app and API; SQLite stores topics, notes, settings, and conversation turns. Python dependencies are managed with uv. A small LiteLLM adapter connects to local OpenAI-compatible endpoints and optional hosted providers.

The notebook stays independent of inference. Writing, autosave, preview, and export remain available when a model is slow, fails, or is unavailable. Each topic owns one notebook. This keeps the prototype small enough to test the interaction itself.

### Make conversation feel like a shared page

The landing screen and introductory panel copy gave way to an immediate chat-and-notebook workspace. Topic management moved into a left sidebar.

The chat then became a continuous writing surface: no message bubbles, avatars, speaker labels, or separate input bar. A borderless editor grows directly beneath the AI’s response. The previous exchange remains visible while a follow-up is being composed. Submitting moves the writing upward, fades the previous exchange, and streams the next reply beneath the submitted text.

The first writing line sits halfway down an empty page. We tried centering the empty caret horizontally, but switching to left alignment on the first keystroke made the text jump. The caret now starts at the left margin and stays there. Clicking blank space focuses the editor; selecting a reply or using a link retains its normal behavior. The “Write here…” placeholder was removed.

### Reduce visual noise

Separate ink colors proved distracting. Submitted user text now uses italics, while AI text and the editable draft stay upright, with more space between turns. The palette later moved to dark gray surfaces and soft white text, and the sidebar branding was removed.

A small pulsing ink dot indicates generation and doubles as the stop control. The send button and keyboard hint were removed. Reduced-motion preferences disable the page animation and pulsing effect.

Long responses grow naturally and scroll in full. The chat scrollbar is hidden; a small arrow appears when more text is below. The notebook’s footer was folded into one compact header containing its save state, word count, preview, and export controls. Its focus outline was removed so the caret is the editing cue.

The desktop sidebar can now collapse to a small reopen icon. Both writing panels expand, drafts remain intact, and the preference survives refreshes. The mobile Topics drawer remains independent of that desktop preference.

### Make explanations readable

LaTeX rendering was added for inline and display math, including display expressions written on one line. Markdown tables render with aligned columns, support math inside cells, and scroll horizontally when needed. Notebook editing and export preserve the original Markdown source.

The app’s fixed default response cap was removed. Maximum response tokens is now optional; leaving it blank uses the provider’s own limits. When a provider reports that it stopped at a limit, the saved partial response is shown with an explanation. The configured default local model is `gemma4:12b`.

### Preserve continuity and keep writing reliable

Opening a topic now restores its latest saved user/assistant turn after a refresh, server restart, or topic switch. Older turns remain stored but hidden. The browser remembers the selected topic, and only recent complete exchanges that fit the context budget are sent to the model.

Notebook saves are serialized and revision-checked. A conflicting save preserves the local draft and offers export or reload. Topic navigation waits for notes to save successfully. Cancelled, failed, and interrupted replies remain visible when reopened but are excluded from future model context.

Browser checks also exposed a focus timing issue: a queued chat focus could take the cursor away just as notebook typing began. Queued focus now yields to a newer selection of another field.

## 2026-11-12 — Verso and a product introduction

The product is now called Verso. Browser titles, the installable app’s metadata, package names, and active configuration use the new name. Existing configuration names, browser preferences, and saved credentials remain usable; the database stays in the same location.

The README now introduces the purpose and philosophy, followed by short installation and usage instructions. Implementation history lives here, and development, storage, model configuration, and private hosting details live in the [development and hosting guide](docs/development.md).

The README screenshot shows the actual interface with a sample conversation and notes, captured against a separate temporary database. It illustrates composing a follow-up while the previous exchange remains available for reference.

Validation: the production build, 28 Python checks, and 28 desktop/mobile browser checks pass, including compatibility with earlier settings, credentials, browser preferences, and app caches.

## Still outside the prototype

Automatic summaries, full offline operation, mixed text/ink layouts, and conversation retrieval remain experiments from the [PRD](prd.md). There is no agent framework, vector database, cloud storage service, or automatic AI notebook editing. The current aim is to learn from a small, usable writing experience before adding those systems.

## 2026-11-12 — Contextual notebook actions

Selecting notebook text now offers Explore, Check, and Test Me in a small floating menu, in both Edit and Preview. Each action opens an exchange on the existing conversation page, preserves an unfinished chat draft, and leaves notes untouched. Test Me asks for one conceptual question, with feedback after the user's answer.

The first stage uses the selected passage and recent conversation from the same topic. Action metadata persists with the turn, so refreshes restore its label and follow-ups retain the original request within the context budget. SQLite migrates existing databases by adding one nullable column. No editor framework, retrieval service, or new dependency was added. Automatic note-to-conversation associations and full-text recall are deferred to later stages.

The floating menu felt intrusive during selection. The actions now stay in the notebook header as muted italic text, with Preview/Edit and Export using the same treatment. They act on a selected passage or, with nothing selected, the whole notebook. A small scope label makes that distinction visible. This also removes the selection-positioning code and keeps the writing surface clear.

Preview/Edit and Export then moved into a three-dot menu so the header could return to its compact layout, with the contextual actions at the top right. Keyboard navigation through the header preserves the selected passage; Escape closes the menu first without changing that scope.

The next refinement removes the menu and routine export control. Preview/Edit now sits inline after the three contextual actions, separated by a quiet vertical bar. Save status, word count, and action scope move into a tiny, borderless monospace footer. Draft export remains available only in save-conflict recovery.

Notebook typography now uses the app's sans-serif family for writing, preview text, controls, and status information. The controls are upright and distinguished by their muted color; preview headings use a lighter, consistent weight. Editing and preview share the same body size and line spacing. The conversation retains its serif typography.

## 2026-11-13 — Action names in the conversation

Contextual exchanges now open with the action name in bold serif text, followed by the notebook passage as a lightly indented quotation. This replaces the small metadata-style label and makes the request easier to recognize. The formatting survives refreshes; ordinary follow-up messages retain the usual diary styling.


## 2026-11-13 — Handwritten notebooks

Text and Ink are separate views within each topic. Ink adds pressure-sensitive pen strokes, whole-stroke erasing, undo/redo, portrait pages, touch scrolling through Move, and rectangular selection. Active ink is drawn directly on canvas; the existing text notebook and conversation remain available.

Editable strokes persist in SQLite schema v3. Completed edits are first queued to IndexedDB on the tablet, with page-level writes, revision checks, and retryable mutation IDs for lost acknowledgements. Conflicting devices retain both versions until the user chooses. Local storage and host save status are distinguished; this is recovery through brief outages, not full offline operation.

The contextual actions can now share an immutable PNG snapshot of the selected area or current page. Images survive conversation reloads and participate in bounded follow-up context. Model settings include an image-reading check based on a random code that appears only inside a generated image. A live check passed with the local `gemma4:12b`; its initial 64-token allowance was insufficient, so image verification now allows 1,024 output tokens for thinking models. Tablet pen feel and recognition of real handwriting still require a Galaxy Tab trial.

New dependencies are perfect-freehand for pressure-sensitive outlines and Pillow, managed with uv, for image validation and generated verification images. Automated checks cover migration, pen input, erasing, undo/redo, recovery, lost acknowledgements, conflicts, concurrent edits, resize/streaming behavior, and image follow-ups. No native wrapper, editor framework, OCR service, retrieval system, or cloud fallback was introduced.

Validation: the production build, 49 backend tests, and 60 desktop/mobile browser tests pass. Targeted ink and image checks also pass after the final page-storage and snapshot-sizing refinements.

## 2026-11-18 — Galaxy Tab trial and startup logging

The user confirmed that pressure-sensitive drawing feels good on the Galaxy Tab. The local model successfully read a handwritten Euler identity and a handwritten question about raising a real number to an imaginary power. Tablet access uses Windows Tailscale Serve forwarding to Verso in WSL, with the HTTPS origin explicitly allowed by the backend.

The launcher now disables colored server logs to avoid an interaction between LiteLLM's log redaction and Uvicorn's formatting that printed literal URL placeholders. Seven focused launcher/provider tests pass. Continuous canvas navigation, notebook zoom, and moving selected handwriting are still design discussions; this version retains separate ink pages.

## 2026-11-18 — Continuous handwriting and navigation

Ink now uses one continuous surface with room below and beside existing notes. Two fingers pan and pinch between 25% and 400%, with the writing anchored between the fingers. Move supports one-finger or mouse dragging; wheel and keyboard navigation are also available. A small footer control returns to the most recent writing at the normal scale, and the view is remembered for each topic in this browser. Pen input continues to use pressure and coalesced samples; touch navigation is ignored while writing.

Two viewport-sized canvas layers draw only visible strokes, with cached outlines and bounds. Writing stays in stable world coordinates. New strokes are grouped into bounded storage sections automatically, and erasing across sections is one undoable edit. Existing portrait pages are stacked in order when first opened. Their migration uses the existing IndexedDB recovery queue, revision checks, and mutation IDs, including older pending requests and newer unsaved edits. The database remains schema v3 and no dependency was added.

Contextual actions share the selected rectangle or the visible writing. A snapshot that would shrink a large area into illegible handwriting asks for a closer view or smaller selection. Previously shared images remain immutable. The README, hosting/development guide, and local planning roadmap describe the new behavior. Moving handwriting remains the next stage, with the agreed behavior of leaving empty space behind.

Browser testing caught a layout change discarding a stroke in progress; resizing now preserves that stroke. Automated checks cover actual browser pinch input, pen coordinates after navigation and resizing, view restoration, legacy draft migration with both unsent and acknowledged requests, cross-section undo/redo, snapshot cropping, recovery, and conflicts. The new gesture and palm feel still needs a Galaxy Tab trial.

Validation: the production build, 51 backend tests, and 70 desktop/mobile browser tests pass. The strengthened storage-capacity check also passes on both browser configurations: writing continues into another section while a reply streams, without rewriting earlier ink, and saved coordinates remain accurate after resizing.

## 2026-11-18 — Focused notes and adjustable split view

The user confirmed that pinch zoom works well on the tablet. The notebook now has a small expand/return control beside Text and Ink. Notes-only hides the desktop sidebar and conversation; returning restores the previous sidebar preference. A contextual notebook action opens split view automatically so the response and notes are available together. Phones retain Chat/Notebook shortcuts and gain Split.

Split view puts the conversation above notes in portrait and beside them in landscape. A subtle divider supports touch, pen, mouse, and keyboard resizing, with minimum pane sizes and a separate remembered ratio for each orientation. Double-clicking the divider or pressing Enter balances the panels. Text, ink, and chat remain mounted across layout changes so drafts, scrolling, writing coordinates, and streams continue normally. No dependency was added.

Validation: the production build and 78 desktop/mobile browser tests pass. New checks cover notes-only transitions, sidebar restoration, text drafts and scrolling, mouse/touch/keyboard divider controls, separate orientation preferences, actions returning to split view, ongoing responses, and zoomed handwriting after pen-driven resizing and tablet rotation. Portrait screenshots were also reviewed.
