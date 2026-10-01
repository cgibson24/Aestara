"""The job contract and the configuration rules."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from aestara_image_processing.config import ConfigError, load_config
from aestara_image_processing.contract import InvalidJob, parse_job
from aestara_image_processing.errors import FAILURES, JobFailure

ORIGIN = "http://127.0.0.1:4566"


def message(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "source": {
            "url": f"{ORIGIN}/media/CLINICAL_ORIGINAL/a?X-Amz-Signature=s",
            "contentType": "image/jpeg",
            "byteSize": 1000,
            "sha256": "a" * 64,
        },
        "outputs": [
            {
                "kind": "THUMBNAIL",
                "url": f"{ORIGIN}/media/CLINICAL_DERIVATIVE/b",
                "headers": {"content-type": "image/jpeg", "if-none-match": "*"},
                "maxEdgePx": 400,
                "contentType": "image/jpeg",
            },
            {
                "kind": "DISPLAY_PREVIEW",
                "url": f"{ORIGIN}/media/CLINICAL_DERIVATIVE/c",
                "headers": {"content-type": "image/jpeg", "if-none-match": "*"},
                "maxEdgePx": 2048,
                "contentType": "image/jpeg",
            },
        ],
        "expiresAt": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
    }
    base.update(changes)
    return base


def test_parses_the_message_the_worker_sends() -> None:
    raw = message()
    job = parse_job(json.dumps(raw), ORIGIN)
    assert (job.job_id, job.attempt, job.source_type, job.source_bytes) == (
        raw["jobId"],
        1,
        "image/jpeg",
        1000,
    )
    assert [(o.kind, o.max_edge_px) for o in job.outputs] == [("THUMBNAIL", 400), ("DISPLAY_PREVIEW", 2048)]


@pytest.mark.parametrize(
    "change",
    [
        {"source": {**message()["source"], "url": "http://elsewhere:4566/media/a"}},
        {"source": {**message()["source"], "contentType": "image/heic"}},
        {"source": {**message()["source"], "byteSize": 50 * 1024 * 1024 + 1}},
        {"source": {**message()["source"], "byteSize": True}},
        {"source": {**message()["source"], "sha256": "A" * 64}},
        {"outputs": []},
        {"outputs": [message()["outputs"][0], message()["outputs"][0]]},
        {"outputs": [{**message()["outputs"][0], "kind": "ANNOTATED_EXPORT"}]},
        {"outputs": [{**message()["outputs"][0], "maxEdgePx": 10_000}]},
        {"outputs": [{**message()["outputs"][0], "contentType": "image/png"}]},
        {"outputs": [{**message()["outputs"][0], "headers": {"bad header": "x"}}]},
        {"expiresAt": "2026-10-01T10:00:00"},
    ],
)
def test_refuses_an_invalid_job_and_names_it(change: dict[str, Any]) -> None:
    raw = message(**change)
    with pytest.raises(InvalidJob) as refused:
        parse_job(json.dumps(raw), ORIGIN)
    assert (refused.value.job_id, refused.value.attempt) == (raw["jobId"], 1)


@pytest.mark.parametrize("body", ["{", "[]", json.dumps(message(jobId="x")), json.dumps(message(attempt=0))])
def test_a_message_without_a_job_identity_names_nothing(body: str) -> None:
    with pytest.raises(InvalidJob) as refused:
        parse_job(body, ORIGIN)
    assert refused.value.job_id is None


def test_in_aws_only_https_amazonaws_urls_are_accepted() -> None:
    aws = "https://media.s3.us-east-1.amazonaws.com"
    raw = message()
    raw["source"]["url"] = f"{aws}/CLINICAL_ORIGINAL/a"
    for o in raw["outputs"]:
        o["url"] = f"{aws}/CLINICAL_DERIVATIVE/b"
    assert parse_job(json.dumps(raw), None).source_url.startswith(aws)
    for bad in ("http://media.s3.us-east-1.amazonaws.com/a", "https://amazonaws.com.evil.example/a"):
        raw["source"]["url"] = bad
        with pytest.raises(InvalidJob):
            parse_job(json.dumps(raw), None)


def test_failure_codes_fit_the_job_record() -> None:
    assert all(len(code) <= 60 for code in FAILURES)
    with pytest.raises(ValueError, match="unknown"):
        JobFailure("SOMETHING_ELSE")


QUEUES = {
    "IMAGE_JOBS_QUEUE_URL": "https://sqs.us-east-1.amazonaws.com/1/jobs",
    "IMAGE_RESULTS_QUEUE_URL": "https://sqs.us-east-1.amazonaws.com/1/results",
}


def test_configuration_rules() -> None:
    config = load_config({**QUEUES, "APP_ENV": "production", "AWS_REGION": "us-west-2"})
    assert (config.region, config.endpoint_url, config.object_origin) == ("us-west-2", None, None)
    local = load_config({**QUEUES, "AWS_ENDPOINT_URL": "http://localhost:4566/"})
    assert local.object_origin == "http://localhost:4566"
    with pytest.raises(ConfigError, match="AWS_ENDPOINT_URL"):
        load_config({**QUEUES, "APP_ENV": "production", "AWS_ENDPOINT_URL": "http://localhost:4566"})
    with pytest.raises(ConfigError, match="HTTPS"):
        load_config({**QUEUES, "APP_ENV": "production", "IMAGE_JOBS_QUEUE_URL": "http://sqs/1/jobs"})
    with pytest.raises(ConfigError, match="IMAGE_RESULTS_QUEUE_URL"):
        load_config({"IMAGE_JOBS_QUEUE_URL": QUEUES["IMAGE_JOBS_QUEUE_URL"]})
    with pytest.raises(ConfigError, match="APP_ENV"):
        load_config({**QUEUES, "APP_ENV": "staging"})
