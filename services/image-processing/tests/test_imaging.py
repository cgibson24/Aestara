"""Rendering: sizes, orientation, colour, metadata stripping, limits and refusals (ADR-0023 K2-01, K2-06)."""

import subprocess
import sys
import textwrap

import pytest
import pyvips
from support import (
    PLANTED_TEXT,
    gradient,
    grey_jpeg,
    jpeg_with_metadata,
    markers,
    png_header_only,
    png_rgba16,
)

from aestara_image_processing import imaging
from aestara_image_processing.errors import JobFailure

SPECS = [("THUMBNAIL", 400), ("DISPLAY_PREVIEW", 2048)]


def test_renders_both_sizes_with_the_orientation_applied() -> None:
    # 4032 x 3024 stored, EXIF orientation 6: displayed upright as 3024 x 4032.
    thumb, preview = imaging.render(jpeg_with_metadata(), "image/jpeg", SPECS)
    assert (thumb.kind, thumb.width, thumb.height) == ("THUMBNAIL", 300, 400)
    assert (preview.kind, preview.width, preview.height) == ("DISPLAY_PREVIEW", 1536, 2048)
    for output in (thumb, preview):
        image = pyvips.Image.jpegload_buffer(output.data)
        assert (image.width, image.height) == (output.width, output.height)
        assert image.bands == 3
        assert image.interpretation == "srgb"


def test_strips_every_metadata_block() -> None:
    source = jpeg_with_metadata()
    assert PLANTED_TEXT in source
    for output in imaging.render(source, "image/jpeg", SPECS):
        found = markers(output.data)
        assert found[-1] == 0xDA
        assert not [m for m in found if 0xE0 <= m <= 0xEF or m == 0xFE]
        for needle in (
            b"Exif\x00\x00",
            b"http://ns.adobe.com/xap",
            b"ICC_PROFILE",
            b"Photoshop 3.0",
            PLANTED_TEXT,
        ):
            assert needle not in output.data
        image = pyvips.Image.jpegload_buffer(output.data)
        fields = set(image.get_fields())
        assert not fields & {"exif-data", "xmp-data", "iptc-data", "icc-profile-data", "jpeg-comment-0"}
        assert image.get_typeof("orientation") == 0


def test_never_upscales_a_small_image() -> None:
    small = gradient(320, 200).jpegsave_buffer(Q=90)
    thumb, preview = imaging.render(small, "image/jpeg", SPECS)
    assert (thumb.width, thumb.height) == (320, 200)
    assert (preview.width, preview.height) == (320, 200)


def test_png_with_alpha_and_16_bits_becomes_an_opaque_8_bit_jpeg() -> None:
    thumb, preview = imaging.render(png_rgba16(), "image/png", SPECS)
    assert (thumb.width, thumb.height) == (400, 300)
    assert (preview.width, preview.height) == (640, 480)
    image = pyvips.Image.jpegload_buffer(preview.data)
    assert (image.bands, image.format) == (3, "uchar")


def test_greyscale_becomes_srgb() -> None:
    (thumb,) = imaging.render(grey_jpeg(), "image/jpeg", [("THUMBNAIL", 400)])
    assert pyvips.Image.jpegload_buffer(thumb.data).bands == 3


def test_rendering_is_deterministic() -> None:
    source = jpeg_with_metadata(1200, 900)
    first = imaging.render(source, "image/jpeg", SPECS)
    second = imaging.render(source, "image/jpeg", SPECS)
    assert [r.data for r in first] == [r.data for r in second]


def test_refuses_an_image_over_100_megapixels_from_its_header() -> None:
    # 12000 x 9000 = 108 MP. The image data is junk, so only a header check can answer this.
    with pytest.raises(JobFailure) as refused:
        imaging.render(png_header_only(12_000, 9_000), "image/png", SPECS)
    assert (refused.value.code, refused.value.retryable) == ("PIXEL_LIMIT_EXCEEDED", False)
    # Just under the limit, the same junk reaches the decoder and fails there.
    with pytest.raises(JobFailure) as junk:
        imaging.render(png_header_only(10_000, 10_000), "image/png", SPECS)
    assert junk.value.code == "DECODE_FAILED"


@pytest.mark.parametrize(
    ("data", "declared"),
    [
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/jpeg"),  # a PNG declared as JPEG
        (b"\xff\xd8\xff\xe0" + b"\x00" * 64, "image/png"),  # a JPEG declared as PNG
        (b"GIF89a" + b"\x00" * 64, "image/png"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/jpeg"),
        (b"\xff\xd8\xff\xe0", "image/heic"),
    ],
)
def test_refuses_a_file_whose_bytes_do_not_match_its_type(data: bytes, declared: str) -> None:
    with pytest.raises(JobFailure) as refused:
        imaging.render(data, declared, SPECS)
    assert (refused.value.code, refused.value.retryable) == ("UNSUPPORTED_FORMAT", False)


def test_refuses_a_corrupt_or_truncated_jpeg() -> None:
    whole = gradient(800, 600).jpegsave_buffer(Q=90)
    for broken in (whole[: len(whole) // 2], b"\xff\xd8\xff\xdb" + b"\x13" * 4096):
        with pytest.raises(JobFailure) as refused:
            imaging.render(broken, "image/jpeg", SPECS)
        assert (refused.value.code, refused.value.retryable) == ("DECODE_FAILED", False)


def test_check_stripped_rejects_any_metadata_segment() -> None:
    clean = gradient(64, 48).jpegsave_buffer(keep=pyvips.enums.ForeignKeep.NONE)
    imaging.check_stripped(clean)
    for marker in (0xE0, 0xE1, 0xE2, 0xED, 0xFE):
        tainted = clean[:2] + bytes([0xFF, marker, 0x00, 0x04, 0x41, 0x42]) + clean[2:]
        with pytest.raises(JobFailure, match="METADATA_NOT_STRIPPED"):
            imaging.check_stripped(tainted)


def test_harden_blocks_every_loader_but_jpeg_and_png() -> None:
    # In a fresh interpreter: blocking is process-wide, as it is in each sandbox child.
    script = textwrap.dedent(
        """
        import pyvips
        from aestara_image_processing import imaging
        base = pyvips.Image.black(32, 24, bands=3) + 128
        samples = {
            "jpeg": base.jpegsave_buffer(), "png": base.pngsave_buffer(), "gif": base.gifsave_buffer(),
            "tiff": base.tiffsave_buffer(), "webp": base.webpsave_buffer(),
            "svg": b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
        }
        imaging.harden()
        for name, data in samples.items():
            try:
                pyvips.Image.new_from_buffer(data, "").avg()
                print(name, "loaded")
            except pyvips.Error:
                print(name, "blocked")
        """
    )
    out = subprocess.run(  # noqa: S603 - our own interpreter and script
        [sys.executable, "-c", script], capture_output=True, text=True, check=True, timeout=60
    )
    assert out.stdout.split("\n")[:-1] == [
        "jpeg loaded",
        "png loaded",
        "gif blocked",
        "tiff blocked",
        "webp blocked",
        "svg blocked",
    ]
