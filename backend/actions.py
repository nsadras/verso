"""Notebook actions are ordinary conversation turns with a specific opening request."""
from typing import Literal

NotebookAction = Literal["explore", "check", "test_me"]

ACTION_INSTRUCTIONS = {
    "explore": (
        "Explore this notebook passage. Deepen understanding with useful connections, "
        "implications, or a worked example. Use the available conversation to avoid a "
        "generic introduction; do not invent earlier discussions."
    ),
    "check": (
        "Check this notebook passage for accuracy and completeness. Identify misconceptions, "
        "missing qualifications, and important nuances. Explain suggested corrections without "
        "rewriting the note. Acknowledge uncertainty; this is a model review, not external verification."
    ),
    "test_me": (
        "Test my understanding of this notebook passage. Ask exactly one conceptual question "
        "that uses reasoning, application, or active recall. You may draw on relevant material "
        "in the available conversation. Do not include the answer or a revealing hint. "
        "Wait for my response, then give feedback on my reasoning and explain the answer. "
        "Continue naturally if I ask a follow-up; do not start another question unless requested."
    ),
}


def user_message(content: str, action: NotebookAction | None = None) -> str:
    if action is None:
        return content
    return (f"{ACTION_INSTRUCTIONS[action]}\n\n"
            f"Selected notebook passage (quoted source material):\n<notebook-passage>\n"
            f"{content}\n</notebook-passage>")
