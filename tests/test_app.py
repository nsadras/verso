import asyncio
import json
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.conversation import Conversations
from backend.credentials import Credentials
from backend.models import ModelSettings
from backend.provider import ResponseLimitReached, build_context
from backend.storage import Store


class FakeProvider:
    def __init__(self, fail=False, slow=False, limited=False):
        self.calls = []
        self.fail, self.slow = fail, slow
        self.limited = limited
        self.produced = asyncio.Event()
        self.closed = False

    async def stream(self, settings, messages, api_key):
        self.calls.append(messages)
        try:
            yield "A useful "
            self.produced.set()
            if self.slow:
                await asyncio.sleep(60)
            if self.fail:
                raise RuntimeError("PRIVATE PROVIDER ERROR sk-do-not-leak")
            yield "answer."
            if self.limited:
                raise ResponseLimitReached()
        finally:
            self.closed = True


def memory_credentials(monkeypatch):
    monkeypatch.delenv("VERSO_API_KEY", raising=False)
    monkeypatch.delenv("EPHEMERAL_API_KEY", raising=False)
    credentials = Credentials()
    credentials.backend = None
    return credentials


@pytest.fixture
def setup_app(tmp_path, monkeypatch):
    provider = FakeProvider()
    credentials = memory_credentials(monkeypatch)
    path = tmp_path / "app.sqlite3"
    app = create_app(path, provider, credentials)
    with TestClient(app, base_url="http://localhost:8000") as client:
        yield client, provider, path, credentials


def events(response):
    assert response.status_code == 200, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def new_topic(client, title="Learning"):
    response = client.post("/api/topics", json={"title": title})
    assert response.status_code == 201
    return response.json()["id"]


def test_notebook_survives_restart_and_exports_exactly(setup_app):
    client, _, path, credentials = setup_app
    topic = new_topic(client)
    markdown = "# Understanding\n\nMy own words — 日本語.\n"
    response = client.put(f"/api/topics/{topic}/notebook", json={"markdown": markdown, "revision": 0})
    assert response.json() == {"revision": 1}
    assert client.get(f"/api/topics/{topic}/export").text == markdown
    with TestClient(create_app(path, FakeProvider(), credentials), base_url="http://localhost:8000") as restarted:
        assert restarted.get(f"/api/topics/{topic}/notebook").json() == {"markdown": markdown, "revision": 1}


def test_stale_save_does_not_overwrite_notes(setup_app):
    client, *_ = setup_app
    topic = new_topic(client)
    url = f"/api/topics/{topic}/notebook"
    assert client.put(url, json={"markdown": "newer", "revision": 0}).status_code == 200
    assert client.put(url, json={"markdown": "stale", "revision": 0}).status_code == 409
    assert client.get(url).json()["markdown"] == "newer"


def test_hidden_history_persists_and_topics_are_isolated(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    result = events(client.post(f"/api/topics/{topic}/messages", json={"content": "Remember the word cedar."}))
    assert result[0]["type"] == "start"
    assert "".join(event["text"] for event in result if event["type"] == "delta") == "A useful answer."
    assert result[-1]["status"] == "complete"
    expected = {"user_text": "Remember the word cedar.", "assistant_text": "A useful answer.", "status": "complete"}
    latest = client.get(f"/api/topics/{topic}/latest-turn")
    assert latest.json() == expected
    assert latest.headers["cache-control"] == "no-store"
    with TestClient(create_app(path, provider, credentials), base_url="http://localhost:8000") as restarted:
        assert restarted.get(f"/api/topics/{topic}/latest-turn").json() == expected
        assert len(provider.calls) == 1
        events(restarted.post(f"/api/topics/{topic}/messages", json={"content": "What word?"}))
        assert restarted.get(f"/api/topics/{topic}/latest-turn").json() == {**expected, "user_text": "What word?"}
        assert provider.calls[-1][1]["content"] == "Remember the word cedar."
        assert provider.calls[-1][2]["content"] == "A useful answer."
        second = new_topic(restarted, "Another topic")
        events(restarted.post(f"/api/topics/{second}/messages", json={"content": "Hello"}))
        assert len(provider.calls[-1]) == 2
        assert "cedar" not in restarted.get("/api/topics").text
        assert restarted.get(f"/api/topics/{topic}/history").status_code == 404
        assert restarted.get(f"/api/topics/{topic}/notebook").json()["markdown"] == ""
        assert restarted.get(f"/api/topics/{second}/latest-turn").json()["user_text"] == "Hello"


def test_latest_turn_is_empty_for_new_topics_and_missing_topics_are_rejected(setup_app):
    client, provider, *_ = setup_app
    topic = new_topic(client)
    response = client.get(f"/api/topics/{topic}/latest-turn")
    assert response.status_code == 200
    assert response.json() is None
    assert client.get("/api/topics/missing/latest-turn").status_code == 404
    assert provider.calls == []


@pytest.mark.parametrize("status,text", [
    ("cancelled", "Saved partial reply"), ("failed", ""),
    ("interrupted", "Saved partial reply"), ("running", "Last checkpoint"),
])
def test_latest_partial_turn_survives_restart_without_becoming_context(setup_app, status, text):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    events(client.post(f"/api/topics/{topic}/messages", json={"content": "Older completed exchange"}))
    store = client.app.state.store
    store.start_turn(topic, "latest-partial", "Latest question")
    store.update_turn("latest-partial", text, status)
    expected = {"user_text": "Latest question", "assistant_text": text, "status": status}
    assert client.get(f"/api/topics/{topic}/latest-turn").json() == expected
    with TestClient(create_app(path, provider, credentials), base_url="http://localhost:8000") as restarted:
        if status == "running":
            expected["status"] = "interrupted"
        assert restarted.get(f"/api/topics/{topic}/latest-turn").json() == expected
        assert restarted.app.state.store.history(topic) == [{
            "user_text": "Older completed exchange", "assistant_text": "A useful answer.",
        }]
        assert len(provider.calls) == 1


def test_provider_failure_is_redacted_and_excluded_from_context(setup_app):
    client, provider, path, _ = setup_app
    topic = new_topic(client)
    provider.fail = True
    response = client.post(f"/api/topics/{topic}/messages", json={"content": "A failed turn"})
    assert "sk-do-not-leak" not in response.text
    assert events(response)[-1]["status"] == "failed"
    provider.fail = False
    events(client.post(f"/api/topics/{topic}/messages", json={"content": "Try another"}))
    assert len(provider.calls[-1]) == 2
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT assistant_text,status FROM turns ORDER BY sequence LIMIT 1").fetchone() == ("A useful ", "failed")


def test_delete_removes_notes_and_history(setup_app):
    client, _, path, _ = setup_app
    topic = new_topic(client)
    events(client.post(f"/api/topics/{topic}/messages", json={"content": "Hello"}))
    assert client.delete(f"/api/topics/{topic}").status_code == 204
    assert client.get(f"/api/topics/{topic}/notebook").status_code == 404
    assert client.get(f"/api/topics/{topic}/latest-turn").status_code == 404
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM turns").fetchone()[0] == 0


def test_response_limit_preserves_partial_reply_and_reports_incomplete(setup_app):
    client, provider, path, _ = setup_app
    provider.limited = True
    topic = new_topic(client)
    result = events(client.post(f"/api/topics/{topic}/messages", json={"content": "A long reply"}))
    assert "".join(event["text"] for event in result if event["type"] == "delta") == "A useful answer."
    assert result[-1]["status"] == "failed"
    assert "limit before finishing" in next(event["message"] for event in result if event["type"] == "error")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT assistant_text,status FROM turns").fetchone() == ("A useful answer.", "failed")
    provider.limited = False
    events(client.post(f"/api/topics/{topic}/messages", json={"content": "Try again"}))
    assert len(provider.calls[-1]) == 2


def test_keys_never_enter_settings_responses_or_sqlite(setup_app):
    client, _, path, credentials = setup_app
    value = {"mode": "cloud", "provider": "openai", "endpoint": "", "model": "test-model", "api_key": "secret-test-key", "remember_key": True}
    response = client.put("/api/settings", json=value)
    assert response.status_code == 200
    assert response.json()["key_source"] == "session"
    assert "secret-test-key" not in response.text
    assert "secret-test-key" not in client.get("/api/settings").text
    with sqlite3.connect(path) as db:
        assert "secret-test-key" not in "".join(db.iterdump())
    assert credentials.get(ModelSettings(mode="cloud", endpoint="", model="other-model"))[0] == "secret-test-key"
    response = client.put("/api/settings", json={**value, "context_window": 5})
    assert response.status_code == 422
    assert "secret-test-key" not in response.text


def test_product_rename_keeps_existing_database_configuration(tmp_path, monkeypatch):
    path = tmp_path / "existing.sqlite3"
    store = Store(path)
    topic = store.create_topic("Existing topic")["id"]
    store.save_notebook(topic, "Notes from before the rename", 0)
    store.start_turn(topic, "old-turn", "An existing question")
    store.update_turn("old-turn", "An existing answer", "complete")
    credentials = memory_credentials(monkeypatch)
    monkeypatch.delenv("VERSO_DB", raising=False)
    monkeypatch.setenv("EPHEMERAL_DB", str(path))
    with TestClient(create_app(provider=FakeProvider(), credentials=credentials), base_url="http://localhost:8000") as client:
        assert client.get(f"/api/topics/{topic}/notebook").json()["markdown"] == "Notes from before the rename"
        assert client.get(f"/api/topics/{topic}/latest-turn").json()["assistant_text"] == "An existing answer"

    monkeypatch.setenv("VERSO_DB", str(path))
    monkeypatch.setenv("EPHEMERAL_DB", str(tmp_path / "unused.sqlite3"))
    with TestClient(create_app(provider=FakeProvider(), credentials=credentials), base_url="http://localhost:8000") as client:
        assert client.app.title == "Verso"
        assert client.get(f"/api/topics/{topic}/notebook").json()["markdown"] == "Notes from before the rename"
    assert not (tmp_path / "unused.sqlite3").exists()


def test_origin_configuration_accepts_legacy_names_and_prefers_verso(tmp_path, monkeypatch):
    monkeypatch.delenv("VERSO_ORIGINS", raising=False)
    monkeypatch.setenv("EPHEMERAL_ORIGINS", "https://old.example")
    credentials = memory_credentials(monkeypatch)
    path = tmp_path / "app.sqlite3"
    with TestClient(create_app(path, FakeProvider(), credentials), base_url="http://localhost:8000") as client:
        assert client.get("/api/topics", headers={"Origin": "https://old.example"}).status_code == 200
    monkeypatch.setenv("VERSO_ORIGINS", "https://verso.example")
    with TestClient(create_app(path, FakeProvider(), credentials), base_url="http://localhost:8000") as client:
        assert client.get("/api/topics", headers={"Origin": "https://verso.example"}).status_code == 200
        assert client.get("/api/topics", headers={"Origin": "https://old.example"}).status_code == 403


def test_environment_keys_accept_legacy_names_and_prefer_verso(monkeypatch):
    credentials = memory_credentials(monkeypatch)
    cloud = ModelSettings(mode="cloud", endpoint="", model="test-model")
    monkeypatch.setenv("EPHEMERAL_API_KEY", "old-test-key")
    assert credentials.get(cloud) == ("old-test-key", "environment")
    monkeypatch.setenv("VERSO_API_KEY", "new-test-key")
    assert credentials.get(cloud) == ("new-test-key", "environment")
    assert credentials.get(ModelSettings()) == (None, "none")


def test_saved_keys_survive_rename_and_do_not_return_after_removal(monkeypatch):
    class MemoryKeyring:
        def __init__(self):
            self.values = {}

        def get_password(self, service, username):
            return self.values.get((service, username))

        def set_password(self, service, username, password):
            self.values[service, username] = password

        def delete_password(self, service, username):
            del self.values[service, username]

    credentials = memory_credentials(monkeypatch)
    keyring = credentials.backend = MemoryKeyring()
    settings = ModelSettings(mode="cloud", endpoint="", model="test-model")
    scope = credentials.scope(settings)
    keyring.set_password("ephemeral-tutor", scope, "old-test-key")
    assert credentials.get(settings) == ("old-test-key", "keyring")
    assert credentials.set(settings, "new-test-key", remember=True) == "keyring"
    assert keyring.get_password("verso", scope) == "new-test-key"
    restarted = memory_credentials(monkeypatch)
    restarted.backend = keyring
    assert restarted.get(settings) == ("new-test-key", "keyring")
    restarted.clear(settings)
    assert restarted.get(settings) == (None, "none")
    assert not keyring.values

    keyring.set_password("ephemeral-tutor", scope, "old-test-key")
    restarted.set(settings, "session-test-key", remember=False)
    assert restarted.get(settings) == ("session-test-key", "session")
    assert not keyring.values


def test_cloud_requires_key_and_local_mode_rejects_public_endpoint(setup_app):
    client, *_ = setup_app
    assert client.put("/api/settings", json={"endpoint": "https://example.com/v1"}).status_code == 422
    assert client.put("/api/settings", json={"mode": "cloud", "endpoint": "", "model": "test-model"}).status_code == 200
    topic = new_topic(client)
    assert client.post(f"/api/topics/{topic}/messages", json={"content": "Hello"}).status_code == 400


def test_cross_origin_requests_and_unknown_hosts_are_rejected(setup_app):
    client, *_ = setup_app
    assert client.post("/api/topics", json={"title": "Bad origin"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/topics", headers={"Host": "evil.example"}).status_code == 400
    response = client.get("/api/topics")
    assert response.headers["cache-control"] == "no-store"


def test_recent_context_is_bounded_and_current_message_is_preserved():
    settings = ModelSettings(context_window=1024, max_output_tokens=64)
    history = [{"user_text": f"question-{i}" + "x" * 100, "assistant_text": "y" * 100} for i in range(10)]
    messages, omitted = build_context(history, "current", settings)
    assert 0 < omitted < len(history)
    assert messages[-1] == {"role": "user", "content": "current"}
    assert messages[-3]["content"].startswith("question-9")
    assert len(messages) % 2 == 0
    with pytest.raises(ValueError, match="input budget"):
        build_context(history, "x" * 2000, settings)


@pytest.mark.asyncio
async def test_cancellation_retains_partial_and_does_not_block_notes(tmp_path, monkeypatch):
    store = Store(tmp_path / "app.sqlite3")
    topic = store.create_topic("Slow inference")["id"]
    provider = FakeProvider(slow=True)
    conversations = Conversations(store, provider, memory_credentials(monkeypatch))
    generation = await conversations.start(topic, "Hello")
    await provider.produced.wait()
    assert store.save_notebook(topic, "Writing while the model thinks", 0) == 1
    with pytest.raises(HTTPException) as caught:
        await conversations.start(topic, "Duplicate")
    assert caught.value.status_code == 409
    await asyncio.gather(conversations.cancel(generation), conversations.cancel(generation))
    assert provider.closed
    assert not conversations.active
    assert store.history(topic) == []
    with store.connect() as db:
        assert tuple(db.execute("SELECT assistant_text,status FROM turns").fetchone()) == ("A useful ", "cancelled")


@pytest.mark.asyncio
async def test_immediate_cancellation_finalizes_turn(tmp_path, monkeypatch):
    store = Store(tmp_path / "app.sqlite3")
    topic = store.create_topic("Cancel immediately")["id"]
    conversations = Conversations(store, FakeProvider(slow=True), memory_credentials(monkeypatch))
    generation = await conversations.start(topic, "Hello")
    await conversations.cancel(generation)
    with store.connect() as db:
        assert db.execute("SELECT status FROM turns").fetchone()[0] == "cancelled"
    assert not conversations.active


def test_restart_marks_unfinished_turns_interrupted(tmp_path):
    path = tmp_path / "app.sqlite3"
    store = Store(path)
    topic = store.create_topic("Interrupted")["id"]
    store.start_turn(topic, "generation", "Hello")
    store.update_turn("generation", "Partial reply")
    restarted = Store(path)
    assert restarted.history(topic) == []
    with restarted.connect() as db:
        assert tuple(db.execute("SELECT assistant_text,status FROM turns").fetchone()) == ("Partial reply", "interrupted")


def test_late_checkpoint_cannot_overwrite_finalized_generation(tmp_path):
    store = Store(tmp_path / "app.sqlite3")
    topic = store.create_topic("Cancellation race")["id"]
    store.start_turn(topic, "generation", "Hello")
    store.update_turn("generation", "Final partial text", "cancelled")
    store.update_turn("generation", "Older checkpoint")
    with store.connect() as db:
        assert tuple(db.execute("SELECT assistant_text,status FROM turns").fetchone()) == ("Final partial text", "cancelled")
