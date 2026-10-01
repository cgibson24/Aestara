"""Derivative rendering with libvips (Bible §6.6; ADR-0023 K2-01, K2-06).

Each derivative is a JPEG in sRGB with the orientation applied and every
metadata block removed (EXIF with any GPS position, XMP, IPTC, ICC profiles and
comments). Only the JPEG and PNG loaders are called, chosen by the file's
first bytes, after `harden()` has blocked every other loader. An image over
the pixel limit is refused from its header, before any pixel is decoded.
Rendering is deterministic, so a repeated job produces the same bytes.

This module runs inside the sandbox child (sandbox.py); the consumer process
never decodes an image.
"""

from collections.abc import Sequence
from typing import Final

import pyvips

from .config import MAX_PIXELS
from .contract import Rendered
from .errors import JobFailure

SIGNATURES: Final = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}
JPEG_QUALITY: Final = 85
# JPEG markers that carry metadata: APP0 to APP15 and COM.
_METADATA_MARKERS: Final = frozenset(range(0xE0, 0xF0)) | {0xFE}


def harden() -> None:
    """Blocks every loader except JPEG and PNG, and libvips' untrusted operations. Once per process."""
    pyvips.block_untrusted_set(True)
    pyvips.operation_block_set("VipsForeignLoad", True)
    pyvips.operation_block_set("VipsForeignLoadJpeg", False)
    pyvips.operation_block_set("VipsForeignLoadPng", False)
    # Each job is a fresh process; nothing is worth caching.
    pyvips.cache_set_max(0)


def check_signature(data: bytes, content_type: str) -> None:
    """The first bytes must match the declared type (the api checked the same at completion)."""
    signature = SIGNATURES.get(content_type)
    if signature is None or not data.startswith(signature):
        raise JobFailure("UNSUPPORTED_FORMAT")


def _load(data: bytes, content_type: str, shrink: int = 1) -> pyvips.Image:
    if content_type == "image/jpeg":
        return pyvips.Image.jpegload_buffer(data, shrink=shrink, access="sequential", fail_on="error")
    return pyvips.Image.pngload_buffer(data, access="sequential", fail_on="error")


def _to_srgb(image: pyvips.Image) -> pyvips.Image:
    if image.get_typeof("icc-profile-data") != 0:
        try:
            return image.icc_transform("srgb", embedded=True, intent="perceptual")
        except pyvips.Error:
            # An unusable embedded profile: convert as if it were absent.
            pass
    if image.interpretation != "srgb":
        return image.colourspace("srgb")
    return image


def _render_one(data: bytes, content_type: str, long_edge: int, kind: str, max_edge: int) -> Rendered:
    # JPEG can decode at 1/2, 1/4 or 1/8 scale, staying at or above the target size.
    shrink = 1
    if content_type == "image/jpeg":
        while shrink < 8 and long_edge // (shrink * 2) >= max_edge:
            shrink *= 2
    image = _to_srgb(_load(data, content_type, shrink))
    if image.hasalpha():
        image = image.flatten(background=[255, 255, 255])
    if image.format != "uchar":
        image = image.cast("uchar")
    scale = max_edge / max(image.width, image.height)
    if scale < 1:
        image = image.resize(scale, kernel="lanczos3")
    # The source streams top to bottom; a quarter turn needs the whole (now small) image at once.
    image = image.copy_memory().autorot()
    out = image.jpegsave_buffer(Q=JPEG_QUALITY, optimize_coding=True, keep=pyvips.enums.ForeignKeep.NONE)
    check_stripped(out)
    return Rendered(kind=kind, data=out, width=image.width, height=image.height)


def render(data: bytes, content_type: str, specs: Sequence[tuple[str, int]]) -> list[Rendered]:
    """Renders each (kind, max edge) from the original bytes; the original is only read."""
    check_signature(data, content_type)
    try:
        header = _load(data, content_type)
        width, height = header.width, header.height
    except pyvips.Error:
        raise JobFailure("DECODE_FAILED") from None
    if width * height > MAX_PIXELS:
        raise JobFailure("PIXEL_LIMIT_EXCEEDED")
    try:
        return [_render_one(data, content_type, max(width, height), kind, edge) for kind, edge in specs]
    except pyvips.Error:
        # Pixels are decoded lazily, so a corrupt image body surfaces here.
        raise JobFailure("DECODE_FAILED") from None


def check_stripped(jpeg: bytes) -> None:
    """No metadata segment may precede the image data. A second line of defence after keep=NONE."""
    if not jpeg.startswith(b"\xff\xd8"):
        raise JobFailure("METADATA_NOT_STRIPPED")
    i = 2
    while i + 4 <= len(jpeg):
        if jpeg[i] != 0xFF:
            raise JobFailure("METADATA_NOT_STRIPPED")
        marker = jpeg[i + 1]
        if marker == 0xDA:  # start of scan: the header is over
            return
        if marker in _METADATA_MARKERS:
            raise JobFailure("METADATA_NOT_STRIPPED")
        length = int.from_bytes(jpeg[i + 2 : i + 4], "big")
        i += 2 + length
    raise JobFailure("METADATA_NOT_STRIPPED")
