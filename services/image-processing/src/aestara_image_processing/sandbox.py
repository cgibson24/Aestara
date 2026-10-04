"""Rendering and registration in a disposable child process (ADR-0023 K2-01, ADR-0026 K3-13).

Each job's decoding runs in a fresh process with libvips hardened and a memory
limit; the parent kills it when the job's time runs out. Registration's
feature matching runs in the same kind of child. A decoder fault,
an exhausted memory limit or a hang ends that process only, never the
consumer, and nothing from one job's decoding survives into the next.
"""

import multiprocessing
import resource
import sys
from collections.abc import Sequence
from multiprocessing.connection import Connection
from typing import Any, Final

from .contract import Rendered, Transform
from .errors import JobFailure

# Heap and mappings a child may use: ample for 100 megapixels decoded in strips.
MEMORY_LIMIT_BYTES: Final = 3 * 1024 * 1024 * 1024

# The limit is applied where the service runs, on Linux. macOS runs it only for local
# development and CI's UI tests, and its allocator reserves more address space at
# start-up than the limit allows, so every render there would fail; there the time
# limit alone bounds a job.
LIMIT_MEMORY: Final = sys.platform.startswith("linux")

# A fresh interpreter forked from a clean server process, never from the consumer
# (which holds AWS clients and threads).
_CONTEXT: Final = multiprocessing.get_context("forkserver")
_CONTEXT.set_forkserver_preload([])


def _child(conn: Connection, data: bytes, content_type: str, specs: Sequence[tuple[str, int]]) -> None:
    if LIMIT_MEMORY:
        resource.setrlimit(resource.RLIMIT_DATA, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    from . import imaging  # libvips is loaded in the child only

    imaging.harden()
    try:
        rendered = imaging.render(data, content_type, specs)
        conn.send(("ok", [(r.kind, r.data, r.width, r.height) for r in rendered]))
    except JobFailure as failure:
        conn.send(("failed", failure.code))
    finally:
        conn.close()


def _register_child(conn: Connection, before: bytes, before_type: str, after: bytes, after_type: str) -> None:
    if LIMIT_MEMORY:
        resource.setrlimit(resource.RLIMIT_DATA, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    from . import imaging, registration  # libvips and OpenCV are loaded in the child only

    imaging.harden()
    try:
        conn.send(("ok", registration.register(before, before_type, after, after_type)))
    except JobFailure as failure:
        conn.send(("failed", failure.code))
    finally:
        conn.close()


def _run_child(target: Any, args: tuple[Any, ...], timeout: float, timeout_code: str) -> Any:
    """Runs `target` in a child; its answer, or JobFailure on a failure, a crash or the time limit."""
    if timeout <= 0:
        raise JobFailure("JOB_TIMEOUT")
    receiver, sender = _CONTEXT.Pipe(duplex=False)
    process = _CONTEXT.Process(target=target, args=(sender, *args), daemon=True)
    process.start()
    sender.close()
    try:
        if not receiver.poll(timeout):
            raise JobFailure(timeout_code)
        try:
            message = receiver.recv()
        except EOFError:
            # The child ended without an answer: killed for memory, or a decoder fault.
            raise JobFailure("RENDER_CRASHED") from None
    finally:
        if process.is_alive():
            process.kill()
        process.join(5)
        receiver.close()
    if message[0] == "failed":
        raise JobFailure(message[1])
    return message[1]


def register_isolated(
    before: bytes, before_type: str, after: bytes, after_type: str, timeout: float
) -> Transform:
    """Estimates the registration transform in a child process."""
    result: Transform = _run_child(
        _register_child, (before, before_type, after, after_type), timeout, "RENDER_TIMEOUT"
    )
    return result


def render_isolated(
    data: bytes, content_type: str, specs: Sequence[tuple[str, int]], timeout: float
) -> list[Rendered]:
    """Renders in a child process; raises JobFailure on a failure, a crash or the time limit."""
    rendered = _run_child(_child, (data, content_type, list(specs)), timeout, "RENDER_TIMEOUT")
    return [Rendered(kind=k, data=d, width=w, height=h) for k, d, w, h in rendered]
