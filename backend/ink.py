"""Bounded ink documents and self-contained PNG attachments."""
import base64
import binascii
import io
import secrets
from typing import Annotated, Literal
from uuid import UUID

from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field, model_validator

Coordinate = Annotated[float, Field(ge=-1_000_000, le=1_000_000, allow_inf_nan=False)]
Pressure = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Stroke(BaseModel):
    id: UUID
    points: list[tuple[Coordinate, Coordinate, Pressure]] = Field(min_length=1, max_length=10_000)
    size: float = Field(default=4, ge=1, le=20, allow_inf_nan=False)


class InkPageInput(BaseModel):
    revision: int = Field(ge=0)
    mutation_id: UUID
    width: Literal[1000] = 1000
    height: Literal[1414] = 1414
    # Existing pages retain their original validation and retry representation.
    # Canvas sections use world coordinates; width/height describe storage cells.
    space: Literal["page", "canvas"] = "page"
    strokes: list[Stroke] = Field(max_length=5000)

    @model_validator(mode="after")
    def bounded_page(self):
        if sum(len(stroke.points) for stroke in self.strokes) > 200_000:
            raise ValueError("This ink section is full.")
        if self.space == "page" and any(
            not (0 <= x <= 1000 and 0 <= y <= 1414)
            for stroke in self.strokes for x, y, _ in stroke.points
        ):
            raise ValueError("Stroke extends beyond the page.")
        if len({stroke.id for stroke in self.strokes}) != len(self.strokes):
            raise ValueError("Duplicate stroke identifiers.")
        return self


def encode_png(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def normalize_image(value):
    if not value.startswith("data:image/png;base64,") or len(value) > 4_000_000:
        raise ValueError("Share a PNG snapshot smaller than 3 MB.")
    try:
        raw = base64.b64decode(value.split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG" or not (1 <= image.width <= 1536 and 1 <= image.height <= 1536):
                raise ValueError("Snapshot dimensions must be at most 1536 pixels.")
            image.load()
            background = Image.new("RGB", image.size, "white")
            rgba = image.convert("RGBA")
            background.paste(rgba, mask=rgba.getchannel("A"))
            normalized = encode_png(background)
            if len(normalized) > 4_000_000:
                raise ValueError("The normalized snapshot is too large. Share a smaller area.")
            return normalized
    except (OSError, binascii.Error, Image.DecompressionBombError) as exc:
        raise ValueError("The snapshot is not a valid PNG image.") from exc


def image_budget(value):
    # Model-independent allowance; actual image tokenization varies by provider.
    with Image.open(io.BytesIO(base64.b64decode(value.split(",", 1)[1]))) as image:
        return 1024 + ((image.width + 511) // 512) * ((image.height + 511) // 512) * 512


def vision_challenge(code=None):
    code = code or secrets.token_hex(4).upper()
    image = Image.new("RGB", (600, 240), "white")
    draw = ImageDraw.Draw(image)
    draw.text((30, 30), code, font=ImageFont.load_default(size=58), fill="black")
    draw.text((30, 125), "v + v = 2v", font=ImageFont.load_default(size=32), fill="black")
    draw.line([(360, 195), (520, 130), (505, 155)], fill="black", width=4)
    return code, encode_png(image)
