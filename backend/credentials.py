import hashlib

from .config import env
from .models import ModelSettings

KEYRING_SERVICES = ("verso", "ephemeral-tutor")  # Read and clear keys saved before the rename too.


class Credentials:
    """Only OS credential stores are trusted; headless hosts use memory or environment."""

    def __init__(self):
        self.session: dict[str, str] = {}
        self.backend = None
        try:
            import keyring

            backend = keyring.get_keyring()
            if type(backend).__module__.startswith((
                "keyring.backends.SecretService", "keyring.backends.macOS",
                "keyring.backends.Windows", "keyring.backends.kwallet", "keyring.backends.libsecret",
            )) and backend.priority > 0:
                self.backend = backend
        except Exception:
            pass

    def scope(self, settings: ModelSettings):
        return hashlib.sha256(
            f"{settings.mode}|{settings.provider}|{settings.endpoint}".encode()
        ).hexdigest()

    def get(self, settings):
        scope = self.scope(settings)
        if scope in self.session:
            return self.session[scope], "session"
        if self.backend:
            for service in KEYRING_SERVICES:
                try:
                    value = self.backend.get_password(service, scope)
                    if value:
                        return value, "keyring"
                except Exception:
                    pass
        if settings.mode == "cloud" and (value := env("API_KEY")):
            return value, "environment"
        return None, "none"

    def set(self, settings, value, remember):
        scope = self.scope(settings)
        if remember and self.backend:
            try:
                self.backend.set_password(KEYRING_SERVICES[0], scope, value)
                self.session.pop(scope, None)
                return "keyring"
            except Exception:
                pass
        # Replacing a remembered key with a session key must not resurrect the
        # old remembered credential after a restart.
        self.clear(settings)
        self.session[scope] = value
        return "session"

    def clear(self, settings):
        scope = self.scope(settings)
        if self.backend:
            try:
                for service in KEYRING_SERVICES:
                    if self.backend.get_password(service, scope):
                        self.backend.delete_password(service, scope)
            except Exception as exc:
                raise RuntimeError("Could not remove the saved key from the OS credential store.") from exc
        self.session.pop(scope, None)
