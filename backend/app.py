import asyncio
import re
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .conversation import Conversations
from .config import env
from .credentials import Credentials
from .models import ConversionAppendInput, MessageInput, ModelSettings, NotebookInput, SettingsInput, TopicInput, TranscriptionInput
from .provider import LiteLLMProvider, public_error
from .storage import Store
from .ink import InkPageInput, vision_challenge
from .provider import user_content

ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path=None, provider=None, credentials=None):
    @asynccontextmanager
    async def lifespan(app):
        path = Path(db_path or env("DB", str(ROOT / "data" / "notebook.sqlite3")))
        app.state.store = Store(path)
        app.state.credentials = credentials or Credentials()
        app.state.provider = provider or LiteLLMProvider()
        app.state.conversations = Conversations(app.state.store, app.state.provider, app.state.credentials)
        app.state.settings_epoch = 0
        yield
        await app.state.conversations.shutdown()

    app = FastAPI(title="Verso", lifespan=lifespan, docs_url=None, redoc_url=None)
    origins = {"http://127.0.0.1:8000", "http://localhost:8000",
               "http://127.0.0.1:5173", "http://localhost:5173"}
    origins.update(value.strip().rstrip("/") for value in env("ORIGINS", "").split(",") if value.strip())
    hosts = {urlparse(origin).hostname for origin in origins}
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=sorted(hosts))

    @app.middleware("http")
    async def protect_origin(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "Cross-site requests are not allowed."}, status_code=403)
            if (origin := request.headers.get("origin")) and origin not in origins:
                return JSONResponse({"detail": "Origin is not allowed."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's default response includes rejected input, which may contain keys.
        errors = [{"field": ".".join(str(part) for part in error["loc"][1:]),
                   "message": error["msg"]} for error in exc.errors()]
        return JSONResponse({"detail": "; ".join(f"{e['field']}: {e['message']}" for e in errors)}, status_code=422)

    def store():
        return app.state.store

    def require_topic(topic_id):
        topic = store().topic(topic_id)
        if not topic:
            raise HTTPException(404, "Topic not found.")
        return topic

    def settings_view():
        settings = store().settings()
        _, source = app.state.credentials.get(settings)
        return {**settings.model_dump(), "key_source": source,
                "vision_verified": store().vision_verified(settings),
                "keyring_available": app.state.credentials.backend is not None}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/topics")
    def topics():
        return store().topics()

    @app.post("/api/topics", status_code=201)
    def create_topic(value: TopicInput):
        return store().create_topic(value.title)

    @app.patch("/api/topics/{topic_id}")
    def rename_topic(topic_id: str, value: TopicInput):
        if not store().rename_topic(topic_id, value.title):
            raise HTTPException(404, "Topic not found.")
        return {"id": topic_id, "title": value.title}

    @app.delete("/api/topics/{topic_id}", status_code=204)
    async def delete_topic(topic_id: str):
        if topic_id in app.state.conversations.active:
            raise HTTPException(409, "Stop this topic's response before deleting it.")
        # Keep the check and deletion together; neither yields to a new generation.
        if not store().delete_topic(topic_id):
            raise HTTPException(404, "Topic not found.")

    @app.get("/api/topics/{topic_id}/latest-turn")
    def latest_turn(topic_id: str):
        require_topic(topic_id)
        return store().latest_turn(topic_id)

    @app.get("/api/topics/{topic_id}/notebook")
    def notebook(topic_id: str):
        topic = require_topic(topic_id)
        return {"markdown": topic["markdown"], "revision": topic["revision"]}

    @app.put("/api/topics/{topic_id}/notebook")
    def save_notebook(topic_id: str, value: NotebookInput):
        require_topic(topic_id)
        revision = store().save_notebook(topic_id, value.markdown, value.revision)
        if revision is None:
            raise HTTPException(409, "This notebook changed on another device. Export your draft, then reload the saved version.")
        return {"revision": revision}

    @app.get("/api/topics/{topic_id}/export")
    def export_notebook(topic_id: str):
        topic = require_topic(topic_id)
        filename = re.sub(r"[^a-zA-Z0-9_-]+", "-", topic["title"]).strip("-") or "notebook"
        return Response(topic["markdown"], media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}.md"'})

    @app.post("/api/topics/{topic_id}/notebook/append-conversion")
    def append_conversion(topic_id: str, value: ConversionAppendInput):
        try:
            result = store().append_conversion(topic_id, str(value.id), value.markdown, value.scope)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        except OverflowError as exc:
            raise HTTPException(400, str(exc)) from exc
        if result is None:
            raise HTTPException(404, "Topic not found.")
        return result

    @app.post("/api/topics/{topic_id}/transcribe")
    async def transcribe(topic_id: str, value: TranscriptionInput):
        generation = await app.state.conversations.start_transcription(topic_id, value.image)
        return StreamingResponse(app.state.conversations.events(generation), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"})

    @app.get("/api/topics/{topic_id}/ink-pages")
    def ink_pages(topic_id: str):
        require_topic(topic_id)
        return store().ink_pages(topic_id)

    @app.put("/api/topics/{topic_id}/ink-pages/{page_id}")
    def save_ink_page(topic_id: str, page_id: UUID, value: InkPageInput):
        require_topic(topic_id)
        revision = store().save_ink_page(topic_id, str(page_id), value)
        if revision is None:
            raise HTTPException(409, "This ink page changed on another device. Your tablet draft is preserved.")
        return {"revision": revision}

    @app.post("/api/topics/{topic_id}/messages")
    async def message(topic_id: str, value: MessageInput):
        if not value.content.strip():
            raise HTTPException(400, "Write a message first.")
        generation = await app.state.conversations.start(topic_id, value.content.strip(), value.action, value.image)
        return StreamingResponse(app.state.conversations.events(generation), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"})

    @app.post("/api/generations/{generation_id}/cancel")
    async def cancel(generation_id: str):
        for generation in list(app.state.conversations.active.values()):
            if generation.id == generation_id:
                await app.state.conversations.cancel(generation)
                break
        return {"status": "stopped"}

    @app.get("/api/settings")
    def get_settings():
        return settings_view()

    @app.put("/api/settings")
    async def put_settings(value: SettingsInput):
        if app.state.conversations.active:
            raise HTTPException(409, "Stop the active response before changing model settings.")
        app.state.settings_epoch += 1
        # Keys and settings are updated together on the event loop, before new requests start.
        if value.clear_key:
            try:
                app.state.credentials.clear(value)
            except RuntimeError as exc:
                raise HTTPException(503, str(exc)) from exc
        if value.api_key and value.api_key.strip():
            try:
                app.state.credentials.set(value, value.api_key.strip(), value.remember_key)
            except RuntimeError as exc:
                raise HTTPException(503, str(exc)) from exc
        if value.clear_key or value.api_key:
            store().set_vision_verified()
        store().save_settings(value)
        return settings_view()

    @app.post("/api/settings/test-vision")
    async def test_vision():
        if app.state.conversations.active:
            raise HTTPException(409, "Stop the active response before testing image support.")
        settings = store().settings()
        epoch = app.state.settings_epoch
        key, _ = app.state.credentials.get(settings)
        if settings.mode == "cloud" and not key:
            raise HTTPException(400, "Add an API key first.")
        store().set_vision_verified()
        code, image = vision_challenge()
        messages = [{"role": "user", "content": user_content(
            "Read the eight-character code at the top of this image. Reply with only that code.", image=image)}]
        # Thinking models may consume output tokens before returning the short code.
        stream = app.state.provider.stream(settings.model_copy(update={"max_output_tokens": 1024}), messages, key)
        try:
            answer = ""
            async with asyncio.timeout(120):
                async for text in stream:
                    answer += text
            if not re.search(rf"\b{code}\b", answer.upper()):
                raise HTTPException(502, "The model could not read the test image. Choose an image-capable model and retry. Text chat still works.")
            if epoch != app.state.settings_epoch or store().connection(store().settings()) != store().connection(settings):
                raise HTTPException(409, "Model settings changed during the check. Test again.")
            store().set_vision_verified(settings)
            return settings_view()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, "Image support could not be verified. " + public_error(exc)) from None
        finally:
            await stream.aclose()

    @app.post("/api/settings/test")
    async def test_connection():
        settings = await asyncio.to_thread(store().settings)
        key, _ = await asyncio.to_thread(app.state.credentials.get, settings)
        if settings.mode == "cloud" and not key:
            raise HTTPException(400, "Add an API key first.")
        stream = app.state.provider.stream(settings.model_copy(update={"max_output_tokens": 64}),
                                           [{"role": "user", "content": "Reply with OK."}], key)
        try:
            async with asyncio.timeout(120):
                async for text in stream:
                    if text:
                        return {"status": "ok"}
            raise HTTPException(502, "The model returned no text.")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, public_error(exc)) from None
        finally:
            await stream.aclose()

    dist = ROOT / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    else:
        @app.get("/")
        def missing_frontend():
            return JSONResponse({"detail": "Run npm install && npm run build, or use npm run dev."})
    return app


app = create_app()
