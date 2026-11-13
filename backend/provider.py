import logging
import os
from contextlib import suppress

# Use bundled model metadata; importing LiteLLM must not fetch external pricing data.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
os.environ.setdefault("LITELLM_LOG", "ERROR")
os.environ.setdefault("TIKTOKEN_CACHE_DIR", "/tmp/verso-tokenizers")

import litellm  # noqa: E402

litellm.suppress_debug_info = True
litellm.telemetry = False
litellm.set_verbose = False
for name in ("LiteLLM", "LiteLLM Router", "LiteLLM Proxy", "httpx", "httpcore"):
    logging.getLogger(name).setLevel(logging.CRITICAL)

SYSTEM_PROMPT = (
    "You are a thoughtful conversation partner helping someone learn and reflect. "
    "Prefer clear, reasonably concise answers; give depth when requested. "
    "Earlier exchanges are hidden in the interface but may be provided as context. "
    "You cannot see or edit the user's notebook. Do not pretend to remember omitted context."
)


class ResponseLimitReached(Exception):
    """The provider stopped at a limit instead of finishing the reply."""


def message_cost(message):
    # Conservative byte budget works offline with unknown local model tokenizers.
    # It deliberately sacrifices some context rather than downloading a tokenizer.
    return len(message["content"].encode("utf-8")) + 16


def build_context(history, content, settings):
    system = {"role": "system", "content": SYSTEM_PROMPT}
    current = {"role": "user", "content": content}
    # Leave room for a reply when choosing history, without capping generation.
    reserve = settings.max_output_tokens or min(4096, settings.context_window // 4)
    budget = settings.context_window - reserve - 128
    used = message_cost(system) + message_cost(current)
    if used > budget:
        raise ValueError("This message exceeds the input budget. Shorten it or increase the configured context window.")
    selected = []
    for turn in reversed(history):
        pair = [{"role": "user", "content": turn["user_text"]},
                {"role": "assistant", "content": turn["assistant_text"]}]
        cost = sum(message_cost(message) for message in pair)
        if used + cost > budget:
            break
        selected[0:0] = pair
        used += cost
    return [system, *selected, current], len(history) - len(selected) // 2


def public_error(exc):
    if isinstance(exc, ResponseLimitReached):
        return ("The model reached its response or context limit before finishing. "
                "Increase the limit in Model settings or your model server, then try again.")
    if isinstance(exc, litellm.AuthenticationError):
        return "The provider rejected the API key. Check model settings."
    if isinstance(exc, litellm.ContextWindowExceededError):
        return "The model rejected the context size. Lower the configured context window or shorten your message."
    if isinstance(exc, litellm.RateLimitError):
        return "The provider is rate limiting requests. Try again shortly."
    if isinstance(exc, (TimeoutError, litellm.Timeout)):
        return "The model timed out. Your notebook is safe; try again or check the model service."
    return "Could not complete the response. Check the endpoint, model name, and whether the model service is running."


class LiteLLMProvider:
    async def stream(self, settings, messages, api_key):
        stream = None
        try:
            stream = await litellm.acompletion(
                model=f"{settings.provider}/{settings.model}",
                messages=messages,
                api_base=settings.endpoint or None,
                api_key=api_key or ("local" if settings.mode == "local" else ""),
                max_tokens=settings.max_output_tokens,
                stream=True,
                timeout=120,
                num_retries=0,
            )
            async for chunk in stream:
                if chunk.choices:
                    content = chunk.choices[0].delta.content
                    if content:
                        yield content
                    if chunk.choices[0].finish_reason == "length":
                        raise ResponseLimitReached()
        finally:
            if stream is not None:
                with suppress(Exception):
                    await stream.aclose()
