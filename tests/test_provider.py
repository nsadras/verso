from types import SimpleNamespace

import pytest

from backend.models import ModelSettings
from backend.provider import LiteLLMProvider, ResponseLimitReached, build_context


@pytest.mark.parametrize("limit", [None, 2048])
async def test_response_limit_is_optional_and_explicit_limits_are_honored(monkeypatch, limit):
    requested = {}
    answer = "A long response can keep going. " * 1000

    async def chunks():
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=answer), finish_reason="stop")])

    async def completion(**kwargs):
        requested.update(kwargs)
        return chunks()

    monkeypatch.setattr("backend.provider.litellm.acompletion", completion)
    settings = ModelSettings() if limit is None else ModelSettings(max_output_tokens=limit)
    messages, _ = build_context([], "Explain in detail.", settings)
    result = "".join([text async for text in LiteLLMProvider().stream(settings, messages, None)])
    assert result == answer
    assert requested["max_tokens"] == limit


async def test_length_finish_keeps_final_text_and_closes_stream(monkeypatch):
    closed = False

    async def chunks():
        nonlocal closed
        try:
            yield SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content="The complete visible portion"), finish_reason=None)])
            yield SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content=" including the final chunk"), finish_reason="length")])
        finally:
            closed = True

    async def completion(**kwargs):
        return chunks()

    monkeypatch.setattr("backend.provider.litellm.acompletion", completion)
    parts = []
    with pytest.raises(ResponseLimitReached):
        async for text in LiteLLMProvider().stream(ModelSettings(), [], None):
            parts.append(text)
    assert "".join(parts) == "The complete visible portion including the final chunk"
    assert closed


@pytest.mark.parametrize("window", [1024, 8192])
def test_automatic_response_budget_leaves_room_for_input_and_bounds_history(window):
    settings = ModelSettings(context_window=window)
    history = [{"user_text": "question" * 100, "assistant_text": "answer" * 100} for _ in range(20)]
    messages, omitted = build_context(history, "A new question", settings)
    assert messages[-1]["content"] == "A new question"
    assert omitted > 0
    assert sum(len(message["content"].encode("utf-8")) + 16 for message in messages) < window


def test_action_instructions_count_toward_context_budget_and_history_is_not_reinterpreted():
    settings = ModelSettings(context_window=2048, max_output_tokens=64)
    history = [{"user_text": "An older passage " * 10, "assistant_text": "An explanation " * 10,
                "action": "explore"} for _ in range(10)]
    messages, omitted = build_context(history, "A selected note", settings, "test_me")
    assert 0 < omitted < len(history)
    assert "Explore this notebook passage" in messages[-3]["content"]
    assert "Test my understanding" in messages[-1]["content"]
    assert sum(len(message["content"].encode("utf-8")) + 16 for message in messages) <= 2048 - 64 - 128
    with pytest.raises(ValueError, match="input budget"):
        build_context([], "x" * 1100, settings, "test_me")
