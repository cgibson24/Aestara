# image-processing

Renders each accepted photo's `THUMBNAIL` (long edge 400 px) and `DISPLAY_PREVIEW` (long edge 2048 px) as JPEG, in sRGB, with the orientation applied and all metadata removed. Python 3.13 with pyvips (libvips 8.18 from the `pyvips-binary` wheel), managed with uv. Decisions: ADR-0023 K2-01 and K2-06, ADR-0024. Before/after registration joins in Layer 3.

## What it does

The api worker sends `image.derivative.requested` to the `image-jobs` queue (`services/api/src/worker/derivatives.ts`). The message holds a presigned `GET` for the original, the ledger's size and SHA-256, a presigned write-once `PUT` per output, and an expiry. All URLs are valid for at most 10 minutes. For each job the service does this:

1. Downloads the original. Its size and SHA-256 must match the ledger's.
2. Checks the first bytes against the declared type (JPEG or PNG only).
3. Renders the outputs in a fresh child process with every other libvips loader blocked. An image over 100 megapixels is refused from its header, before any pixel is decoded.
4. Writes each output through its `PUT`. The write is write-once: a `412` means an earlier delivery already wrote it.
5. Sends `image.derivative.completed` or `image.derivative.failed` to `image-results`. The worker then verifies the outputs and records the derivatives.

The whole job has 60 seconds. The service has **no database access** and sees **no PHI**: the URLs and the object keys inside them are opaque. It never changes an original.

| Module | Role |
|---|---|
| `contract.py` | Job validation and result shapes (spec §6.7) |
| `imaging.py` | libvips hardening, rendering, the metadata check |
| `sandbox.py` | The child process: time limit, memory limit, kill |
| `transfer.py` | Presigned `GET`/`PUT`: no redirects, size limits, deadlines |
| `service.py` | One job, from message to result |
| `consumer.py` | The SQS loop, signals, heartbeat |
| `errors.py` | Failure codes and whether a retry can help |

### Failure codes

A retried code gets a new attempt with fresh URLs, after 1, 5 and 30 minutes. Any other code fails the job at once.

| Code | Retried | Meaning |
|---|---|---|
| `JOB_EXPIRED` | yes | The job's URLs had expired before it started |
| `JOB_TIMEOUT` | yes | The 60 seconds ran out during a transfer |
| `SOURCE_UNREADABLE` | yes | The original could not be fetched |
| `RENDER_TIMEOUT` | yes | Rendering ran out of time; the child process was killed |
| `RENDER_CRASHED` | yes | The child process ended without an answer (for example, the memory limit) |
| `OUTPUT_UPLOAD_FAILED` | yes | An output could not be written |
| `INVALID_JOB` | no | The message does not match the contract, or a URL is outside the object store |
| `SOURCE_TOO_LARGE` | no | The original is larger than declared, or over 50 MiB |
| `SOURCE_INTEGRITY` | no | The original's size or SHA-256 differs from the ledger's |
| `UNSUPPORTED_FORMAT` | no | The first bytes are not JPEG or PNG as declared |
| `DECODE_FAILED` | no | The file is corrupt or truncated |
| `PIXEL_LIMIT_EXCEEDED` | no | The image is over 100 megapixels |
| `METADATA_NOT_STRIPPED` | no | An output still had a metadata segment (a defect; never served) |

A message that names no job gets no answer. It reaches the dead-letter queue after five receives.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `IMAGE_JOBS_QUEUE_URL` | yes | The queue it reads |
| `IMAGE_RESULTS_QUEUE_URL` | yes | The queue it answers on |
| `APP_ENV` | no | `development` (default), `test` or `production`. Production refuses `AWS_ENDPOINT_URL` and requires HTTPS queue URLs |
| `AWS_REGION` | no | Default `us-east-1` |
| `AWS_ENDPOINT_URL` | local only | The moto emulator. Presigned URLs must then be on its origin; in AWS they must be HTTPS on an `amazonaws.com` host |
| `HEARTBEAT_FILE` | no | Default `/tmp/aestara-image-processing.heartbeat` |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warning` or `error` |

Logs are JSON lines on stdout. They carry job IDs, attempts, codes and durations, never URLs (which hold signatures), message bodies or exception messages.

## Develop and test

```bash
cd services/image-processing
uv sync                       # Python 3.13; locked dependencies, development group included
uv run ruff format --check . && uv run ruff check .
uv run mypy                   # strict
uv run pytest                 # moto runs in-process: no Docker needed
uv run python -m aestara_image_processing   # needs the variables above, e.g. from pnpm dev:stack
```

The tests use synthetic images only. They cover the following:

- sizes, orientation, colour, alpha and greyscale;
- removal of planted EXIF with GPS, XMP, IPTC, ICC and comment data;
- the pixel limit, checked from the header alone;
- mislabelled, corrupt and truncated files;
- loader blocking (GIF, TIFF, WebP and SVG refused) and deterministic output;
- the sandbox's time limit;
- the consumer against emulated S3 and SQS: write-once outputs, integrity failures, expiry, foreign URLs, and logs that carry no URL.

The api suite also runs this service for real (`services/api/test/derivatives-e2e.test.ts`, with `TEST_IMAGE_PROCESSING=1`).

## Container

```bash
docker build -t aestara-image-processing services/image-processing
IMAGE_UNDER_TEST=aestara-image-processing uv run pytest tests/test_container.py
```

The image is `python:3.13-slim`, pinned by digest, plus the locked virtual environment. It runs as UID 10001 and works with a read-only root filesystem: mount a tmpfs at `/tmp`, which holds the heartbeat and the child-process server's socket. The health check is `python -m aestara_image_processing --healthcheck`, which fails when the consumer loop has not reported for 90 seconds. Allow at least 120 seconds to stop, so a running job can finish. CI builds the image, runs it locked down (no capabilities, no new privileges) and scans it with Trivy.
