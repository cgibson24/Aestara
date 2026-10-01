"""The SQS consumer: image-jobs in, image-results out (ADR-0023 K2-01, K2-07).

One job at a time; capacity comes from running more tasks. A message is
deleted only after its result is sent, so a crash means a redelivery, and the
write-once outputs make a redelivery harmless. A message that names no job is
left alone and reaches the dead-letter queue after five receives.
"""

import json
import logging
import signal
import time
from pathlib import Path
from types import FrameType
from typing import TYPE_CHECKING, Any

import boto3

from .config import VISIBILITY_SECONDS, Config
from .log import event
from .service import JobRunner

if TYPE_CHECKING:
    from mypy_boto3_sqs import SQSClient

logger = logging.getLogger(__name__)


def sqs_client(config: Config) -> "SQSClient":
    options: dict[str, Any] = {"region_name": config.region}
    if config.endpoint_url is not None:
        options |= {
            "endpoint_url": config.endpoint_url,
            "aws_access_key_id": "local",
            "aws_secret_access_key": "local",
        }
    return boto3.client("sqs", **options)


class Consumer:
    def __init__(self, config: Config, runner: JobRunner, sqs: "SQSClient | None" = None) -> None:
        self._config = config
        self._runner = runner
        self._sqs = sqs if sqs is not None else sqs_client(config)
        self._stopping = False

    def stop(self, *_: object) -> None:
        self._stopping = True

    def poll_once(self, wait_seconds: int = 20) -> int:
        """Receives at most one job and handles it; returns how many were handled."""
        response = self._sqs.receive_message(
            QueueUrl=self._config.jobs_queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=wait_seconds,
            VisibilityTimeout=VISIBILITY_SECONDS,
        )
        messages = response.get("Messages", [])
        for message in messages:
            result = self._runner.run(message.get("Body", ""))
            if result is None:
                continue
            self._sqs.send_message(QueueUrl=self._config.results_queue_url, MessageBody=json.dumps(result))
            self._sqs.delete_message(
                QueueUrl=self._config.jobs_queue_url, ReceiptHandle=message["ReceiptHandle"]
            )
        return len(messages)

    def heartbeat(self) -> None:
        Path(self._config.heartbeat_file).write_text(str(time.time()))

    def run_forever(self) -> None:
        def on_signal(signum: int, frame: FrameType | None) -> None:
            self.stop()

        signal.signal(signal.SIGTERM, on_signal)
        signal.signal(signal.SIGINT, on_signal)
        event(logger, logging.INFO, "consumer_started", "image-processing is consuming jobs")
        backoff = 1.0
        while not self._stopping:
            self.heartbeat()
            try:
                self.poll_once()
                backoff = 1.0
            except Exception:
                # Queue or network trouble: wait and try again; the type alone is logged.
                logger.exception("queue poll failed", extra={"fields": {"event": "poll_failed"}})
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
        event(logger, logging.INFO, "consumer_stopped", "image-processing stopped")


def heartbeat_fresh(path: str, stale_after: float, now: float | None = None) -> bool:
    try:
        last = float(Path(path).read_text())
    except (OSError, ValueError):
        return False
    return (time.time() if now is None else now) - last < stale_after
