import asyncio
import json
import time
from contextlib import suppress
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException

from .provider import build_context, public_error
from .transcription import clean_transcription, transcription_context


@dataclass
class Generation:
    topic_id: str
    id: str = field(default_factory=lambda: str(uuid4()))
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    task: asyncio.Task | None = None
    started: asyncio.Event = field(default_factory=asyncio.Event)
    cancelling: bool = False


class Conversations:
    def __init__(self, store, provider, credentials):
        self.store, self.provider, self.credentials = store, provider, credentials
        self.active: dict[str, Generation] = {}

    async def start(self, topic_id, content, action=None, image=None):
        if topic_id in self.active:
            raise HTTPException(409, "This topic already has a response in progress.")
        generation = Generation(topic_id)
        self.active[topic_id] = generation
        try:
            if not await asyncio.to_thread(self.store.topic, topic_id):
                raise HTTPException(404, "Topic not found.")
            settings = await asyncio.to_thread(self.store.settings)
            verified = await asyncio.to_thread(self.store.vision_verified, settings)
            if image and not verified:
                raise HTTPException(400, "Verify image support in Model settings before sharing handwriting. Text chat still works.")
            key, _ = await asyncio.to_thread(self.credentials.get, settings)
            if settings.mode == "cloud" and not key:
                raise HTTPException(400, "Add an API key in model settings before using a hosted provider.")
            history = await asyncio.to_thread(self.store.history, topic_id)
            try:
                messages, omitted = build_context(history, content, settings, action, image, include_images=verified)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            await asyncio.to_thread(self.store.start_turn, topic_id, generation.id, content, action, image)
            generation.queue.put_nowait({"type": "start", "generation_id": generation.id,
                                         "omitted_turns": omitted})
            generation.task = asyncio.create_task(self._run(generation, settings, messages, key))
            return generation
        except BaseException:
            self.active.pop(topic_id, None)
            raise

    async def _run(self, generation, settings, messages, key):
        generation.started.set()
        text, status, error = "", "complete", None
        checkpoint = time.monotonic()
        try:
            async with asyncio.timeout(300):
                async for delta in self.provider.stream(settings, messages, key):
                    text += delta
                    generation.queue.put_nowait({"type": "delta", "text": delta})
                    if time.monotonic() - checkpoint > 1:
                        await asyncio.to_thread(self.store.update_turn, generation.id, text)
                        checkpoint = time.monotonic()
            if not text:
                status, error = "failed", "The model returned no text. Check the model and try again."
        except asyncio.CancelledError:
            status = "cancelled"
        except Exception as exc:
            status, error = "failed", public_error(exc)
        finally:
            try:
                await asyncio.to_thread(self.store.update_turn, generation.id, text, status)
            except Exception:
                status, error = "failed", "Could not save this exchange. Check the host's storage."
            self.active.pop(generation.topic_id, None)
            if error:
                generation.queue.put_nowait({"type": "error", "message": error})
            generation.queue.put_nowait({"type": "done", "status": status})

    async def start_transcription(self, topic_id, image):
        if topic_id in self.active:
            raise HTTPException(409, "This topic already has a response or conversion in progress.")
        generation = Generation(topic_id)
        self.active[topic_id] = generation
        try:
            if not await asyncio.to_thread(self.store.topic, topic_id):
                raise HTTPException(404, "Topic not found.")
            settings = await asyncio.to_thread(self.store.settings)
            if not await asyncio.to_thread(self.store.vision_verified, settings):
                raise HTTPException(400, "Verify image support in Model settings before converting handwriting.")
            key, _ = await asyncio.to_thread(self.credentials.get, settings)
            if settings.mode == "cloud" and not key:
                raise HTTPException(400, "Add an API key in model settings before using a hosted provider.")
            try:
                messages = transcription_context(image, settings)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            generation.queue.put_nowait({"type": "start", "generation_id": generation.id, "omitted_turns": 0})
            generation.task = asyncio.create_task(self._transcribe(generation, settings, messages, key))
            return generation
        except BaseException:
            self.active.pop(topic_id, None)
            raise

    async def _transcribe(self, generation, settings, messages, key):
        generation.started.set()
        text, status, error = "", "complete", None
        stream = self.provider.stream(settings, messages, key)
        try:
            async with asyncio.timeout(300):
                async for delta in stream:
                    text += delta
                    if len(text) > 200_000:
                        status, error = "failed", "The transcription is too long. Select a smaller area."
                        break
            text = clean_transcription(text)
            if not text:
                status, error = "failed", "The model returned no transcription. Try a smaller or clearer selection."
        except asyncio.CancelledError:
            status = "cancelled"
        except Exception as exc:
            status, error = "failed", public_error(exc)
        finally:
            with suppress(Exception):
                await stream.aclose()
            self.active.pop(generation.topic_id, None)
            # A conversion never changes conversation history or the notebook.
            # Only a complete result can be passed to the separate append step.
            if status == "complete":
                generation.queue.put_nowait({"type": "transcription", "markdown": text})
            if error:
                generation.queue.put_nowait({"type": "error", "message": error})
            generation.queue.put_nowait({"type": "done", "status": status})

    async def cancel(self, generation):
        if generation.task and not generation.task.done():
            # Cancelling a task before its first step skips its finally block.
            await generation.started.wait()
            if not generation.cancelling and not generation.task.done():
                generation.cancelling = True
                generation.task.cancel()
            with suppress(asyncio.CancelledError):
                await asyncio.shield(generation.task)

    async def events(self, generation):
        try:
            while True:
                try:
                    event = await asyncio.wait_for(generation.queue.get(), timeout=10)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"
                if event["type"] == "done":
                    break
        finally:
            await self.cancel(generation)

    async def shutdown(self):
        for generation in list(self.active.values()):
            await self.cancel(generation)
