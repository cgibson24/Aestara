"""Automatic before/after registration (ADR-0026 K3-13): synthetic images with known transforms.

The images are generated shapes on a plain ground: no photographs, no PHI.
"""

import hashlib
import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import cv2
import numpy as np
import numpy.typing as npt
import pytest
from support import Emulator
from test_service import config_for

from aestara_image_processing import sandbox
from aestara_image_processing.config import load_config
from aestara_image_processing.consumer import Consumer, sqs_client
from aestara_image_processing.contract import parse_message
from aestara_image_processing.errors import JobFailure
from aestara_image_processing.registration import register
from aestara_image_processing.service import JobRunner


def texture(width: int = 900, height: int = 1200, seed: int = 7) -> npt.NDArray[np.uint8]:
    """Random filled circles and rectangles: enough corners for features, nothing else."""
    rng = np.random.default_rng(seed)
    image = np.full((height, width, 3), 200, np.uint8)
    for _ in range(400):
        x, y = int(rng.integers(0, width)), int(rng.integers(0, height))
        r = int(rng.integers(4, 40))
        colour = tuple(int(v) for v in rng.integers(0, 255, 3))
        if rng.random() < 0.5:
            cv2.circle(image, (x, y), r, colour, -1)
        else:
            cv2.rectangle(image, (x, y), (x + r, y + r // 2), colour, -1)
    return image


def jpeg(image: npt.NDArray[np.uint8]) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return bytes(buffer.tobytes())


def moved(
    image: npt.NDArray[np.uint8], scale: float, clockwise_deg: float, shift: tuple[float, float]
) -> npt.NDArray[np.uint8]:
    """The image scaled and turned about its centre, then shifted (pixels): a later 'after' photo."""
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), -clockwise_deg, scale)
    matrix[0, 2] += shift[0]
    matrix[1, 2] += shift[1]
    out = cv2.warpAffine(image, matrix, (width, height), borderValue=(200, 200, 200))
    return np.asarray(out, dtype=np.uint8)


def expected(
    scale: float, clockwise_deg: float, shift: tuple[float, float], height: int
) -> tuple[float, float, float, float]:
    """The transform that puts that 'after' image back over the 'before' (the inverse move)."""
    theta = math.radians(-clockwise_deg)
    cos, sin = math.cos(theta), math.sin(theta)
    tx = -(cos * shift[0] - sin * shift[1]) / scale / height
    ty = -(sin * shift[0] + cos * shift[1]) / scale / height
    return 1 / scale, -clockwise_deg, tx, ty


@pytest.mark.parametrize(
    ("scale", "turn", "shift"),
    [(0.95, 4.0, (30.0, -20.0)), (1.1, -6.0, (-45.0, 12.0)), (1.0, 0.0, (0.0, 0.0))],
)
def test_recovers_a_known_similarity_transform(scale: float, turn: float, shift: tuple[float, float]) -> None:
    before = texture()
    result = register(jpeg(before), "image/jpeg", jpeg(moved(before, scale, turn, shift)), "image/jpeg")
    s, r, tx, ty = expected(scale, turn, shift, before.shape[0])
    assert result.scale == pytest.approx(s, abs=0.01)
    assert result.rotation_deg == pytest.approx(r, abs=0.3)
    assert result.translate_x == pytest.approx(tx, abs=0.005)
    assert result.translate_y == pytest.approx(ty, abs=0.005)
    assert result.inliers >= 12


def test_the_transform_does_not_depend_on_the_preview_sizes() -> None:
    before = texture()
    after = moved(before, 0.95, 4.0, (30.0, -20.0))
    full = register(jpeg(before), "image/jpeg", jpeg(after), "image/jpeg")
    half = np.asarray(
        cv2.resize(after, (after.shape[1] // 2, after.shape[0] // 2), interpolation=cv2.INTER_AREA),
        dtype=np.uint8,
    )
    smaller = register(jpeg(before), "image/jpeg", jpeg(half), "image/jpeg")
    assert smaller.scale == pytest.approx(full.scale, abs=0.01)
    assert smaller.rotation_deg == pytest.approx(full.rotation_deg, abs=0.3)
    assert smaller.translate_x == pytest.approx(full.translate_x, abs=0.005)
    assert smaller.translate_y == pytest.approx(full.translate_y, abs=0.005)


@pytest.mark.parametrize(
    "after",
    [
        np.full((1200, 900, 3), 128, np.uint8),  # nothing to match
        texture(seed=99),  # a different subject altogether
        moved(texture(), 1.0, 35.0, (0.0, 0.0)),  # a turn larger than any alignment should make
    ],
    ids=["featureless", "unrelated", "turned-too-far"],
)
def test_finds_no_reliable_alignment_when_there_is_none(after: npt.NDArray[np.uint8]) -> None:
    with pytest.raises(JobFailure) as failure:
        register(jpeg(texture()), "image/jpeg", jpeg(after), "image/jpeg")
    assert failure.value.code == "NO_RELIABLE_ALIGNMENT"
    assert failure.value.retryable is False


def test_refuses_a_file_that_is_not_what_it_claims() -> None:
    with pytest.raises(JobFailure) as failure:
        register(b"not an image", "image/jpeg", jpeg(texture()), "image/jpeg")
    assert failure.value.code == "UNSUPPORTED_FORMAT"


def test_the_sandbox_registers_in_a_child_process() -> None:
    before = texture()
    result = sandbox.register_isolated(
        jpeg(before), "image/jpeg", jpeg(moved(before, 1.0, 3.0, (10.0, 5.0))), "image/jpeg", 30.0
    )
    assert result.rotation_deg == pytest.approx(-3.0, abs=0.3)


def registration_job(emulator: Emulator, before: bytes, after: bytes, **overrides: Any) -> dict[str, Any]:
    """A registration message shaped as the api worker builds it (registrations.ts, dispatch)."""

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

    return {
        "task": "REGISTRATION",
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "before": source(before),
        "after": source(after),
        "expiresAt": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
        **overrides,
    }


def test_a_registration_job_reports_its_transform_and_writes_nothing(
    emulator: Emulator, tmp_path: object
) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    before = texture()
    job = registration_job(emulator, jpeg(before), jpeg(moved(before, 0.95, 4.0, (30.0, -20.0))))
    objects_before = len(emulator.s3.list_objects_v2(Bucket=emulator.bucket).get("Contents", []))
    emulator.send(job)
    assert consumer.poll_once(wait_seconds=1) == 1
    (result,) = emulator.results()
    assert result["type"] == "image.registration.completed"
    assert (result["task"], result["jobId"], result["status"]) == ("REGISTRATION", job["jobId"], "SUCCEEDED")
    assert set(result["transform"]) == {"scale", "rotationDeg", "translateX", "translateY"}
    assert result["transform"]["rotationDeg"] == pytest.approx(-4.0, abs=0.3)
    assert result["inliers"] >= 12
    assert "http" not in json.dumps(result)
    assert len(emulator.s3.list_objects_v2(Bucket=emulator.bucket).get("Contents", [])) == objects_before


def test_a_registration_without_alignment_fails_without_a_retry(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    flat = jpeg(np.full((600, 450, 3), 128, np.uint8))
    emulator.send(registration_job(emulator, flat, flat))
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["type"], result["status"], result["errorCode"], result["retryable"]) == (
        "image.registration.failed",
        "FAILED",
        "NO_RELIABLE_ALIGNMENT",
        False,
    )


def test_an_invalid_registration_job_is_failed_as_a_registration(
    emulator: Emulator, tmp_path: object
) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    job = registration_job(emulator, b"x", b"y")
    job["after"]["url"] = "https://example.com/elsewhere"
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["type"], result["errorCode"]) == ("image.registration.failed", "INVALID_JOB")


def test_a_corrupted_preview_fails_its_integrity_check(emulator: Emulator, tmp_path: object) -> None:
    config = config_for(emulator, tmp_path)
    consumer = Consumer(config, JobRunner(config), sqs_client(config))
    image = jpeg(texture())
    job = registration_job(emulator, image, image)
    job["after"]["sha256"] = "0" * 64
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["status"], result["errorCode"]) == ("FAILED", "SOURCE_INTEGRITY")


def test_the_contract_parses_both_kinds() -> None:
    origin = "http://127.0.0.1:5000"
    config = load_config({"IMAGE_JOBS_QUEUE_URL": f"{origin}/q", "IMAGE_RESULTS_QUEUE_URL": f"{origin}/r"})
    assert config.object_origin is None
    message = {
        "task": "REGISTRATION",
        "jobId": str(uuid.uuid4()),
        "attempt": 2,
        "before": {"url": f"{origin}/b", "contentType": "image/jpeg", "byteSize": 10, "sha256": "a" * 64},
        "after": {"url": f"{origin}/a", "contentType": "image/jpeg", "byteSize": 10, "sha256": "b" * 64},
        "expiresAt": datetime.now(UTC).isoformat(),
    }
    job = parse_message(json.dumps(message), origin)
    assert type(job).__name__ == "RegistrationJob"
