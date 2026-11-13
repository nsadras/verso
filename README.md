# Verso

A quiet workspace for thinking with AI and keeping your own notes.

Verso puts a conversation beside a notebook. Ask a question, work through an explanation, and write down what you understand in your own words. The conversation moves forward one exchange at a time; the notebook holds what you choose to keep.

![An example conversation about vectors and covectors beside a notebook of personal notes, with a follow-up question being composed.](docs/images/conversation.png)

*An in-progress conversation in the actual app, shown with sample content.*

## Why it works this way

**The notebook is the primary artifact.** The conversation helps you develop it. Verso makes room to question an explanation, connect it to something you know, and decide what is worth remembering.

You and the AI write on one continuous surface. The previous exchange stays visible while you compose a follow-up, then gently moves out of view when you send it. Your notebook remains beside you. It autosaves and belongs entirely to you. The AI sees only the passages you choose to share and never edits your notes.

Only the current exchange is visible. Older exchanges remain stored on your host, and recent turns provide context to the model. Your latest exchange and saved notes return when you reopen a topic.

The app runs on your own machine with a local model. Hosted providers are optional, using your own API key. The notebook works even when a model is unavailable.

## Get started

You’ll need Python 3.13+, [uv](https://docs.astral.sh/uv/), Node.js 22.12+ (or 24+), and a running local model server such as Ollama with a model already installed.

From a checkout of this repository:

```bash
uv sync --locked
npm ci
npm run build
uv run main.py
```

Open **http://127.0.0.1:8000**. Choose **Local model** at the bottom of the sidebar, enter your installed model’s name, and select **Save & test connection**.

The defaults are `gemma4:12b` and `http://127.0.0.1:11434/v1`. Verso does not download models. Match **Context window** to your model server’s configuration; leave **Maximum response tokens** blank to use the model’s own limits.

## Find your rhythm

- **Start a topic.** Use **New chat**; each topic has its own conversation and notebook.
- **Write on the page.** Click blank space in the chat to begin. **Enter** sends; **Shift+Enter** adds a line. Continue beneath the reply. Click the small pulsing dot to stop a response.
- **Keep what matters.** Write your notes on the right. **Preview**, beside the contextual actions, renders Markdown, tables, and math; **Edit** returns to the source. A small footer shows save status, word count, and whether actions apply to a selected passage or the whole notebook.
- **Work with an idea.** Use **Explore**, **Check**, or **Test Me** in the notebook header for deeper connections, a review, or one question to answer. Highlight a passage in Edit or Preview to focus the action; with nothing selected, it uses the whole notebook. Your notes and any unfinished chat draft stay intact.
- **Make room.** Collapse the sidebar with the icon beside **New chat**. Long replies scroll; the little arrow indicates more text below. On a phone, use the **Chat** and **Notebook** tabs.

Notes and conversations are stored on the machine running the app, in `data/notebook.sqlite3` by default. The app has no login and is intended for local or trusted private access.

For development, hosted models, backups, and private access from other devices, see the [development and hosting guide](docs/development.md). The [devlog](DEVLOG.md) records how the prototype evolved; the [PRD](prd.md) describes the original vision and future experiments.
