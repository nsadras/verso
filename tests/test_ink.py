import base64
import io
import sqlite3
from uuid import uuid4

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.ink import encode_png, image_budget, normalize_image
from backend.models import ModelSettings
from backend.provider import build_context, message_cost
from tests.test_app import setup_app, new_topic, events, FakeProvider


def page(strokes=True, revision=0):
    return {"width": 1000, "height": 1414, "revision": revision, "mutation_id": str(uuid4()),
            "strokes": [{"id": str(uuid4()), "size": 4, "points": [[20, 30, .4], [60, 80, .8]]}] if strokes else []}


def png():
    return encode_png(Image.new("RGB", (1000, 1414), "white"))


def test_ink_is_revision_checked_retryable_isolated_and_survives_restart(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    other = new_topic(client)
    page_id = str(uuid4())
    url = f"/api/topics/{topic}/ink-pages/{page_id}"
    value = page()
    assert client.put(url, json=value).json() == {"revision": 1}
    # A lost acknowledgement can be retried exactly, even with the old base revision.
    assert client.put(url, json=value).json() == {"revision": 1}
    assert client.put(url, json=page()).status_code == 409
    assert client.get(f"/api/topics/{other}/ink-pages").json() == []
    assert client.get(f"/api/topics/{topic}/notebook").json() == {"markdown": "", "revision": 0}
    with TestClient(create_app(path, provider, credentials), base_url="http://localhost:8000") as restarted:
        saved = restarted.get(f"/api/topics/{topic}/ink-pages").json()[0]
        assert saved == {**value, "revision": 1, "id": page_id}
        assert restarted.put(url, json=page(strokes=False, revision=1)).json() == {"revision": 2}
        assert restarted.delete(f"/api/topics/{topic}").status_code == 204
        assert restarted.put(url, json=value).status_code == 404
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM ink_pages").fetchone()[0] == 0


@pytest.mark.parametrize("change", [
    {"width": 1200}, {"revision": -1}, {"mutation_id": "bad"},
    {"strokes": [{"id": str(uuid4()), "size": 4, "points": [[1001, 0, .5]]}]},
    {"strokes": [{"id": str(uuid4()), "size": 4, "points": [[0, 0, 2]]}]},
])
def test_invalid_ink_never_changes_saved_page(setup_app, change):
    client, *_ = setup_app
    topic = new_topic(client)
    assert client.put(f"/api/topics/{topic}/ink-pages/{uuid4()}", json={**page(), **change}).status_code == 422
    assert client.get(f"/api/topics/{topic}/ink-pages").json() == []


def test_images_require_verified_model_persist_and_provide_followup_context(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    image = png()
    value = {"content": "Handwritten page 1", "action": "check", "image": image}
    url = f"/api/topics/{topic}/messages"
    assert client.post(url, json=value).status_code == 400
    assert not provider.calls
    client.app.state.store.set_vision_verified(ModelSettings())
    assert events(client.post(url, json=value))[-1]["status"] == "complete"
    shared = provider.calls[-1][-1]
    assert shared["content"][1]["image_url"]["url"] == image
    assert "accuracy and completeness" in shared["content"][0]["text"]
    with TestClient(create_app(path, provider, credentials), base_url="http://localhost:8000") as restarted:
        assert restarted.get(f"/api/topics/{topic}/latest-turn").json()["image"] == image
        assert restarted.get('/api/settings').json()['vision_verified']
        events(restarted.post(url, json={"content": "Explain the diagram again"}))
        assert shared in provider.calls[-1]
        restarted.put('/api/settings', json={"model": "another-model"})
        assert not restarted.get('/api/settings').json()['vision_verified']
        assert restarted.post(url, json=value).status_code == 400
        # Ordinary chat stays usable; images are never silently dropped from a retained turn.
        events(restarted.post(url, json={"content": "A text question"}))
        assert all(isinstance(message['content'], str) for message in provider.calls[-1])
        restarted.delete(f"/api/topics/{topic}")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM turns WHERE image IS NOT NULL").fetchone()[0] == 0


@pytest.mark.parametrize("image", ["https://example.com/note.png", "data:image/png;base64,not-png", "data:image/svg+xml;base64,AAAA"])
def test_attachments_are_validated_without_remote_fetching(setup_app, image):
    client, provider, *_ = setup_app
    topic = new_topic(client)
    assert client.post(f"/api/topics/{topic}/messages", json={"content": "Look", "image": image}).status_code == 422
    assert provider.calls == []


def test_png_normalization_bounds_and_flattens_images():
    with pytest.raises(ValueError, match="1536"):
        normalize_image(encode_png(Image.new('RGB', (1537, 1))))
    transparent = normalize_image(encode_png(Image.new('RGBA', (10, 10), (0, 0, 0, 0))))
    with Image.open(io.BytesIO(base64.b64decode(transparent.split(',')[1]))) as image:
        assert image.getpixel((0, 0)) == (255, 255, 255)


def test_image_context_has_a_separate_budget_and_attachment_limit():
    image = png()
    assert 1000 < image_budget(image) < 8192
    history = [{"user_text": "Page", "assistant_text": "Explanation", "image": image} for _ in range(8)]
    settings = ModelSettings(context_window=100_000)
    messages, omitted = build_context(history, 'Current page', settings, image=image)
    assert omitted == 6
    assert sum(isinstance(message['content'], list) for message in messages) == 3
    messages, omitted = build_context(history, 'Current page', ModelSettings(), image=image)
    assert sum(message_cost(message) for message in messages) <= 8192 - 2048 - 128
    assert omitted > 0
    with pytest.raises(ValueError, match='input budget'):
        build_context([], 'Page', ModelSettings(context_window=1024), image=image)


def test_image_check_requires_reading_pixels_and_invalidates_changed_connection(setup_app, monkeypatch):
    client, provider, *_ = setup_app
    monkeypatch.setattr('backend.app.vision_challenge', lambda: ('ABCDEF12', png()))
    assert client.post('/api/settings/test-vision').status_code == 502
    assert not client.get('/api/settings').json()['vision_verified']
    assert 'ABCDEF12' not in provider.calls[-1][0]['content'][0]['text']

    async def stream(settings, messages, api_key):
        yield 'ABCDEF12'
    monkeypatch.setattr(provider, 'stream', stream)
    assert client.post('/api/settings/test-vision').json()['vision_verified']
    client.put('/api/settings', json={"model": "new-model"})
    assert not client.get('/api/settings').json()['vision_verified']


def test_v2_migration_preserves_text_and_adds_empty_ink(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    client.put(f'/api/topics/{topic}/notebook', json={"markdown": "Existing notes", "revision": 0})
    events(client.post(f'/api/topics/{topic}/messages', json={"content": "Existing question"}))
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE turns DROP COLUMN image')
        db.execute('DROP TABLE ink_pages')
        db.execute('DROP TABLE vision_verification')
        db.execute('PRAGMA user_version=2')
    with TestClient(create_app(path, provider, credentials), base_url='http://localhost:8000') as restarted:
        assert restarted.get(f'/api/topics/{topic}/notebook').json()['markdown'] == 'Existing notes'
        assert restarted.get(f'/api/topics/{topic}/latest-turn').json()['user_text'] == 'Existing question'
        assert restarted.get(f'/api/topics/{topic}/ink-pages').json() == []
