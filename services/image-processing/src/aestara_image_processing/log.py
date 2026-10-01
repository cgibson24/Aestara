"""Structured JSON logs on stdout (spec §7.6).

Entries carry job IDs, attempts, codes and durations only: never URLs (they
carry signatures), message bodies or exception messages, which can echo either.
"""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

SERVICE = "image-processing"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "service": SERVICE,
            "msg": record.getMessage(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            entry.update(fields)
        if record.exc_info is not None and record.exc_info[0] is not None:
            entry["err"] = {"type": record.exc_info[0].__name__}
        return json.dumps(entry, separators=(",", ":"))


def configure(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # The AWS SDK logs requests, URLs and bodies below WARNING.
    for noisy in ("botocore", "boto3", "urllib3", "s3transfer"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def event(logger: logging.Logger, level: int, name: str, msg: str, **fields: Any) -> None:
    logger.log(level, msg, extra={"fields": {"event": name, **fields}})
