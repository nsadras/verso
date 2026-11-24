import asyncio
import sqlite3
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.conversation import Conversations
from backend.models import ModelSettings
from backend.storage import Store
from backend.transcription import TRANSCRIPTION_PROMPT, clean_transcription
from tests.test_app import setup_app, new_topic, events, FakeProvider, memory_credentials
from tests.test_ink import png, page


def test_transcription_is_image_only_and_never_changes_notes_or_conversation(setup_app):
    client, provider, *_ = setup_app
    topic = new_topic(client)
    url = f'/api/topics/{topic}'
    events(client.post(f'{url}/messages', json={'content': 'Unrelated private conversation'}))
    previous = client.get(f'{url}/latest-turn').json()
    client.put(f'{url}/notebook', json={'markdown': 'Private text notes', 'revision': 0})
    image = png()
    assert client.post(f'{url}/transcribe', json={'image': image}).status_code == 400
    client.app.state.store.set_vision_verified(ModelSettings())
    result = events(client.post(f'{url}/transcribe', json={'image': image}))
    assert result[-2:] == [{'type': 'transcription', 'markdown': 'A useful answer.'}, {'type': 'done', 'status': 'complete'}]
    assert provider.calls[-1] == [
        {'role': 'system', 'content': TRANSCRIPTION_PROMPT},
        {'role': 'user', 'content': [{'type': 'text', 'text': 'Transcribe this handwritten section.'},
                                   {'type': 'image_url', 'image_url': {'url': image}}]},
    ]
    assert client.get(f'{url}/latest-turn').json() == previous
    assert client.get(f'{url}/notebook').json() == {'markdown': 'Private text notes', 'revision': 1}
    assert len(client.app.state.store.history(topic)) == 1
    assert provider.closed


@pytest.mark.parametrize('failure', ['fail', 'limited'])
def test_failed_and_truncated_transcriptions_do_not_return_partial_output(setup_app, failure):
    client, provider, *_ = setup_app
    client.app.state.store.set_vision_verified(ModelSettings())
    setattr(provider, failure, True)
    topic = new_topic(client)
    response = client.post(f'/api/topics/{topic}/transcribe', json={'image': png()})
    result = events(response)
    assert result[-1] == {'type': 'done', 'status': 'failed'}
    assert all(event['type'] not in {'transcription', 'delta'} for event in result)
    assert any(event['type'] == 'error' for event in result)
    assert 'sk-do-not-leak' not in response.text
    assert client.app.state.store.latest_turn(topic) is None
    assert not client.app.state.conversations.active
    assert provider.closed


@pytest.mark.parametrize('answer', ['', '   ', 'x' * 200_001])
def test_empty_or_oversized_transcription_is_not_appendable(setup_app, monkeypatch, answer):
    client, provider, *_ = setup_app
    client.app.state.store.set_vision_verified(ModelSettings())
    async def stream(*args):
        yield answer
    monkeypatch.setattr(provider, 'stream', stream)
    result = events(client.post(f'/api/topics/{new_topic(client)}/transcribe', json={'image': png()}))
    assert result[-1]['status'] == 'failed'
    assert not any(event['type'] == 'transcription' for event in result)


def test_transcription_validation_and_budget_rejections_release_generation(setup_app):
    client, provider, *_ = setup_app
    topic = new_topic(client)
    url = f'/api/topics/{topic}/transcribe'
    assert client.post(url, json={'image': 'https://example.com/note.png'}).status_code == 422
    assert client.post('/api/topics/missing/transcribe', json={'image': png()}).status_code == 404
    settings = ModelSettings(context_window=1024)
    client.app.state.store.save_settings(settings)
    client.app.state.store.set_vision_verified(settings)
    result = client.post(url, json={'image': png()})
    assert result.status_code == 400 and 'budget' in result.text
    assert not client.app.state.conversations.active
    assert not provider.calls


@pytest.mark.asyncio
@pytest.mark.parametrize('immediate', [False, True])
async def test_cancel_conversion_closes_provider_without_changing_history(tmp_path, monkeypatch, immediate):
    store = Store(tmp_path / 'app.sqlite3')
    store.set_vision_verified(ModelSettings())
    topic = store.create_topic('Ink')['id']
    provider = FakeProvider(slow=True)
    conversations = Conversations(store, provider, memory_credentials(monkeypatch))
    generation = await conversations.start_transcription(topic, png())
    if not immediate:
        await provider.produced.wait()
        assert store.save_notebook(topic, 'Writing during conversion', 0) == 1
        with pytest.raises(HTTPException) as caught:
            await conversations.start(topic, 'Concurrent chat')
        assert caught.value.status_code == 409
    await asyncio.gather(conversations.cancel(generation), conversations.cancel(generation))
    result = []
    while not generation.queue.empty():
        result.append(generation.queue.get_nowait())
    assert result[-1] == {'type': 'done', 'status': 'cancelled'}
    assert not any(event['type'] == 'transcription' for event in result)
    assert not conversations.active and provider.closed
    assert store.latest_turn(topic) is None


def test_transcription_fences_preserve_latex_and_internal_markdown():
    markdown = '# Euler\n\nWhy? $i^2=-1$.\n\n$$\ne^{i\\pi}+1=0\n$$\n\n```python\nx = 1\n```'
    assert clean_transcription(f'```markdown\n{markdown}\n```') == markdown
    assert clean_transcription(markdown) == markdown
    assert clean_transcription('```python\nx = 1\n```') == '```python\nx = 1\n```'


def test_append_preserves_latest_text_ink_and_receipts_across_restart(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    url = f'/api/topics/{topic}'
    original = '# Original notes\n\nTrailing whitespace stays.  \n'
    client.put(f'{url}/notebook', json={'markdown': original, 'revision': 0})
    ink = page()
    client.put(f'{url}/ink-pages/{uuid4()}', json=ink)
    pages = client.get(f'{url}/ink-pages').json()
    conversion = {'id': str(uuid4()), 'markdown': '$$\ne^{i\\pi}+1=0\n$$', 'scope': 'selection'}
    # Another device finishes an edit while inference runs; append uses this latest text.
    original += '\nA later edit.'
    client.put(f'{url}/notebook', json={'markdown': original, 'revision': 1})
    result = client.post(f'{url}/notebook/append-conversion', json=conversion).json()
    assert result['markdown'].startswith(original + '\n\n---\n\n')
    assert result['revision'] == 3 and result['appended']
    for part in [conversion['markdown'], '*Source: selection.*', f"<!-- verso:handwriting:{conversion['id']}:begin -->", f"<!-- verso:handwriting:{conversion['id']}:end -->"]:
        assert part in result['markdown']
    assert client.get(f'{url}/ink-pages').json() == pages
    with TestClient(create_app(path, provider, credentials), base_url='http://localhost:8000') as restarted:
        retry = restarted.post(f'{url}/notebook/append-conversion', json=conversion).json()
        assert retry == {**result, 'appended': False}
        # Editing/removing the generated markers must not defeat duplicate detection.
        restarted.put(f'{url}/notebook', json={'markdown': 'Edited after conversion', 'revision': 3})
        retry = restarted.post(f'{url}/notebook/append-conversion', json=conversion).json()
        assert retry['markdown'] == 'Edited after conversion' and retry['revision'] == 4
        assert not retry['appended']
        assert restarted.post(f'{url}/notebook/append-conversion', json={**conversion, 'markdown': 'Different'}).status_code == 409
        restarted.delete(url)
        assert restarted.post(f'{url}/notebook/append-conversion', json=conversion).status_code == 404
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT count(*) FROM notebook_appends').fetchone()[0] == 0


def test_invalid_and_full_notebooks_do_not_partially_append(setup_app):
    client, *_ = setup_app
    topic = new_topic(client)
    url = f'/api/topics/{topic}/notebook'
    value = {'id': str(uuid4()), 'markdown': 'Converted notes', 'scope': 'notebook'}
    for invalid in [{'markdown': ' '}, {'markdown': 'x' * 500_001}, {'id': 'bad'}, {'scope': 'view'}]:
        assert client.post(f'{url}/append-conversion', json={**value, **invalid}).status_code == 422
    original = 'x' * 2_000_000
    client.put(url, json={'markdown': original, 'revision': 0})
    assert client.post(f'{url}/append-conversion', json=value).status_code == 400
    assert client.get(url).json() == {'markdown': original, 'revision': 1}
    client.put(url, json={'markdown': 'Space made available', 'revision': 1})
    assert client.post(f'{url}/append-conversion', json=value).json()['appended']


def test_v3_migration_preserves_existing_notebook_ink_and_vision(setup_app):
    client, provider, path, credentials = setup_app
    topic = new_topic(client)
    client.app.state.store.set_vision_verified(ModelSettings())
    client.put(f'/api/topics/{topic}/notebook', json={'markdown': 'Old notes', 'revision': 0})
    client.put(f'/api/topics/{topic}/ink-pages/{uuid4()}', json=page())
    ink = client.get(f'/api/topics/{topic}/ink-pages').json()
    events(client.post(f'/api/topics/{topic}/messages', json={'content': 'Handwriting', 'image': png()}))
    latest = client.get(f'/api/topics/{topic}/latest-turn').json()
    with sqlite3.connect(path) as db:
        db.execute('DROP TABLE notebook_appends')
        db.execute('PRAGMA user_version=3')
    with TestClient(create_app(path, provider, credentials), base_url='http://localhost:8000') as restarted:
        assert restarted.get(f'/api/topics/{topic}/notebook').json()['markdown'] == 'Old notes'
        assert restarted.get(f'/api/topics/{topic}/ink-pages').json() == ink
        assert restarted.get(f'/api/topics/{topic}/latest-turn').json() == latest
        assert restarted.get('/api/settings').json()['vision_verified']
        assert restarted.post(f'/api/topics/{topic}/notebook/append-conversion', json={
            'id': str(uuid4()), 'scope': 'notebook', 'markdown': 'New conversion',
        }).status_code == 200
