"""The image job contract with the api worker (spec §6.7; ADR-0023 K2-06).

The worker sends `image.derivative.requested` with opaque presigned URLs and
output parameters (services/api/src/worker/derivatives.ts, ImageJobMessage);
this service answers `image.derivative.completed` or `image.derivative.failed`
in the shape of ImageJobResult there. Neither carries PHI.
"""

import hashlib
import json
import re
import uuid
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


class InvalidJob(ValueError):
    """A message that is not a valid job. It names the job when it can, so the job can be failed."""

    def __init__(self, reason: str, job_id: str | None = None, attempt: int | None = None) -> None:
        super().__init__(reason)
        self.job_id = job_id
        self.attempt = attempt


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


def parse_job(body: str, origin: str | None) -> Job:
    """Validates a job message. `origin` is the emulator's origin locally, None in AWS."""
    try:
        raw = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise InvalidJob("not JSON") from error
    if not isinstance(raw, dict):
        raise InvalidJob("not an object")
    job_id = raw.get("jobId")
    attempt = raw.get("attempt")
    try:
        if not isinstance(job_id, str) or str(uuid.UUID(job_id)) != job_id:
            raise ValueError
    except ValueError:
        raise InvalidJob("jobId") from None
    if not _is_int(attempt) or not 1 <= attempt <= 100:
        raise InvalidJob("attempt")

    def invalid(reason: str) -> InvalidJob:
        return InvalidJob(reason, job_id, attempt)

    source = raw.get("source")
    if not isinstance(source, dict):
        raise invalid("source")
    if not _allowed_url(source.get("url"), origin):
        raise invalid("source.url")
    if source.get("contentType") not in SOURCE_TYPES:
        raise invalid("source.contentType")
    size = source.get("byteSize")
    if not _is_int(size) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise invalid("source.byteSize")
    sha = source.get("sha256")
    if not isinstance(sha, str) or _SHA256.match(sha) is None:
        raise invalid("source.sha256")

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

    expires = raw.get("expiresAt")
    try:
        if not isinstance(expires, str):
            raise ValueError
        expires_at = datetime.fromisoformat(expires)
        if expires_at.tzinfo is None:
            raise ValueError
    except ValueError:
        raise invalid("expiresAt") from None

    return Job(
        job_id=job_id,
        attempt=attempt,
        source_url=source["url"],
        source_type=source["contentType"],
        source_bytes=size,
        source_sha256=sha,
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
