"""The image job contract with the api worker (spec §6.7; ADR-0023 K2-06, ADR-0026 K3-13).

The worker sends `image.derivative.requested` with opaque presigned URLs and
output parameters (services/api/src/worker/derivatives.ts, ImageJobMessage);
this service answers `image.derivative.completed` or `image.derivative.failed`
in the shape of ImageJobResult there. A message with `"task": "REGISTRATION"`
asks for the alignment of two display previews instead
(services/api/src/worker/registrations.ts, RegistrationJobMessage) and is
answered with `image.registration.completed` or `.failed`. A message with
`"task": "EXPORT"` asks for a purpose-specific export render
(services/api/src/worker/exports.ts, ExportJobMessage), answered with
`image.export.completed` or `.failed`. No message names a patient. The one
free text any job carries is an export's annotation labels: they are drawn,
never logged and never reported back.
"""

import hashlib
import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Final, TypeIs
from urllib.parse import urlsplit

from . import __version__
from .config import MAX_SOURCE_BYTES
from .errors import JobFailure

KINDS: Final = ("THUMBNAIL", "DISPLAY_PREVIEW")
SOURCE_TYPES: Final = ("image/jpeg", "image/png")
MIN_EDGE_PX: Final = 16
MAX_EDGE_PX: Final = 4096
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_HEADER_NAME = re.compile(r"^[A-Za-z0-9-]{1,64}$")


@dataclass(frozen=True)
class OutputSpec:
    kind: str
    url: str
    headers: dict[str, str]
    max_edge_px: int


@dataclass(frozen=True)
class Job:
    job_id: str
    attempt: int
    source_url: str
    source_type: str
    source_bytes: int
    source_sha256: str
    outputs: tuple[OutputSpec, ...]
    expires_at: datetime


@dataclass(frozen=True)
class Rendered:
    kind: str
    data: bytes
    width: int
    height: int


@dataclass(frozen=True)
class Transform:
    """A registration result (ADR-0026 K3-13); see registration.py for its units."""

    scale: float
    rotation_deg: float
    translate_x: float
    translate_y: float
    inliers: int


@dataclass(frozen=True)
class ExportJob:
    job_id: str
    attempt: int
    layout: str
    sources: tuple["Source", ...]
    output: OutputSpec
    shapes: tuple[dict[str, Any], ...]
    transform: dict[str, float] | None
    expires_at: datetime


@dataclass(frozen=True)
class Source:
    url: str
    content_type: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class RegistrationJob:
    job_id: str
    attempt: int
    before: Source
    after: Source
    expires_at: datetime


class InvalidJob(ValueError):
    """A message that is not a valid job. It names the job when it can, so the job can be failed."""

    def __init__(
        self,
        reason: str,
        job_id: str | None = None,
        attempt: int | None = None,
        registration: bool = False,
    ) -> None:
        super().__init__(reason)
        self.job_id = job_id
        self.attempt = attempt
        self.registration = registration
        self.export = False


def _is_int(value: object) -> TypeIs[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _allowed_url(url: object, origin: str | None) -> bool:
    """Locally the emulator's origin; in AWS an HTTPS URL on an amazonaws.com host (S3 or its endpoint)."""
    if not isinstance(url, str) or len(url) > 4096:
        return False
    parts = urlsplit(url)
    if origin is not None:
        return f"{parts.scheme}://{parts.netloc}" == origin
    host = parts.hostname or ""
    return parts.scheme == "https" and host.endswith(".amazonaws.com")


def parse_message(body: str, origin: str | None) -> Job | RegistrationJob | ExportJob:
    """Validates a job message of either kind. `origin` is the emulator's origin locally, None in AWS."""
    try:
        raw = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise InvalidJob("not JSON") from error
    if not isinstance(raw, dict):
        raise InvalidJob("not an object")
    if raw.get("task") == "REGISTRATION":
        return _parse_registration(raw, origin)
    if raw.get("task") == "EXPORT":
        return _parse_export(raw, origin)
    return _parse_derivative(raw, origin)


def parse_job(body: str, origin: str | None) -> Job:
    """Validates a derivative job message."""
    job = parse_message(body, origin)
    if not isinstance(job, Job):
        raise InvalidJob("task", job.job_id, job.attempt, registration=isinstance(job, RegistrationJob))
    return job


def _job_identity(raw: dict[str, Any], registration: bool = False) -> tuple[str, int]:
    job_id = raw.get("jobId")
    attempt = raw.get("attempt")
    try:
        if not isinstance(job_id, str) or str(uuid.UUID(job_id)) != job_id:
            raise ValueError
    except ValueError:
        raise InvalidJob("jobId", registration=registration) from None
    if not _is_int(attempt) or not 1 <= attempt <= 100:
        raise InvalidJob("attempt", registration=registration)
    return job_id, attempt


def _expiry(raw: dict[str, Any], invalid: Callable[[str], InvalidJob]) -> datetime:
    expires = raw.get("expiresAt")
    try:
        if not isinstance(expires, str):
            raise ValueError
        expires_at = datetime.fromisoformat(expires)
        if expires_at.tzinfo is None:
            raise ValueError
    except ValueError:
        raise invalid("expiresAt") from None
    return expires_at


def _source(raw: object, origin: str | None, name: str, invalid: Callable[[str], InvalidJob]) -> Source:
    if not isinstance(raw, dict):
        raise invalid(name)
    if not _allowed_url(raw.get("url"), origin):
        raise invalid(f"{name}.url")
    if raw.get("contentType") not in SOURCE_TYPES:
        raise invalid(f"{name}.contentType")
    size = raw.get("byteSize")
    if not _is_int(size) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise invalid(f"{name}.byteSize")
    sha = raw.get("sha256")
    if not isinstance(sha, str) or _SHA256.match(sha) is None:
        raise invalid(f"{name}.sha256")
    return Source(raw["url"], raw["contentType"], size, sha)


def _parse_registration(raw: dict[str, Any], origin: str | None) -> RegistrationJob:
    job_id, attempt = _job_identity(raw, registration=True)

    def invalid(reason: str) -> InvalidJob:
        return InvalidJob(reason, job_id, attempt, registration=True)

    before = _source(raw.get("before"), origin, "before", invalid)
    after = _source(raw.get("after"), origin, "after", invalid)
    return RegistrationJob(job_id, attempt, before, after, _expiry(raw, invalid))


_HEX_COLOUR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_SHAPE_TYPES: Final = ("FREEHAND", "LINE", "ARROW", "ELLIPSE", "RECTANGLE", "TEXT")
MAX_SHAPES: Final = 500
MAX_EXPORT_EDGE: Final = 4096


def _fraction(value: object, low: float = 0.0, high: float = 1.0) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and low <= value <= high


def _point(value: object) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(_fraction(v) for v in value)


def _shape_valid(shape: object) -> bool:
    """A resolved annotation shape: colours as hex, widths and sizes as fractions of the height."""
    if not isinstance(shape, dict) or shape.get("type") not in _SHAPE_TYPES:
        return False
    if not isinstance(shape.get("color"), str) or _HEX_COLOUR.match(shape["color"]) is None:
        return False
    kind = shape["type"]
    if kind == "TEXT":
        text = shape.get("text")
        return (
            isinstance(text, str) and 1 <= len(text) <= 200 and _point(shape.get("position"))
            and _fraction(shape.get("size"), 0.001, 0.1)
        )  # fmt: skip
    if not _fraction(shape.get("stroke"), 0.0001, 0.05):
        return False
    if kind == "FREEHAND":
        points = shape.get("points")
        return isinstance(points, list) and 2 <= len(points) <= 2000 and all(_point(p) for p in points)
    if kind in ("LINE", "ARROW"):
        return _point(shape.get("from")) and _point(shape.get("to"))
    if kind == "ELLIPSE":
        return (
            _point(shape.get("center"))
            and _fraction(shape.get("radiusX"))
            and _fraction(shape.get("radiusY"))
        )
    size = shape.get("size")
    return (
        _point(shape.get("origin"))
        and isinstance(size, list)
        and len(size) == 2
        and all(_fraction(v) for v in size)
    )


def _transform(value: object) -> dict[str, float] | None:
    if value is None:
        return None
    limits = {
        "scale": (0.25, 4.0),
        "rotationDeg": (-180.0, 180.0),
        "translateX": (-2.0, 2.0),
        "translateY": (-2.0, 2.0),
    }
    if not isinstance(value, dict) or set(value) != set(limits):
        raise ValueError
    for key, (low, high) in limits.items():
        if not _fraction(value[key], low, high):
            raise ValueError
    return {key: float(value[key]) for key in limits}


def _parse_export(raw: dict[str, Any], origin: str | None) -> ExportJob:
    job_id, attempt = _job_identity(raw)

    def invalid(reason: str) -> InvalidJob:
        failure = InvalidJob(reason, job_id, attempt)
        failure.export = True
        return failure

    layout = raw.get("layout")
    if layout not in ("SINGLE", "SIDE_BY_SIDE"):
        raise invalid("layout")
    sources_raw = raw.get("sources")
    expected = 1 if layout == "SINGLE" else 2
    if not isinstance(sources_raw, list) or len(sources_raw) != expected:
        raise invalid("sources")
    sources = tuple(_source(item, origin, "sources", invalid) for item in sources_raw)
    output = raw.get("output")
    if not isinstance(output, dict) or not _allowed_url(output.get("url"), origin):
        raise invalid("output.url")
    edge = output.get("maxEdgePx")
    if not _is_int(edge) or not MIN_EDGE_PX <= edge <= MAX_EXPORT_EDGE:
        raise invalid("output.maxEdgePx")
    headers = output.get("headers", {})
    if not isinstance(headers, dict) or not all(
        isinstance(k, str) and _HEADER_NAME.match(k) and isinstance(v, str) and len(v) <= 1024
        for k, v in headers.items()
    ):
        raise invalid("output.headers")
    shapes = raw.get("shapes", [])
    if layout != "SINGLE" and shapes:
        raise invalid("shapes")
    if not isinstance(shapes, list) or len(shapes) > MAX_SHAPES or not all(_shape_valid(s) for s in shapes):
        raise invalid("shapes")
    try:
        transform = _transform(raw.get("transform"))
    except ValueError:
        raise invalid("transform") from None
    if layout == "SINGLE" and transform is not None:
        raise invalid("transform")
    return ExportJob(
        job_id=job_id,
        attempt=attempt,
        layout=layout,
        sources=sources,
        output=OutputSpec("EXPORT", output["url"], dict(headers), edge),
        shapes=tuple(shapes),
        transform=transform,
        expires_at=_expiry(raw, invalid),
    )


def _parse_derivative(raw: dict[str, Any], origin: str | None) -> Job:
    job_id, attempt = _job_identity(raw)

    def invalid(reason: str) -> InvalidJob:
        return InvalidJob(reason, job_id, attempt)

    source = _source(raw.get("source"), origin, "source", invalid)

    outputs_raw = raw.get("outputs")
    if not isinstance(outputs_raw, list) or not 1 <= len(outputs_raw) <= len(KINDS):
        raise invalid("outputs")
    outputs: list[OutputSpec] = []
    for item in outputs_raw:
        if not isinstance(item, dict) or item.get("kind") not in KINDS:
            raise invalid("outputs.kind")
        if any(o.kind == item["kind"] for o in outputs):
            raise invalid("outputs.kind")
        if not _allowed_url(item.get("url"), origin):
            raise invalid("outputs.url")
        edge = item.get("maxEdgePx")
        if not _is_int(edge) or not MIN_EDGE_PX <= edge <= MAX_EDGE_PX:
            raise invalid("outputs.maxEdgePx")
        if item.get("contentType") != "image/jpeg":
            raise invalid("outputs.contentType")
        headers = item.get("headers", {})
        if (
            not isinstance(headers, dict)
            or len(headers) > 10
            or not all(
                isinstance(k, str) and _HEADER_NAME.match(k) and isinstance(v, str) and len(v) <= 1024
                for k, v in headers.items()
            )
        ):
            raise invalid("outputs.headers")
        outputs.append(OutputSpec(item["kind"], item["url"], dict(headers), edge))

    expires_at = _expiry(raw, invalid)

    return Job(
        job_id=job_id,
        attempt=attempt,
        source_url=source.url,
        source_type=source.content_type,
        source_bytes=source.byte_size,
        source_sha256=source.sha256,
        outputs=tuple(outputs),
        expires_at=expires_at,
    )


def generator() -> dict[str, str]:
    """Recorded on each derivative (PhotoDerivative.generationMetadata).

    The libvips version is the pyvips-binary wheel's, read without loading libvips here.
    """
    try:
        libvips = version("pyvips-binary")
    except PackageNotFoundError:
        libvips = "system"
    return {"name": "aestara-image-processing", "version": f"{__version__}+libvips.{libvips}"[:40]}


def succeeded(job: Job, rendered: list[Rendered], gen: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "image.derivative.completed",
        "jobId": job.job_id,
        "attempt": job.attempt,
        "status": "SUCCEEDED",
        "outputs": [
            {
                "kind": r.kind,
                "sha256": hashlib.sha256(r.data).hexdigest(),
                "byteSize": len(r.data),
                "widthPx": r.width,
                "heightPx": r.height,
            }
            for r in rendered
        ],
        "retryable": False,
        "generator": gen,
    }


def failed(job_id: str, attempt: int, failure: JobFailure, gen: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "image.derivative.failed",
        "jobId": job_id,
        "attempt": attempt,
        "status": "FAILED",
        "outputs": [],
        "errorCode": failure.code,
        "retryable": failure.retryable,
        "generator": gen,
    }


def registration_succeeded(job: RegistrationJob, transform: Transform, gen: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "image.registration.completed",
        "task": "REGISTRATION",
        "jobId": job.job_id,
        "attempt": job.attempt,
        "status": "SUCCEEDED",
        "transform": {
            "scale": transform.scale,
            "rotationDeg": transform.rotation_deg,
            "translateX": transform.translate_x,
            "translateY": transform.translate_y,
        },
        "inliers": transform.inliers,
        "retryable": False,
        "generator": gen,
    }


def registration_failed(
    job_id: str, attempt: int, failure: JobFailure, gen: dict[str, str]
) -> dict[str, Any]:
    return {
        "type": "image.registration.failed",
        "task": "REGISTRATION",
        "jobId": job_id,
        "attempt": attempt,
        "status": "FAILED",
        "errorCode": failure.code,
        "retryable": failure.retryable,
        "generator": gen,
    }


def export_succeeded(job: ExportJob, rendered: Rendered, gen: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "image.export.completed",
        "task": "EXPORT",
        "jobId": job.job_id,
        "attempt": job.attempt,
        "status": "SUCCEEDED",
        "output": {
            "sha256": hashlib.sha256(rendered.data).hexdigest(),
            "byteSize": len(rendered.data),
            "widthPx": rendered.width,
            "heightPx": rendered.height,
        },
        "retryable": False,
        "generator": gen,
    }


def export_failed(job_id: str, attempt: int, failure: JobFailure, gen: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "image.export.failed",
        "task": "EXPORT",
        "jobId": job_id,
        "attempt": attempt,
        "status": "FAILED",
        "errorCode": failure.code,
        "retryable": failure.retryable,
        "generator": gen,
    }
