"""Object transfers through presigned URLs (spec §6.7, §7.2).

No redirects are followed, the source is read up to its declared size and no
further, and every transfer stops at the job's deadline. URLs carry signatures,
so they are never logged; errors keep their type only.
"""

import http.client
import time
import urllib.error
import urllib.request
from typing import Literal

from .errors import JobFailure

_CHUNK = 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _remaining(deadline: float, code: str) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise JobFailure(code)
    return left


def get(url: str, max_bytes: int, deadline: float) -> bytes:
    """Reads the source; raises JobFailure when it is unreadable, larger than declared or late."""
    request = urllib.request.Request(url, method="GET")  # noqa: S310 - URL checked by parse_job
    try:
        with _OPENER.open(request, timeout=_remaining(deadline, "JOB_TIMEOUT")) as response:
            if response.status != 200:
                raise JobFailure("SOURCE_UNREADABLE")
            length = response.headers.get("Content-Length")
            if length is not None and length.isdigit() and int(length) > max_bytes:
                raise JobFailure("SOURCE_TOO_LARGE")
            chunks: list[bytes] = []
            total = 0
            while True:
                _remaining(deadline, "JOB_TIMEOUT")
                chunk = response.read(min(_CHUNK, max_bytes + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    raise JobFailure("SOURCE_TOO_LARGE")
            return b"".join(chunks)
    except JobFailure:
        raise
    except (urllib.error.URLError, http.client.HTTPException, OSError):
        # HTTPError (a refusal or an expired URL) is a URLError; TimeoutError is an OSError.
        raise JobFailure("SOURCE_UNREADABLE") from None


def put(url: str, data: bytes, headers: dict[str, str], deadline: float) -> Literal["written", "exists"]:
    """Writes one output. The URL is write-once: an existing object answers 412 and is left as it is."""
    request = urllib.request.Request(url, data=data, method="PUT", headers=headers)  # noqa: S310
    try:
        with _OPENER.open(request, timeout=_remaining(deadline, "JOB_TIMEOUT")) as response:
            if response.status != 200:
                raise JobFailure("OUTPUT_UPLOAD_FAILED")
            return "written"
    except urllib.error.HTTPError as error:
        # A repeated delivery of this attempt already wrote it; the worker verifies the bytes.
        if error.code == 412:
            return "exists"
        raise JobFailure("OUTPUT_UPLOAD_FAILED") from None
    except JobFailure:
        raise
    except (urllib.error.URLError, http.client.HTTPException, OSError):
        raise JobFailure("OUTPUT_UPLOAD_FAILED") from None
