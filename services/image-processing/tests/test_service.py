"""The consumer end to end against the emulated S3 and SQS: jobs in, derivatives written, results out."""

import hashlib
import json
import logging
from datetime import timedelta

import pytest
import pyvips
from support import PLANTED_TEXT, Emulator, gradient, jpeg_with_metadata, markers

from aestara_image_processing import sandbox
from aestara_image_processing.config import Config, load_config
from aestara_image_processing.consumer import Consumer, heartbeat_fresh, sqs_client
from aestara_image_processing.errors import JobFailure
from aestara_image_processing.log import JsonFormatter
from aestara_image_processing.service import JobRunner


def config_for(emulator: Emulator, tmp_path: object) -> Config:
    return load_config(
        {
            "APP_ENV": "test",
            "AWS_ENDPOINT_URL": emulator.endpoint,
            "IMAGE_JOBS_QUEUE_URL": emulator.jobs_queue,
            "IMAGE_RESULTS_QUEUE_URL": emulator.results_queue,
            "HEARTBEAT_FILE": f"{tmp_path}/heartbeat",
        }
    )


@pytest.fixture
def consumer(emulator: Emulator, tmp_path: object) -> Consumer:
    config = config_for(emulator, tmp_path)
    return Consumer(config, JobRunner(config), sqs_client(config))


def test_a_job_writes_both_derivatives_and_reports_them(emulator: Emulator, consumer: Consumer) -> None:
    original = jpeg_with_metadata()
    key = emulator.put_source(original)
    job = emulator.job(key, original)
    emulator.send(job)

    assert consumer.poll_once(wait_seconds=1) == 1
    (result,) = emulator.results()
    assert result["type"] == "image.derivative.completed"
    assert (result["jobId"], result["attempt"], result["status"]) == (job["jobId"], 1, "SUCCEEDED")
    assert result["generator"]["name"] == "aestara-image-processing"
    assert "libvips." in result["generator"]["version"]
    reported = {o["kind"]: o for o in result["outputs"]}
    assert {k: (o["widthPx"], o["heightPx"]) for k, o in reported.items()} == {
        "THUMBNAIL": (300, 400),
        "DISPLAY_PREVIEW": (1536, 2048),
    }
    for spec in job["outputs"]:
        written = emulator.read(spec["key"])
        assert reported[spec["kind"]]["sha256"] == hashlib.sha256(written).hexdigest()
        assert reported[spec["kind"]]["byteSize"] == len(written)
        assert PLANTED_TEXT not in written
        assert not [m for m in markers(written) if 0xE0 <= m <= 0xEF or m == 0xFE]
        assert pyvips.Image.jpegload_buffer(written).width == reported[spec["kind"]]["widthPx"]
    # The original is untouched, and the results carry no URL.
    assert emulator.read(key) == original
    assert "http" not in json.dumps(result)
    # The job is consumed.
    assert consumer.poll_once(wait_seconds=0) == 0


def test_a_repeated_delivery_finds_its_outputs_written_and_reports_the_same(
    emulator: Emulator, consumer: Consumer
) -> None:
    original = gradient(1600, 1200).jpegsave_buffer(Q=90)
    key = emulator.put_source(original)
    job = emulator.job(key, original)
    emulator.send(job)
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    consumer.poll_once(wait_seconds=1)
    first, second = emulator.results()
    assert first["status"] == second["status"] == "SUCCEEDED"
    # The second run met If-None-Match: * and wrote nothing; rendering is deterministic.
    assert first["outputs"] == second["outputs"]


def test_a_source_that_does_not_match_the_ledger_fails_without_writing(
    emulator: Emulator, consumer: Consumer
) -> None:
    original = gradient(800, 600).jpegsave_buffer()
    key = emulator.put_source(original)
    job = emulator.job(key, original, sha256="0" * 64)
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert result["type"] == "image.derivative.failed"
    assert (result["status"], result["errorCode"], result["retryable"]) == (
        "FAILED",
        "SOURCE_INTEGRITY",
        False,
    )
    assert result["outputs"] == []
    for spec in job["outputs"]:
        with pytest.raises(emulator.s3.exceptions.NoSuchKey):
            emulator.read(spec["key"])


def test_an_unreadable_source_is_retryable(emulator: Emulator, consumer: Consumer) -> None:
    original = gradient(800, 600).jpegsave_buffer()
    job = emulator.job("CLINICAL_ORIGINAL/never-uploaded", original)
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["errorCode"], result["retryable"]) == ("SOURCE_UNREADABLE", True)


def test_an_expired_job_is_retryable_and_reads_nothing(emulator: Emulator, consumer: Consumer) -> None:
    original = gradient(800, 600).jpegsave_buffer()
    key = emulator.put_source(original)
    emulator.send(emulator.job(key, original, expires_in=timedelta(seconds=-1)))
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["errorCode"], result["retryable"]) == ("JOB_EXPIRED", True)


def test_a_file_that_cannot_be_decoded_fails_at_once(emulator: Emulator, consumer: Consumer) -> None:
    broken = b"\xff\xd8\xff\xdb" + b"\x13" * 4096
    key = emulator.put_source(broken)
    emulator.send(emulator.job(key, broken))
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["errorCode"], result["retryable"]) == ("DECODE_FAILED", False)


def test_a_url_outside_the_object_store_fails_the_job(emulator: Emulator, consumer: Consumer) -> None:
    original = gradient(800, 600).jpegsave_buffer()
    key = emulator.put_source(original)
    job = emulator.job(key, original)
    job["outputs"][0]["url"] = "http://169.254.169.254/latest/meta-data/"
    emulator.send(job)
    consumer.poll_once(wait_seconds=1)
    (result,) = emulator.results()
    assert (result["jobId"], result["errorCode"], result["retryable"]) == (job["jobId"], "INVALID_JOB", False)


def test_a_message_that_names_no_job_is_left_for_the_dead_letter_queue(
    emulator: Emulator, consumer: Consumer
) -> None:
    emulator.send("{not json")
    assert consumer.poll_once(wait_seconds=1) == 1
    assert emulator.results() == []
    attributes = emulator.sqs.get_queue_attributes(
        QueueUrl=emulator.jobs_queue, AttributeNames=["ApproximateNumberOfMessagesNotVisible"]
    )["Attributes"]
    assert attributes["ApproximateNumberOfMessagesNotVisible"] == "1"


def test_logs_carry_no_url_signature_or_content(
    emulator: Emulator, consumer: Consumer, caplog: pytest.LogCaptureFixture
) -> None:
    original = jpeg_with_metadata(1200, 900)
    key = emulator.put_source(original)
    emulator.send(emulator.job(key, original))
    emulator.send(emulator.job("CLINICAL_ORIGINAL/missing", original))
    with caplog.at_level(logging.DEBUG):
        consumer.poll_once(wait_seconds=1)
        consumer.poll_once(wait_seconds=1)
    formatter = JsonFormatter()
    lines = [formatter.format(r) for r in caplog.records if r.name.startswith("aestara_image_processing")]
    assert len(lines) == 2
    assert all(json.loads(line)["event"] == "image_job_finished" for line in lines)
    for line in lines:
        assert "http" not in line
        assert "Signature" not in line
        assert "CLINICAL_ORIGINAL" not in line


def test_the_sandbox_kills_a_render_that_runs_out_of_time() -> None:
    source = gradient(4000, 3000).jpegsave_buffer(Q=95)
    with pytest.raises(JobFailure) as late:
        sandbox.render_isolated(source, "image/jpeg", [("DISPLAY_PREVIEW", 2048)], timeout=0.01)
    assert (late.value.code, late.value.retryable) == ("RENDER_TIMEOUT", True)
    with pytest.raises(JobFailure, match="JOB_TIMEOUT"):
        sandbox.render_isolated(source, "image/jpeg", [("DISPLAY_PREVIEW", 2048)], timeout=0)


def test_the_sandbox_renders_and_reports_failures_from_the_child() -> None:
    source = gradient(1000, 750).jpegsave_buffer()
    (preview,) = sandbox.render_isolated(source, "image/jpeg", [("DISPLAY_PREVIEW", 2048)], timeout=30)
    assert (preview.width, preview.height) == (1000, 750)
    with pytest.raises(JobFailure, match="UNSUPPORTED_FORMAT"):
        sandbox.render_isolated(b"GIF89a....", "image/png", [("THUMBNAIL", 400)], timeout=30)


def test_the_heartbeat_marks_the_consumer_alive(consumer: Consumer, tmp_path: object) -> None:
    path = f"{tmp_path}/heartbeat"
    assert not heartbeat_fresh(path, 90)
    consumer.heartbeat()
    assert heartbeat_fresh(path, 90)
    assert not heartbeat_fresh(path, 90, now=10**12)
