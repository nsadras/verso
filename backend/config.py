import os


def env(name: str, default=None):
    """Prefer Verso configuration while accepting settings from the previous name."""
    return os.getenv(f"VERSO_{name}", os.getenv(f"EPHEMERAL_{name}", default))
