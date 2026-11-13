# PRD: Verso — AI Conversations & Persistent Notes

**Status:** Initial prototype  
**Platform:** Desktop-first web app, tablet-compatible architecture  
**Working tagline:** _A diary that forgets, and a notebook that remembers._

## 1. Product Vision

Create a minimalist, local-first LLM conversation interface designed to promote active thinking, learning, and reflection rather than passive consumption of AI-generated information.

Unlike conventional chat applications, the interface does not display an ever-growing conversation history. Instead, conversations are ephemeral, while notes deliberately authored by the user persist.

The goal is to shift the primary output of an AI interaction from **what the AI produced** to **what the user understood and chose to remember**.

Potential applications include learning unfamiliar subjects, brainstorming, journaling, and developing a deeper understanding of AI-generated code.

## 2. Design Philosophy

### 2.1 Conversation is temporary; understanding persists

The conversation is a workspace for thinking, not an archive.

- Only the current exchange is visible.
- Previous exchanges disappear when the conversation advances.
- The LLM retains conversational context internally during the session, even though the user cannot scroll backward.
- User-authored notes remain visible and persist across sessions.

Ephemeral means hidden from the interface, not necessarily immediately deleted from the model's context.

### 2.2 Active learning over passive consumption

Conventional LLM interfaces make it easy to accumulate large volumes of information without deeply processing them.

This application should encourage users to:

- Summarize concepts in their own words.
- Ask follow-up questions rather than passively accepting explanations.
- Write, revise, and connect ideas.
- Develop their own understanding instead of relying on perfectly formatted AI-generated reports.

**The notebook is the primary artifact. The conversation is a tool for developing it.**

### 2.3 Deliberate friction can be useful

Not all friction is bad.

Some actions—writing a summary, recalling a concept, manually reviewing code—require cognitive effort that may support understanding.

The interface should remove unnecessary friction while preserving opportunities for meaningful mental engagement.

However, constraints should feel helpful rather than punitive. Avoid forcing users into rigid workflows or introducing artificial time pressure by default.

### 2.4 The user owns their notes

Notes should be genuinely user-authored.

- AI must not silently modify or overwrite notes.
- AI-generated summaries should not automatically populate the notebook.
- Users control what information is worth preserving.
- AI may discuss, critique, or suggest improvements to notes, but users decide what to write.

### 2.5 Local-first, lightweight, model-agnostic

The application should be usable with local LLMs and should not require an account, subscription, or cloud backend.

Optional bring-your-own-key (BYOK) support should allow users to access more powerful hosted models.

The notebook and interface should remain fully functional when no model is available.

## 3. MVP Features

### 3.1 Ephemeral conversation interface

A minimalist conversation area displaying only the current exchange.

Requirements:

- Text input and streaming LLM responses.
- Display the current user message and assistant response.
- When the user submits another message, remove the previous exchange from view.
- No scrollable chat transcript or conversation-history sidebar.
- Preserve previous turns in the model's active session context.
- Allow users to ask follow-up questions referring to earlier messages.
- Support cancellation of an in-progress generation.

Conversations should feel natural rather than artificially constrained.

Prefer reasonably concise responses, but allow deeper explanations when explicitly requested.

### 3.2 Persistent user notebook

A note-taking panel alongside the conversation.

Requirements:

- Simple text editor with basic Markdown support.
- Automatic local persistence.
- Notes remain visible while the conversation advances.
- Notes survive application restarts.
- Manual editing, deletion, and reorganization.
- Export to Markdown.
- No automatic AI edits.

For the prototype, one notebook per conversation/topic is sufficient. Avoid building a complex knowledge-management system.

### 3.3 Local LLM and BYOK support

Provide a model abstraction supporting:

- Local LLM inference through an OpenAI-compatible endpoint, such as Ollama.
- Configurable model name and endpoint.
- Optional cloud providers using user-supplied API keys.
- Streaming responses.
- Graceful handling of unavailable models, failed requests, and slow inference.

Model selection should be independent of the UI and conversation-management logic.

Cloud connectivity must be optional and explicit. API keys should be stored securely on the user's device, never in tracked files or logs.

### 3.4 Session management and storage

- Users can start a new session or topic.
- Each session has an associated persistent notebook.
- Conversation context is retained internally while the session is active.
- For the MVP, conversation context may be transient and discarded when a session ends or the application restarts.
- Notes must persist regardless of conversation retention.
- Make it clear to users that hidden conversation history is not the same as permanent memory.

Use simple local storage, such as SQLite or local files. No hosted database is required.

### 3.5 Minimalist UI

Desktop layout:

- Left: ephemeral conversation.
- Right: persistent notebook.
- Both panels visible simultaneously, with adjustable widths if straightforward.
- Calm, distraction-free visual design.
- Keyboard-friendly interactions.
- Responsive layout that can eventually accommodate tablets.

The visual inspiration is an enchanted diary, but avoid overinvesting in animations, simulated handwriting, or decorative effects during the MVP.

## 4. Post-MVP Features / Experiments

These ideas are worth preserving but should **not block the initial implementation**.

### 4.1 Append-only or visible-edit conversation

Experiment with making the process of writing more deliberate.

Possible modes:

- Normal editing.
- No deletion or modification of previously written text.
- Corrections remain visible as strikethroughs.
- The LLM can interpret both the original text and corrections.

Explore whether this encourages more reflective, less excessively polished communication.

### 4.2 Tablet handwriting

Add stylus-based note-taking with persistent handwritten pages.

Possible capabilities:

- Freehand drawing and handwriting.
- Diagrams, equations, and annotations.
- Written notes beside an ephemeral AI conversation.
- Local storage of original pen strokes.

Handwriting should remain useful without AI processing.

### 4.3 Passive awareness of handwritten notes

Allow the LLM to understand what the user is writing without requiring explicit submission.

Potential implementation:

1. Detect inactivity after handwriting input.
2. Process only changed regions of the notebook.
3. Run local handwriting recognition where feasible.
4. Maintain an updated representation of the notebook for the LLM.
5. Invoke more expensive vision reasoning only when necessary.

**Important:** Handwriting responsiveness must never depend on LLM inference speed. AI processing should be asynchronous, interruptible, and non-blocking.

### 4.4 Conversational note review

Let users select, highlight, or circle part of their notes and ask questions about it.

Example: "Is my explanation of the event loop correct?"

The AI should offer feedback without silently rewriting the note.

### 4.5 Active recall and reflection

Optional interactions might include:

- Asking users to explain concepts in their own words.
- Reconstructing key ideas after a conversation disappears.
- Identifying misunderstandings in user-authored notes.
- Revisiting previous concepts through questions.

These should remain optional, not intrusive.

### 4.6 Conversational memory retrieval

Allow users to ask the AI to recall a previous exchange without introducing a conventional conversation-history browser.

This would require deliberately retained conversation data, with clear privacy and retention controls.

## 5. Non-Goals

The initial implementation is **not** intended to be:

- A fully featured ChatGPT replacement.
- A Notion or Obsidian competitor.
- A rich-text document editor.
- An autonomous AI research or coding agent.
- A cloud synchronization service.
- A handwriting recognition system.
- A complex agentic memory architecture.
- A gamified learning platform.

Avoid unnecessary infrastructure, authentication, analytics, background agents, and speculative features.

The MVP should test the interaction model, not maximize features.

## 6. Key UX Questions to Explore

The prototype should help answer:

1. Does hiding conversation history encourage users to pay closer attention to responses?
2. Does a persistent user-authored notebook encourage active note-taking?
3. Do users produce more meaningful notes when AI-generated reports are less accessible?
4. Does the absence of scrolling feel liberating or frustrating?
5. Can useful cognitive friction improve an experience without making it unpleasant?
6. Do users prefer a visible transcript, an ephemeral interface, or an ephemeral interface with selective memory?

These are hypotheses, not established product benefits.

## 7. MVP Acceptance Criteria

The first prototype is complete when:

- [ ] A user can start a topic and converse with a local LLM.
- [ ] Only the latest exchange is visible.
- [ ] The model maintains context across successive exchanges.
- [ ] A persistent notebook is displayed alongside the conversation.
- [ ] Notebook changes autosave and survive application restarts.
- [ ] Users can export their notes.
- [ ] Users can configure a local endpoint and optionally a cloud API endpoint.
- [ ] The interface remains responsive during slow or failed inference.
- [ ] Core functionality works without authentication, cloud storage, or an internet connection when using a local model.
- [ ] The codebase remains modular enough to support handwritten notes and alternative conversation modes later.

## 8. Architecture Decision: React PWA + Self-Hosted Backend

The MVP will be built as a responsive React + TypeScript application using Vite, with Progressive Web App support.

A lightweight Python FastAPI backend will serve the application, manage session context, persist notes in SQLite, and route LLM requests to local Ollama or optional BYOK providers.

The application must support private remote access through Tailscale, allowing the same self-hosted instance to be used from desktop browsers, Android phones, and tablets.

**Architectural constraints:**

- No dedicated native desktop or Android application in the MVP.
- No mandatory public cloud infrastructure or user accounts.
- Serve frontend and backend through a single origin where practical.
- Never expose local LLM services or API keys directly to remote browsers.
- Design the frontend responsively, with desktop split-screen and mobile-friendly views.
- Keep notebook interactions independent of LLM inference latency.
- Use SQLite on the host as the initial persistence layer.
- Defer offline synchronization and native packaging.
- Preserve compatibility with future stylus-based handwriting and local-first note synchronization.

The priority is a single, lightweight codebase that is easy to develop locally and test on real devices through Tailscale.

## 9. References & Inspiration

### Interface experiments

**Riddle — Maxime Rivest**  
https://github.com/MaximeRivest/riddle

A reMarkable tablet application inspired by Tom Riddle's diary. Handwriting disappears into the page and the LLM responds in animated handwriting. Also explores conversational retrieval of stored memories.

**BOOX Riddle Diary**  
https://github.com/billtt/boox-riddle-diary

A similar handwritten, ephemeral LLM interface for Android e-ink tablets.

**Echo — Stream Your Mind**  
https://translator.tools/echo

An AI-assisted reflection app exploring forward-only writing, with an optional mode that prevents editing and encourages continuous thought.

**The Most Dangerous Writing App**  
https://github.com/maebert/themostdangerouswritingapp

An extreme example of intentional interface constraints, designed to encourage writing without constant self-editing.

### Relevant research

**Barnea, Meyer & Nave (2023) — The Effects of Content Ephemerality on Information Processing**  
https://doi.org/10.1177/00222437221131047

Experimental evidence that limiting opportunities to revisit information can increase attention, processing effort, comprehension, and recall. The findings motivate the ephemeral-interface hypothesis but do not directly validate LLM chat applications.

**Kreijkes et al. (2026) — Effects of LLM Use and Note-Taking on Reading Comprehension and Memory**  
https://doi.org/10.1016/j.compedu.2025.105514

A randomized educational study in which note-taking alone or combined with LLM use improved comprehension and retention relative to LLM-only use.

**Flanigan et al. (2024) — Typed Versus Handwritten Lecture Notes and College Student Achievement**  
https://doi.org/10.1007/s10648-024-09914-w

A meta-analysis reporting a modest learning advantage for handwritten over typed lecture notes. Motivation for future tablet functionality, rather than a reason to require handwriting.

## 9. Implementation Direction for Codex

Build the **smallest usable vertical slice** first.

Suggested sequence:

1. Establish the application shell and two-panel layout.
2. Implement an ephemeral conversation interface with a mock model.
3. Add model-provider abstraction and local LLM connectivity.
4. Implement the persistent notebook and local storage.
5. Add BYOK support, settings, and error handling.
6. Refine interaction details and validate the complete experience.

Favor simple, maintainable architecture over extensibility for hypothetical future requirements.

Do not implement deferred features unless explicitly requested.

Where product decisions remain ambiguous, choose the simplest reversible implementation and document the tradeoff.

**Guiding principle:** The application should help users think _with_ AI, rather than merely consume what AI thinks for them.
