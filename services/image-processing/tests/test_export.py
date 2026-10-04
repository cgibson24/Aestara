"""Purpose-specific export renders (ADR-0026 K3-14, K3-15): synthetic images, no photographs, no PHI."""

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt
import pytest
import pyvips
from support import PLANTED_TEXT, Emulator, jpeg_with_metadata, markers
from test_registration import expected, jpeg, moved, texture
from test_service import config_for

from aestara_image_processing import sandbox
from aestara_image_processing.consumer import Consumer, sqs_client
from aestara_image_processing.contract import ExportJob, InvalidJob, parse_message
from aestara_image_processing.errors import JobFailure
from aestara_image_processing.export import MAX_EXPORT_EDGE, render_side_by_side, render_single
from aestara_image_processing.service import JobRunner

ORIGIN = "http://127.0.0.1:5000"
RED = "#E5484D"


def pixels(data: bytes) -> npt.NDArray[np.uint8]:
    """Decoded as RGB, the channel order the renderer draws in."""
    image = pyvips.Image.new_from_buffer(data, "")
    out = np.frombuffer(image.write_to_memory(), dtype=np.uint8)
    return out.reshape(image.height, image.width, image.bands)


def dominant(pixel: npt.NDArray[np.uint8]) -> str:
    """The channel that clearly leads, or "none" for greys."""
    values = [int(v) for v in pixel]
    top = max(values)
    if top < 150 or sorted(values)[1] > top - 70:
        return "none"
    return ("red", "green", "blue")[values.index(top)]


def no_metadata(data: bytes) -> None:
    assert data.startswith(b"\xff\xd8")
    assert PLANTED_TEXT not in data
    assert not [m for m in markers(data) if 0xE0 <= m <= 0xEF or m == 0xFE]


def plain(width: int = 800, height: int = 600, value: int = 128) -> bytes:
    return jpeg(np.full((height, width, 3), value, np.uint8))


def test_a_single_export_is_upright_stripped_and_within_the_limit() -> None:
    original = jpeg_with_metadata(4032, 3024, orientation=6)
    rendered = render_single(original, "image/jpeg", MAX_EXPORT_EDGE, None, "EXPORT")
    # Orientation 6 turns the landscape sensor image upright: portrait, long edge at most 4096.
    assert (rendered.width, rendered.height) == (3024, 4032)
    no_metadata(rendered.data)
    smaller = render_single(original, "image/jpeg", 2048, None, "EXPORT")
    assert (smaller.width, smaller.height) == (1536, 2048)


def test_an_export_never_enlarges_a_photo() -> None:
    rendered = render_single(plain(800, 600), "image/jpeg", MAX_EXPORT_EDGE, None, "EXPORT")
    assert (rendered.width, rendered.height) == (800, 600)


def test_an_annotation_layer_is_drawn_in_at_its_normalized_place() -> None:
    shapes = [
        {"type": "RECTANGLE", "origin": [0.25, 0.25], "size": [0.5, 0.5], "color": RED, "stroke": 0.008},
        {"type": "LINE", "from": [0.1, 0.9], "to": [0.9, 0.9], "color": "#3E8BFF", "stroke": 0.004},
    ]
    out = pixels(render_single(plain(), "image/jpeg", MAX_EXPORT_EDGE, shapes, "EXPORT").data)
    # The rectangle's left edge at x = 0.25 * 799 ≈ 200, halfway down: red.
    assert dominant(out[300, 200]) == "red"
    # Its inside stays the grey of the photo: an outline, never a fill.
    assert abs(int(out[300, 400][0]) - 128) < 12
    assert dominant(out[round(0.9 * 599), 400]) == "blue"


@pytest.mark.parametrize(
    "shape",
    [
        {"type": "FREEHAND", "points": [[0.1, 0.1], [0.5, 0.4], [0.9, 0.2]], "color": RED, "stroke": 0.004},
        {"type": "ARROW", "from": [0.2, 0.8], "to": [0.8, 0.2], "color": RED, "stroke": 0.004},
        {
            "type": "ELLIPSE",
            "center": [0.5, 0.5],
            "radiusX": 0.2,
            "radiusY": 0.1,
            "color": RED,
            "stroke": 0.004,
        },
    ],
    ids=["freehand", "arrow", "ellipse"],
)
def test_every_stroke_shape_draws(shape: dict[str, Any]) -> None:
    out = pixels(render_single(plain(), "image/jpeg", MAX_EXPORT_EDGE, [shape], "EXPORT").data)
    red = (out[:, :, 0] > 180) & (out[:, :, 1] < 110)
    assert red.sum() > 200


def test_text_labels_are_drawn_as_written_and_never_read_as_markup() -> None:
    base = pixels(render_single(plain(value=40), "image/jpeg", MAX_EXPORT_EDGE, None, "EXPORT").data)
    shapes = [
        {
            "type": "TEXT",
            "position": [0.1, 0.1],
            "text": "Région & <b>levée</b> ↑ 眉",
            "color": "#FFFFFF",
            "size": 0.045,
        }
    ]
    out = pixels(render_single(plain(value=40), "image/jpeg", MAX_EXPORT_EDGE, shapes, "EXPORT").data)
    changed = np.abs(out.astype(int) - base.astype(int)).max(axis=2) > 60
    ys, xs = np.nonzero(changed)
    assert len(xs) > 300
    # Ink starts near the label's top-left and stays a line of text high.
    assert xs.min() >= 75
    assert ys.min() >= 55
    assert ys.max() - ys.min() < 0.1 * 600


def test_a_side_by_side_export_places_the_after_photo_by_the_transform() -> None:
    before = texture()
    after = moved(before, 0.95, 4.0, (30.0, -20.0))
    scale, rotation, tx, ty = expected(0.95, 4.0, (30.0, -20.0), before.shape[0])
    transform = {"scale": scale, "rotationDeg": rotation, "translateX": tx, "translateY": ty}
    aligned = render_side_by_side(
        (jpeg(before), "image/jpeg"), (jpeg(after), "image/jpeg"), transform, MAX_EXPORT_EDGE, "EXPORT"
    )
    unaligned = render_side_by_side(
        (jpeg(before), "image/jpeg"), (jpeg(after), "image/jpeg"), None, MAX_EXPORT_EDGE, "EXPORT"
    )
    assert (aligned.width, aligned.height) == (1800, 1200)
    no_metadata(aligned.data)

    def difference(data: bytes) -> float:
        out = pixels(data).astype(np.float32)
        left, right = out[:, :900], out[:, 900:]
        centre = (slice(200, 1000), slice(150, 750))
        return float(np.abs(left[centre] - right[centre]).mean())

    assert difference(aligned.data) < 12
    assert difference(unaligned.data) > 2 * difference(aligned.data)


def test_a_side_by_side_export_shows_both_at_the_same_height_within_the_limit() -> None:
    before = jpeg(texture(1200, 900))
    after = jpeg(texture(600, 800, seed=3))
    rendered = render_side_by_side((before, "image/jpeg"), (after, "image/jpeg"), None, 1000, "EXPORT")
    # The pair's height is the smaller photo's, reduced until twice the before photo's width fits.
    assert rendered.height == 375
    assert rendered.width == 1000


def test_a_corrupt_source_fails_the_render() -> None:
    with pytest.raises(JobFailure) as failure:
        render_single(b"\xff\xd8\xff\xe0 not really", "image/jpeg", MAX_EXPORT_EDGE, None, "EXPORT")
    assert failure.value.code == "DECODE_FAILED"


def test_the_sandbox_renders_an_export_in_a_child_process() -> None:
    shapes = [{"type": "TEXT", "position": [0.2, 0.2], "text": "Brow", "color": "#111111", "size": 0.03}]
    rendered = sandbox.export_isolated(
        {
            "layout": "SINGLE",
            "sources": [(plain(), "image/jpeg")],
            "max_edge": 1024,
            "shapes": shapes,
            "transform": None,
        },
        30.0,
    )
    assert (rendered.width, rendered.height) == (800, 600)
    no_metadata(rendered.data)


SOURCE: dict[str, Any] = {
    "url": f"{ORIGIN}/s",
    "contentType": "image/jpeg",
    "byteSize": 10,
    "sha256": "a" * 64,
}
TRANSFORM: dict[str, Any] = {"scale": 1.0, "rotationDeg": 0.0, "translateX": 0.0, "translateY": 0.0}
LINE: dict[str, Any] = {"type": "LINE", "from": [0, 0], "to": [1, 1], "color": RED, "stroke": 0.004}


def export_message(**overrides: Any) -> dict[str, Any]:
    return {
        "task": "EXPORT",
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "layout": "SINGLE",
        "sources": [SOURCE],
        "output": {"url": f"{ORIGIN}/o", "headers": {"content-type": "image/jpeg"}, "maxEdgePx": 4096},
        "shapes": [],
        "transform": None,
        "expiresAt": datetime.now(UTC).isoformat(),
        **overrides,
    }


def test_the_contract_parses_an_export_job() -> None:
    job = parse_message(json.dumps(export_message()), ORIGIN)
    assert isinstance(job, ExportJob)
    assert (job.layout, job.output.max_edge_px, job.shapes, job.transform) == ("SINGLE", 4096, (), None)


@pytest.mark.parametrize(
    "overrides",
    [
        {"layout": "COLLAGE"},
        {"sources": []},
        {"layout": "SIDE_BY_SIDE"},  # one source for two places
        {"output": {"url": "https://example.com/o", "maxEdgePx": 4096}},
        {"output": {"url": f"{ORIGIN}/o", "maxEdgePx": 8192}},
        {"shapes": [{**LINE, "color": "red"}]},
        {"shapes": [{**LINE, "to": [1.2, 0.5]}]},
        {"shapes": [{**LINE, "stroke": 0.5}]},
        {"shapes": [{**LINE, "type": "POLYGON"}]},
        {"shapes": [{"type": "TEXT", "position": [0, 0], "text": "", "color": RED, "size": 0.03}]},
        {"shapes": [LINE] * 501},
        {"transform": TRANSFORM},  # a single photo has nothing to align
        {"layout": "SIDE_BY_SIDE", "sources": [SOURCE, SOURCE], "shapes": [LINE]},
        {"layout": "SIDE_BY_SIDE", "sources": [SOURCE, SOURCE], "transform": dict(TRANSFORM, scale=9.0)},
        {"layout": "SIDE_BY_SIDE", "sources": [SOURCE, SOURCE], "transform": {"scale": 1.0}},
    ],
    ids=[
        "layout",
        "no-source",
        "one-source-for-two",
        "foreign-output",
        "edge-too-large",
        "colour-name",
        "point-outside",
        "stroke-too-wide",
        "unknown-shape",
        "empty-text",
        "too-many-shapes",
        "transform-on-single",
        "shapes-on-pair",
        "scale-outside",
        "partial-transform",
    ],
)
def test_the_contract_refuses_an_invalid_export(overrides: dict[str, Any]) -> None:
    with pytest.raises(InvalidJob) as invalid:
        parse_message(json.dumps(export_message(**overrides)), ORIGIN)
    assert invalid.value.export
    assert invalid.value.job_id is not None


def export_job(emulator: Emulator, sources: list[bytes], **overrides: Any) -> tuple[dict[str, Any], str]:
    """An export message shaped as the api worker builds it (exports.ts, dispatch), and its output key."""

    def source(data: bytes) -> dict[str, Any]:
        key = emulator.put_source(data)
        url = emulator.s3.generate_presigned_url(
            "get_object", Params={"Bucket": emulator.bucket, "Key": key}, ExpiresIn=600
        )
        return {
            "url": url,
            "contentType": "image/jpeg",
            "byteSize": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }

    key = f"CLINICAL_DERIVATIVE/{uuid.uuid4()}"
    url = emulator.s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": emulator.bucket, "Key": key, "ContentType": "image/jpeg", "IfNoneMatch": "*"},
        ExpiresIn=600,
    )
    message = {
        "task": "EXPORT",
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "layout": "SINGLE" if len(sources) == 1 else "SIDE_BY_SIDE",
        "sources": [source(s) for s in sources],
        "output": {
            "url": url,
            "headers": {"content-type": "image/jpeg", "if-none-match": "*"},
            "maxEdgePx": MAX_EXPORT_EDGE,
        },
        "shapes": [],
        "transform": None,
        "expiresAt": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
        **overrides,
    }
    return message, key


def test_an_export_job_writes_its_output_and_reports_it(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    shapes = [{"type": "TEXT", "position": [0.1, 0.1], "text": "Brow", "color": RED, "size": 0.03}]
    job, key = export_job(emulator, [jpeg_with_metadata(1200, 900)], shapes=shapes)
    emulator.send(job)
    assert consumer.poll_once(wait_seconds=1) == 1
    (result,) = emulator.results()
    written = emulator.read(key)
    assert (result["type"], result["task"], result["status"]) == (
        "image.export.completed",
        "EXPORT",
        "SUCCEEDED",
    )
    assert result["output"] == {
        "sha256": hashlib.sha256(written).hexdigest(),
        "byteSize": len(written),
        "widthPx": 900,
        "heightPx": 1200,
    }
    no_metadata(written)
    assert "http" not in json.dumps(result)
    assert "Brow" not in json.dumps(result)


def test_a_repeated_delivery_finds_its_output_written(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    before = texture()
    job, key = export_job(
        emulator, [jpeg(before), jpeg(moved(before, 1.0, 2.0, (5.0, 0.0)))], transform=TRANSFORM
    )
    emulator.send(job)
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    consumer.poll_once(wait_seconds=1)
    results = emulator.results()
    # The second render meets the write-once object and reports the same bytes: rendering is deterministic.
    assert [r["status"] for r in results] == ["SUCCEEDED", "SUCCEEDED"]
    assert results[0]["output"] == results[1]["output"]
    assert results[0]["output"]["sha256"] == hashlib.sha256(emulator.read(key)).hexdigest()


def test_an_export_that_cannot_render_fails_and_writes_nothing(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    job, key = export_job(emulator, [b"\xff\xd8\xff\xe0 not an image"])
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["type"], result["status"], result["errorCode"], result["retryable"]) == (
        "image.export.failed",
        "FAILED",
        "DECODE_FAILED",
        False,
    )
    assert "Contents" not in emulator.s3.list_objects_v2(Bucket=emulator.bucket, Prefix=key)


def test_an_invalid_export_job_is_failed_as_an_export(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    job, _ = export_job(emulator, [plain()], shapes=[{**LINE, "color": "red"}])
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["type"], result["errorCode"]) == ("image.export.failed", "INVALID_JOB")


def test_a_derivative_parser_refuses_an_export_job() -> None:
    from aestara_image_processing.contract import parse_job

    with pytest.raises(InvalidJob) as invalid:
        parse_job(json.dumps(export_message()), ORIGIN)
    assert (invalid.value.registration, str(invalid.value)) == (False, "task")


def _grey_level(data: bytes) -> float:
    out = cv2.cvtColor(pixels(data), cv2.COLOR_RGB2GRAY)
    return float(np.asarray(out).mean())


def test_the_background_outside_the_aligned_after_photo_is_neutral() -> None:
    white = jpeg(np.full((400, 300, 3), 255, np.uint8))
    shrink = {"scale": 0.5, "rotationDeg": 0.0, "translateX": 0.0, "translateY": 0.0}
    rendered = render_side_by_side((white, "image/jpeg"), (white, "image/jpeg"), shrink, 4096, "EXPORT")
    out = pixels(rendered.data)
    corner = out[5:40, 305:340]
    assert np.abs(corner.astype(int) - np.array([13, 12, 12])).max() < 10
    assert _grey_level(rendered.data) < 255
