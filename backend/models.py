import ipaddress
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

from .actions import NotebookAction
from .ink import normalize_image


class TopicInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def clean_title(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Give the topic a name.")
        return self


class NotebookInput(BaseModel):
    markdown: str = Field(max_length=2_000_000)
    revision: int = Field(ge=0)


class MessageInput(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)
    action: NotebookAction | None = None
    image: str | None = Field(default=None, max_length=4_000_000)

    @field_validator("image")
    @classmethod
    def validate_image(cls, value):
        return normalize_image(value) if value is not None else None


class ModelSettings(BaseModel):
    mode: Literal["local", "cloud"] = "local"
    provider: Literal["openai", "anthropic", "gemini"] = "openai"
    endpoint: str = "http://127.0.0.1:11434/v1"
    model: str = Field(default="gemma4:12b", min_length=1, max_length=200)
    context_window: int = Field(default=8192, ge=1024, le=2_000_000)
    max_output_tokens: int | None = Field(default=None, ge=64, le=64_000)

    @model_validator(mode="after")
    def validate_settings(self):
        self.model = self.model.strip()
        if not self.model:
            raise ValueError("Enter a model name.")
        self.endpoint = self.endpoint.strip().rstrip("/")
        if self.max_output_tokens is not None and self.max_output_tokens + 256 >= self.context_window:
            raise ValueError("Context window must leave room for input and output.")
        if self.mode == "local" and self.provider != "openai":
            raise ValueError("Local models use an OpenAI-compatible endpoint.")
        if self.endpoint:
            url = urlparse(self.endpoint)
            if url.scheme not in {"http", "https"} or not url.hostname:
                raise ValueError("Endpoint must be an HTTP or HTTPS URL.")
            if url.username or url.password or url.query or url.fragment:
                raise ValueError("Endpoint cannot contain credentials, a query, or a fragment.")
            if self.mode == "local":
                host = url.hostname
                private = host == "localhost" or host.endswith((".ts.net", ".local"))
                try:
                    address = ipaddress.ip_address(host)
                    private = address.is_private or address.is_loopback
                except ValueError:
                    pass
                if not private:
                    raise ValueError("Use a local/private address, or select a hosted provider.")
            elif url.scheme != "https":
                raise ValueError("Hosted endpoints must use HTTPS.")
        elif self.mode == "local":
            raise ValueError("A local endpoint is required.")
        return self


class SettingsInput(ModelSettings):
    api_key: str | None = Field(default=None, max_length=4096, repr=False)
    remember_key: bool = False
    clear_key: bool = False
