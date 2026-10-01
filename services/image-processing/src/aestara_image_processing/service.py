"""One image job, from message to result (spec §6.7; ADR-0023 K2-06).

Read the original through its presigned GET, check its size and SHA-256
against the ledger's, render the derivatives in the sandbox, write each
through its write-once PUT, and report what was written. The whole job has 60
seconds. The original is only ever read.
"""

import hashlib
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from . import sandbox, transfer
from .config import JOB_SECONDS, Config
from .contract import InvalidJob, Job, Rendered, failed, generator, parse_job, succeeded
from .errors import JobFailure
from .log import event

logger = logging.getLogger(__name__)

Renderer = Callable[[bytes, str, list[tuple[str, int]], float], list[Rendered]]


class JobRunner:
    def __init__(self, config: Config, renderer: Renderer = sandbox.render_isolated) -> None:
        self._origin = config.object_origin
        self._render = renderer
        self._generator = generator()

    def run(self, body: str) -> dict[str, Any] | None:
        """The result to report, or None for a message that names no job (left for the dead-letter queue)."""
        started = time.monotonic()
        try:
            job = parse_job(body, self._origin)
        except InvalidJob as invalid:
            event(
                logger,
                logging.WARNING,
                "image_job_invalid",
                "an image job did not match its contract",
                field=str(invalid),
                jobId=invalid.job_id,
                attempt=invalid.attempt,
            )
            if invalid.job_id is None or invalid.attempt is None:
                return None
            return failed(invalid.job_id, invalid.attempt, JobFailure("INVALID_JOB"), self._generator)
        try:
            result = succeeded(job, self._process(job, started + JOB_SECONDS), self._generator)
        except JobFailure as failure:
            result = failed(job.job_id, job.attempt, failure, self._generator)
        event(
            logger,
            logging.INFO,
            "image_job_finished",
            "image job finished",
            jobId=job.job_id,
            attempt=job.attempt,
            status=result["status"],
            errorCode=result.get("errorCode"),
            durationMs=round((time.monotonic() - started) * 1000),
        )
        return result

    def _process(self, job: Job, deadline: float) -> list[Rendered]:
        if job.expires_at <= datetime.now(UTC):
            raise JobFailure("JOB_EXPIRED")
        source = transfer.get(job.source_url, job.source_bytes, deadline)
        if len(source) != job.source_bytes or hashlib.sha256(source).hexdigest() != job.source_sha256:
            raise JobFailure("SOURCE_INTEGRITY")
        specs = [(o.kind, o.max_edge_px) for o in job.outputs]
        rendered = self._render(source, job.source_type, specs, deadline - time.monotonic())
        for spec, output in zip(job.outputs, rendered, strict=True):
            transfer.put(spec.url, output.data, spec.headers, deadline)
        return rendered
