"""One image job, from message to result (spec §6.7; ADR-0023 K2-06, ADR-0026 K3-13).

A derivative job reads the original through its presigned GET, checks its
size and SHA-256 against the ledger's, renders the derivatives in the sandbox,
writes each through its write-once PUT, and reports what was written. A
registration job reads two display previews the same way and reports the
transform that aligns them; it writes nothing. The whole job has 60 seconds.
Sources are only ever read.
"""

import hashlib
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from . import sandbox, transfer
from .config import JOB_SECONDS, Config
from .contract import (
    ExportJob,
    InvalidJob,
    Job,
    RegistrationJob,
    Rendered,
    Source,
    Transform,
    export_failed,
    export_succeeded,
    failed,
    generator,
    parse_message,
    registration_failed,
    registration_succeeded,
    succeeded,
)
from .errors import JobFailure
from .log import event

logger = logging.getLogger(__name__)

Renderer = Callable[[bytes, str, list[tuple[str, int]], float], list[Rendered]]
Registrar = Callable[[bytes, str, bytes, str, float], Transform]
Exporter = Callable[[dict[str, Any], float], Rendered]


class JobRunner:
    def __init__(
        self,
        config: Config,
        renderer: Renderer = sandbox.render_isolated,
        registrar: Registrar = sandbox.register_isolated,
        exporter: Exporter = sandbox.export_isolated,
    ) -> None:
        self._origin = config.object_origin
        self._render = renderer
        self._register = registrar
        self._export = exporter
        self._generator = generator()

    def run(self, body: str) -> dict[str, Any] | None:
        """The result to report, or None for a message that names no job (left for the dead-letter queue)."""
        started = time.monotonic()
        try:
            job = parse_message(body, self._origin)
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
            report = (
                registration_failed if invalid.registration else export_failed if invalid.export else failed
            )
            return report(invalid.job_id, invalid.attempt, JobFailure("INVALID_JOB"), self._generator)
        result: dict[str, Any]
        if isinstance(job, ExportJob):
            try:
                result = export_succeeded(job, self._export_job(job, started + JOB_SECONDS), self._generator)
            except JobFailure as failure:
                result = export_failed(job.job_id, job.attempt, failure, self._generator)
        elif isinstance(job, RegistrationJob):
            try:
                transform = self._registration(job, started + JOB_SECONDS)
                result = registration_succeeded(job, transform, self._generator)
            except JobFailure as failure:
                result = registration_failed(job.job_id, job.attempt, failure, self._generator)
        else:
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

    @staticmethod
    def _read(source: Source, deadline: float) -> bytes:
        data = transfer.get(source.url, source.byte_size, deadline)
        if len(data) != source.byte_size or hashlib.sha256(data).hexdigest() != source.sha256:
            raise JobFailure("SOURCE_INTEGRITY")
        return data

    def _registration(self, job: RegistrationJob, deadline: float) -> Transform:
        if job.expires_at <= datetime.now(UTC):
            raise JobFailure("JOB_EXPIRED")
        before = self._read(job.before, deadline)
        after = self._read(job.after, deadline)
        return self._register(
            before, job.before.content_type, after, job.after.content_type, deadline - time.monotonic()
        )

    def _export_job(self, job: ExportJob, deadline: float) -> Rendered:
        if job.expires_at <= datetime.now(UTC):
            raise JobFailure("JOB_EXPIRED")
        sources = [(self._read(source, deadline), source.content_type) for source in job.sources]
        rendered = self._export(
            {
                "layout": job.layout,
                "sources": sources,
                "max_edge": job.output.max_edge_px,
                "shapes": list(job.shapes),
                "transform": job.transform,
            },
            deadline - time.monotonic(),
        )
        transfer.put(job.output.url, rendered.data, job.output.headers, deadline)
        return rendered

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
