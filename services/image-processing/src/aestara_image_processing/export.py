"""Purpose-specific export renders (Bible §8.3; ADR-0026 K3-14, K3-15).

An export is a new derivative of the original, never a change to it: upright,
sRGB, every metadata block removed, at most 4096 px on its long edge, and with
no text, dates, names or logos of its own. Two layouts:

- SINGLE: one photo, optionally with one annotation layer drawn in. The
  worker resolves the layer's colours (design tokens) and sizes beforehand.
- SIDE_BY_SIDE: a before/after pair at equal height, the after photo placed by
  the set's registration transform (packages/api-contracts,
  RegistrationTransform) inside a frame the size of the before photo.

Decoding is libvips only, with the same hardening as derivatives; OpenCV
draws shapes and moves pixels on arrays. This module runs inside the sandbox
child (sandbox.py).
"""

import html
import math
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final

import cv2
import numpy as np
import numpy.typing as npt
import pyvips

from .config import MAX_PIXELS
from .contract import Rendered
from .errors import JobFailure
from .imaging import JPEG_QUALITY, check_signature, check_stripped, load_image, to_srgb

MAX_EXPORT_EDGE: Final = 4096
# Inter (SIL Open Font License 1.1, fonts/OFL.txt), loaded from the package: the
# container has no system fonts. Fontconfig reads the package's fonts.conf, which
# names that directory alone, so a label renders the same everywhere; a character
# Inter lacks (Inter covers Latin, Greek and Cyrillic) draws as a missing-glyph box.
FONT_FILE: Final = Path(__file__).parent / "fonts" / "Inter-Regular.ttf"
os.environ["FONTCONFIG_FILE"] = str(FONT_FILE.parent / "fonts.conf")
_FONT_POINTS: Final = 10
# Where the after photo does not cover the before photo's frame: a neutral dark grey.
BACKGROUND: Final = (13, 12, 12)

Image = npt.NDArray[np.uint8]


def _decode(data: bytes, content_type: str) -> pyvips.Image:
    check_signature(data, content_type)
    try:
        header = load_image(data, content_type)
        if header.width * header.height > MAX_PIXELS:
            raise JobFailure("PIXEL_LIMIT_EXCEEDED")
        image = to_srgb(load_image(data, content_type))
        if image.hasalpha():
            image = image.flatten(background=[255, 255, 255])
        if image.format != "uchar":
            image = image.cast("uchar")
        if image.bands == 1:
            image = image.bandjoin([image, image])
        return image.copy_memory().autorot()
    except pyvips.Error:
        raise JobFailure("DECODE_FAILED") from None


def _to_array(image: pyvips.Image) -> Image:
    pixels = image.extract_band(0, n=3).write_to_memory()
    return np.frombuffer(pixels, dtype=np.uint8).reshape(image.height, image.width, 3).copy()


def _resize_to_height(image: pyvips.Image, height: int) -> pyvips.Image:
    if image.height == height:
        return image
    return image.resize(height / image.height, kernel="lanczos3")


def _encode(pixels: Image, kind: str) -> Rendered:
    height, width = pixels.shape[:2]
    image = pyvips.Image.new_from_memory(pixels.tobytes(), width, height, 3, "uchar").copy(
        interpretation="srgb"
    )
    out = image.jpegsave_buffer(Q=JPEG_QUALITY, optimize_coding=True, keep=pyvips.enums.ForeignKeep.NONE)
    check_stripped(out)
    return Rendered(kind=kind, data=out, width=width, height=height)


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    """The arrays are RGB; OpenCV only needs the colour's channel order to match them."""
    value = hex_colour.lstrip("#")
    r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return (r, g, b)


def _text(
    pixels: Image, text: str, position: tuple[int, int], size: float, colour: tuple[int, int, int]
) -> None:
    """Renders text with libvips (Pango) and blends it in; size is a fraction of the image height.

    Pango reads its input as markup, so the label is escaped: it is drawn as written, never interpreted.
    """
    height, width = pixels.shape[:2]
    dpi = max(1, round(size * height * 72 / _FONT_POINTS))
    try:
        mask = pyvips.Image.text(
            html.escape(text, quote=False), font=f"Inter {_FONT_POINTS}", fontfile=str(FONT_FILE), dpi=dpi
        )
    except pyvips.Error:
        raise JobFailure("RENDER_CRASHED") from None
    ink = np.frombuffer(mask.write_to_memory(), dtype=np.uint8).reshape(mask.height, mask.width)
    x, y = position
    w, h = min(ink.shape[1], width - x), min(ink.shape[0], height - y)
    if w <= 0 or h <= 0:
        return
    alpha = ink[:h, :w, None].astype(np.float32) / 255
    region = pixels[y : y + h, x : x + w].astype(np.float32)
    pixels[y : y + h, x : x + w] = (region * (1 - alpha) + np.array(colour, np.float32) * alpha).astype(
        np.uint8
    )


def draw(pixels: Image, shapes: Sequence[dict[str, Any]]) -> None:
    """Draws resolved annotation shapes (colours as hex, sizes as fractions of the height)."""
    height, width = pixels.shape[:2]

    def at(point: Sequence[float]) -> tuple[int, int]:
        return (round(point[0] * (width - 1)), round(point[1] * (height - 1)))

    for shape in shapes:
        colour = _rgb(shape["color"])
        kind = shape["type"]
        if kind == "TEXT":
            _text(pixels, shape["text"], at(shape["position"]), shape["size"], colour)
            continue
        thickness = max(1, round(shape["stroke"] * height))
        if kind == "FREEHAND":
            points = np.array([at(p) for p in shape["points"]], dtype=np.int32)
            cv2.polylines(pixels, [points], False, colour, thickness, cv2.LINE_AA)
        elif kind == "LINE":
            cv2.line(pixels, at(shape["from"]), at(shape["to"]), colour, thickness, cv2.LINE_AA)
        elif kind == "ARROW":
            start, end = at(shape["from"]), at(shape["to"])
            length = math.dist(start, end) or 1.0
            tip = min(0.3, (thickness * 6) / length)
            cv2.arrowedLine(pixels, start, end, colour, thickness, cv2.LINE_AA, tipLength=tip)
        elif kind == "ELLIPSE":
            axes = (round(shape["radiusX"] * width), round(shape["radiusY"] * height))
            cv2.ellipse(pixels, at(shape["center"]), axes, 0, 0, 360, colour, thickness, cv2.LINE_AA)
        elif kind == "RECTANGLE":
            x, y = at(shape["origin"])
            w, h = round(shape["size"][0] * width), round(shape["size"][1] * height)
            cv2.rectangle(pixels, (x, y), (x + w, y + h), colour, thickness, cv2.LINE_AA)
        else:
            raise JobFailure("INVALID_JOB")


def render_single(
    data: bytes, content_type: str, max_edge: int, shapes: Sequence[dict[str, Any]] | None, kind: str
) -> Rendered:
    image = _decode(data, content_type)
    scale = min(1.0, max_edge / max(image.width, image.height))
    if scale < 1:
        image = image.resize(scale, kernel="lanczos3")
    pixels = _to_array(image)
    if shapes:
        draw(pixels, shapes)
    return _encode(pixels, kind)


def render_side_by_side(
    before: tuple[bytes, str],
    after: tuple[bytes, str],
    transform: dict[str, float] | None,
    max_edge: int,
    kind: str,
) -> Rendered:
    b_image = _decode(*before)
    a_image = _decode(*after)
    # Both at the smaller photo's height, reduced until the pair fits the long-edge limit.
    height = min(b_image.height, a_image.height, max_edge)
    b_width = b_image.width * height / b_image.height
    if 2 * b_width > max_edge:
        height = math.floor(height * max_edge / (2 * b_width))
    b_pixels = _to_array(_resize_to_height(b_image, height))
    a_pixels = _to_array(_resize_to_height(a_image, height))
    frame_h, frame_w = b_pixels.shape[:2]
    t = transform or {"scale": 1.0, "rotationDeg": 0.0, "translateX": 0.0, "translateY": 0.0}
    theta = math.radians(t["rotationDeg"])
    s = t["scale"]
    cos, sin = s * math.cos(theta), s * math.sin(theta)
    ca_x, ca_y = a_pixels.shape[1] / 2, a_pixels.shape[0] / 2
    # p_b = s R (p_a - c_a) + H t + c_b (the RegistrationTransform definition).
    matrix = np.array(
        [
            [cos, -sin, -(cos * ca_x - sin * ca_y) + height * t["translateX"] + frame_w / 2],
            [sin, cos, -(sin * ca_x + cos * ca_y) + height * t["translateY"] + frame_h / 2],
        ],
        dtype=np.float64,
    )
    placed = cv2.warpAffine(
        a_pixels, matrix, (frame_w, frame_h), flags=cv2.INTER_LANCZOS4, borderValue=BACKGROUND
    )
    return _encode(np.ascontiguousarray(np.hstack([b_pixels, np.asarray(placed, dtype=np.uint8)])), kind)


def render(job: dict[str, Any]) -> Rendered:
    """Renders the export a validated job describes (contract.ExportJob, as a plain dict)."""
    if job["layout"] == "SINGLE":
        (source,) = job["sources"]
        return render_single(source[0], source[1], job["max_edge"], job.get("shapes"), "EXPORT")
    before, after = job["sources"]
    return render_side_by_side(before, after, job.get("transform"), job["max_edge"], "EXPORT")
