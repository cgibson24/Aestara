"""Fixtures: an in-process AWS emulator (moto), so the suite needs no Docker."""

import uuid
from collections.abc import Iterator

import boto3
import pytest
from moto.server import ThreadedMotoServer
from support import Emulator


@pytest.fixture(scope="session")
def moto_endpoint() -> Iterator[str]:
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    host, port = server.get_host_and_port()
    yield f"http://{host}:{port}"
    server.stop()


@pytest.fixture
def emulator(moto_endpoint: str) -> Emulator:
    session = boto3.Session(aws_access_key_id="local", aws_secret_access_key="local", region_name="us-east-1")
    s3 = session.client("s3", endpoint_url=moto_endpoint)
    sqs = session.client("sqs", endpoint_url=moto_endpoint)
    suffix = uuid.uuid4().hex[:12]
    bucket = f"test-{suffix}-clinical-media"
    s3.create_bucket(Bucket=bucket)
    jobs = sqs.create_queue(QueueName=f"test-{suffix}-image-jobs")["QueueUrl"]
    results = sqs.create_queue(QueueName=f"test-{suffix}-image-results")["QueueUrl"]
    return Emulator(moto_endpoint, bucket, jobs, results, s3, sqs)
