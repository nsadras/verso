"""Deterministic model used only by browser tests; production always uses LiteLLM."""
import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.app import create_app
from backend.actions import ACTION_INSTRUCTIONS
from backend.credentials import Credentials


class BrowserProvider:
    async def stream(self, settings, messages, api_key):
        current = messages[-1]["content"]
        action = next((name for name, instruction in ACTION_INSTRUCTIONS.items() if current.startswith(instruction)), None)
        if action:
            current = current.split("<notebook-passage>\n", 1)[1].rsplit("\n</notebook-passage>", 1)[0]
        if current == "fail":
            raise RuntimeError("A simulated provider failure")
        if current in {"math-response", "table-response"}:
            answer = Path(__file__).with_name("fixtures").joinpath(f"{current.removesuffix('-response')}.md").read_text()
            for offset in range(0, len(answer), 24):
                yield answer[offset:offset + 24]
                await asyncio.sleep(0.03)
            return
        if current == "long-response":
            for paragraph in range(1, 31):
                yield f"Paragraph {paragraph}. A longer reply can unfold across several screens while leaving every part available to read.\n\n"
                await asyncio.sleep(0.1)
            yield "End of the long reply."
            return
        answer = "A response to: " + current
        if action:
            answer = {
                "explore": "Consider how this idea connects to linearity.",
                "check": "This is accurate, with one qualification: the map must be linear.",
                "test_me": "How would doubling the input change the output, and why?",
            }[action]
        if current == "my reasoning" and any(ACTION_INSTRUCTIONS["test_me"] in message["content"] for message in messages[:-1]):
            answer = "Your reasoning uses linearity: doubling the input doubles the output."
        if current == "recall":
            answer = "I remember: " + messages[1]["content"]
        for word in answer.split(" "):
            yield word + " "
            await asyncio.sleep(3 if current == "slow" else 0.35 if current == "focus-check" else 0.01)


data = TemporaryDirectory(prefix="verso-browser-tests-")
os.environ["VERSO_ORIGINS"] = "http://127.0.0.1:8011"
credentials = Credentials()
credentials.backend = None
app = create_app(Path(data.name) / "test.sqlite3", BrowserProvider(), credentials)
