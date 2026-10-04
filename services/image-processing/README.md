# image-processing

Renders each accepted photo's `THUMBNAIL` (long edge 400 px) and `DISPLAY_PREVIEW` (long edge 2048 px) as JPEG, in sRGB, with the orientation applied and all metadata removed. It also aligns before/after pairs (it estimates the transform that places an after photo over its before photo) and renders purpose-specific exports. Python 3.13 with pyvips (libvips 8.18 from the `pyvips-binary` wheel) and, for registration and exports, OpenCV (`opencv-python-headless` 4.14, Apache-2.0), managed with uv. Decisions: ADR-0023 K2-01 and K2-06, ADR-0024, ADR-0026 K3-13 to K3-15, ADR-0027.

## What it does

The api worker sends `image.derivative.requested` to the `image-jobs` queue (`services/api/src/worker/derivatives.ts`). The message holds a presigned `GET` for the original, the ledger's size and SHA-256, a presigned write-once `PUT` per output, and an expiry. All URLs are valid for at most 10 minutes. For each job the service does this:

1. Downloads the original. Its size and SHA-256 must match the ledger's.
2. Checks the first bytes against the declared type (JPEG or PNG only).
3. Renders the outputs in a fresh child process with every other libvips loader blocked. An image over 100 megapixels is refused from its header, before any pixel is decoded.
4. Writes each output through its `PUT`. The write is write-once: a `412` means an earlier delivery already wrote it.
5. Sends `image.derivative.completed` or `image.derivative.failed` to `image-results`. The worker then verifies the outputs and records the derivatives.

A registration job (`"task": "REGISTRATION"`, sent by `services/api/src/worker/registrations.ts`) holds presigned `GET`s for the two display previews, never the originals. The service downloads and checks both like an original, then, in a fresh child process:

1. Decodes each preview with libvips only, applies its orientation and reduces it to grey at most 1024 px on its long edge. OpenCV never decodes a file; it receives the pixel arrays.
2. Finds AKAZE features in both, keeps the matches that pass a ratio test, and fits a similarity transform (uniform scale, rotation, translation) with RANSAC. No shear and no perspective: alignment can move and turn a photo, never reshape it.
3. Refuses the fit as `NO_RELIABLE_ALIGNMENT` with fewer than 12 agreeing matches, under a quarter of matches agreeing, a scale outside 0.5–2, a turn beyond 20° or a shift beyond two image heights.
4. Sends `image.registration.completed` (the transform, in units of the before image's height from its centre, and the number of agreeing matches) or `image.registration.failed`. Nothing is written.

An export job (`"task": "EXPORT"`, sent by `services/api/src/worker/exports.ts`) holds presigned `GET`s for one original (`SINGLE`) or the before and after originals of a set (`SIDE_BY_SIDE`), one write-once `PUT` and the drawing instructions. The service downloads and checks the originals like a derivative job, then, in a fresh child process:

1. Decodes each original with libvips, applies its orientation and converts it to sRGB.
2. `SINGLE`: reduces the photo to at most `maxEdgePx` (4096) on its long edge, never enlarging it, and draws the annotation shapes in. The worker resolves each shape beforehand: colours as hex values from the design tokens, stroke widths and text sizes as fractions of the photo's height. Text is drawn with the bundled Inter font (`fonts/`, SIL Open Font License 1.1) and is never read as markup; Inter covers Latin, Greek and Cyrillic, and a character it lacks draws as a missing-glyph box.
3. `SIDE_BY_SIDE`: brings both photos to the same height and places the after photo by the set's transform inside a frame the size of the before photo, on a neutral dark grey where it does not reach. The pair fits `maxEdgePx` side by side.
4. Encodes one JPEG without any metadata, writes it through its `PUT` and sends `image.export.completed` (size, SHA-256 and pixel size) or `image.export.failed`. The render adds no text, dates, names or logos of its own; rendering is deterministic, so a repeated delivery meets the write-once object with the same bytes.

The whole job has 60 seconds. The service has **no database access** and receives **no patient identifiers**: the URLs and the object keys inside them are opaque. The only free text it receives, an export's annotation labels, is drawn and never logged or reported back. It never changes an original.

| Module | Role |
|---|---|
| `contract.py` | Job validation and result shapes (spec §6.7) |
| `imaging.py` | libvips hardening, rendering, the metadata check |
| `registration.py` | Before/after registration: decoding to grey, AKAZE features, RANSAC similarity fit |
| `export.py` | Export renders: one photo with an annotation layer, or a before/after pair side by side |
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
| `RENDER_CRASHED` | yes | The child process ended without an answer (for example, the memory limit), or a label could not be drawn |
| `OUTPUT_UPLOAD_FAILED` | yes | An output could not be written |
| `INVALID_JOB` | no | The message does not match the contract, or a URL is outside the object store |
| `SOURCE_TOO_LARGE` | no | The original is larger than declared, or over 50 MiB |
| `SOURCE_INTEGRITY` | no | The original's size or SHA-256 differs from the ledger's |
| `UNSUPPORTED_FORMAT` | no | The first bytes are not JPEG or PNG as declared |
| `DECODE_FAILED` | no | The file is corrupt or truncated |
| `PIXEL_LIMIT_EXCEEDED` | no | The image is over 100 megapixels |
| `METADATA_NOT_STRIPPED` | no | An output still had a metadata segment (a defect; never served) |
| `NO_RELIABLE_ALIGNMENT` | no | Registration found no plausible alignment; the set stays as it was |

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
- the consumer against emulated S3 and SQS: write-once outputs, integrity failures, expiry, foreign URLs, and logs that carry no URL;
- registration: known transforms recovered, independence from the preview sizes, and refusals for featureless, unrelated or over-turned pairs;
- exports: upright, stripped output within the size limit, every annotation shape at its place, labels drawn as written, a pair placed by its transform, contract refusals, and a repeated delivery meeting its write-once output.

The api suite also runs this service for real (`services/api/test/derivatives-e2e.test.ts`, with `TEST_IMAGE_PROCESSING=1`).

## Container

```bash
docker build -t aestara-image-processing services/image-processing
IMAGE_UNDER_TEST=aestara-image-processing uv run pytest tests/test_container.py
```

The image is `python:3.13-slim`, pinned by digest, with Debian's security updates applied at build time and pip removed, plus the locked virtual environment. It runs as UID 10001 and works with a read-only root filesystem: mount a tmpfs at `/tmp`, which holds the heartbeat, the child-process server's socket and the font cache. The health check is `python -m aestara_image_processing --healthcheck`, which fails when the consumer loop has not reported for 90 seconds. Allow at least 120 seconds to stop, so a running job can finish. CI builds the image, runs it locked down (no capabilities, no new privileges) through a derivative, a registration and an annotated export with a label, and scans it with Trivy.
