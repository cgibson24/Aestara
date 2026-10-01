# image-processing (ADR-0023 K2-01). Build from this directory:
#   docker build -t aestara-image-processing services/image-processing
# The runtime image holds the virtual environment and the package only: no
# build tools, no tests. It runs as a non-root user and works with a read-only
# root filesystem; /tmp (the heartbeat) is the only path it writes.
ARG PYTHON_IMAGE=python:3.13-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b

FROM ${PYTHON_IMAGE} AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir "uv==0.8.17"
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
# Exactly the locked versions, without the development group.
RUN uv sync --frozen --no-dev --no-editable

FROM ${PYTHON_IMAGE}
# Debian security fixes published since the base image, and no pip: the runtime
# installs nothing, and pip's vendored libraries would only add findings (ADR-0024).
RUN apt-get update \
 && apt-get upgrade --yes --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && python -m pip uninstall --yes --quiet pip \
 && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin imageproc
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
USER 10001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-m", "aestara_image_processing", "--healthcheck"]
CMD ["python", "-m", "aestara_image_processing"]
