"""The container image as deployed: non-root, read-only root filesystem, no capabilities (ADR-0023 K2-01).

It renders a derivative job and runs a registration job (ADR-0026 K3-13).

Runs when IMAGE_UNDER_TEST names a built image (CI builds one); it needs Docker.
"""

import os
import subprocess
import time
import uuid

import pytest
from support import PLANTED_TEXT, Emulator, jpeg_with_metadata, markers
from test_registration import jpeg, moved, registration_job, texture

IMAGE = os.environ.get("IMAGE_UNDER_TEST")

pytestmark = pytest.mark.skipif(IMAGE is None, reason="IMAGE_UNDER_TEST is not set")


def docker(*args: str) -> subprocess.CompletedProcess[str]:
    # Docker from PATH, with arguments this test builds.
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=False, timeout=120)  # noqa: S603, S607


def test_the_image_renders_a_job_as_a_locked_down_container(emulator: Emulator) -> None:
    assert IMAGE is not None
    original = jpeg_with_metadata(2400, 1800)
    job = emulator.job(emulator.put_source(original), original)
    emulator.send(job)
    name = f"aestara-ip-test-{uuid.uuid4().hex[:8]}"
    started = docker(
        "run", "--detach", "--name", name, "--network", "host",
        # The container's own /tmp, a tmpfs: the only path it writes.
        "--read-only", "--tmpfs", "/tmp",  # noqa: S108
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--env", "APP_ENV=test", "--env", f"AWS_ENDPOINT_URL={emulator.endpoint}",
        "--env", f"IMAGE_JOBS_QUEUE_URL={emulator.jobs_queue}",
        "--env", f"IMAGE_RESULTS_QUEUE_URL={emulator.results_queue}",
        IMAGE,
    )  # fmt: skip
    assert started.returncode == 0, started.stderr
    try:
        results = []
        for _ in range(60):
            results = emulator.results()
            if results:
                break
            time.sleep(1)
        assert [r["status"] for r in results] == ["SUCCEEDED"]
        # Registration loads OpenCV in the sandbox child of the same locked-down container.
        before = texture()
        emulator.send(registration_job(emulator, jpeg(before), jpeg(moved(before, 1.0, 3.0, (10.0, 5.0)))))
        registered = []
        for _ in range(60):
            registered = emulator.results()
            if registered:
                break
            time.sleep(1)
        assert [(r["type"], r["status"]) for r in registered] == [
            ("image.registration.completed", "SUCCEEDED")
        ]
        for spec in job["outputs"]:
            written = emulator.read(spec["key"])
            assert PLANTED_TEXT not in written
            assert not [m for m in markers(written) if 0xE0 <= m <= 0xEF or m == 0xFE]
        assert docker("exec", name, "id", "-u").stdout.strip() == "10001"
        assert (
            docker("exec", name, "python", "-m", "aestara_image_processing", "--healthcheck").returncode == 0
        )
        assert docker("exec", name, "touch", "/app/x").returncode != 0
        logs = docker("logs", name).stdout
        assert "image_job_finished" in logs
        assert "http" not in logs
    finally:
        docker("rm", "--force", name)
