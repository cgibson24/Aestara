"""The ways a job can fail, as reported to the api worker.

A retryable failure gets a new attempt with fresh URLs (after 1, 5 and 30
minutes, ADR-0023 K2-06); any other fails the job at once. Derivative and
registration jobs share the codes. Codes are at most
60 characters (AIJob.errorCode) and never carry content from the job.
"""

from typing import Final

# Codes, with whether a new attempt could succeed.
FAILURES: Final[dict[str, bool]] = {
    "INVALID_JOB": False,
    "JOB_EXPIRED": True,
    "JOB_TIMEOUT": True,
    "SOURCE_UNREADABLE": True,
    "SOURCE_TOO_LARGE": False,
    "SOURCE_INTEGRITY": False,
    "UNSUPPORTED_FORMAT": False,
    "DECODE_FAILED": False,
    "PIXEL_LIMIT_EXCEEDED": False,
    "METADATA_NOT_STRIPPED": False,
    "RENDER_TIMEOUT": True,
    "RENDER_CRASHED": True,
    "OUTPUT_UPLOAD_FAILED": True,
    # Registration (ADR-0026 K3-13): the images do not align reliably; trying again cannot help.
    "NO_RELIABLE_ALIGNMENT": False,
}


class JobFailure(Exception):
    """A job outcome other than success. The message is the code alone."""

    def __init__(self, code: str) -> None:
        if code not in FAILURES:
            raise ValueError(f"unknown failure code {code}")
        super().__init__(code)
        self.code = code
        self.retryable = FAILURES[code]
