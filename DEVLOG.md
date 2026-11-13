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

Handwriting, automatic summaries, offline synchronization, alternate writing modes, and conversation retrieval remain experiments from the [PRD](prd.md). There is no agent framework, vector database, cloud storage service, or automatic AI notebook editing. The current aim is to learn from a small, usable writing experience before adding those systems.

## 2026-11-12 — Contextual notebook actions

Selecting notebook text now offers Explore, Check, and Test Me in a small floating menu, in both Edit and Preview. Each action opens an exchange on the existing conversation page, preserves an unfinished chat draft, and leaves notes untouched. Test Me asks for one conceptual question, with feedback after the user's answer.

The first stage uses the selected passage and recent conversation from the same topic. Action metadata persists with the turn, so refreshes restore its label and follow-ups retain the original request within the context budget. SQLite migrates existing databases by adding one nullable column. No editor framework, retrieval service, or new dependency was added. Automatic note-to-conversation associations and full-text recall are deferred to later stages.

The floating menu felt intrusive during selection. The actions now stay in the notebook header as muted italic text, with Preview/Edit and Export using the same treatment. They act on a selected passage or, with nothing selected, the whole notebook. A small scope label makes that distinction visible. This also removes the selection-positioning code and keeps the writing surface clear.

Preview/Edit and Export then moved into a three-dot menu so the header could return to its compact layout, with the contextual actions at the top right. Keyboard navigation through the header preserves the selected passage; Escape closes the menu first without changing that scope.

The next refinement removes the menu and routine export control. Preview/Edit now sits inline after the three contextual actions, separated by a quiet vertical bar. Save status, word count, and action scope move into a tiny, borderless monospace footer. Draft export remains available only in save-conflict recovery.

Notebook typography now uses the app's sans-serif family for writing, preview text, controls, and status information. The controls are upright and distinguished by their muted color; preview headings use a lighter, consistent weight. Editing and preview share the same body size and line spacing. The conversation retains its serif typography.

## 2026-11-13 — Action names in the conversation

Contextual exchanges now open with the action name in bold serif text, followed by the notebook passage as a lightly indented quotation. This replaces the small metadata-style label and makes the request easier to recognize. The formatting survives refreshes; ordinary follow-up messages retain the usual diary styling.
