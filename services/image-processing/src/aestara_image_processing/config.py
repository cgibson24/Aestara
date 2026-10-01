"""Runtime configuration, read once from the environment (spec §7.1).

Staging and production run APP_ENV=production, as the api runs
NODE_ENV=production: no emulator endpoint, and HTTPS queue URLs. The limits of
ADR-0023 K2-01 and K2-02 are constants, not configuration.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit

# ADR-0023 K2-01 and K2-02.
JOB_SECONDS: Final = 60.0
MAX_SOURCE_BYTES: Final = 50 * 1024 * 1024
MAX_PIXELS: Final = 100_000_000
# A received job stays invisible to other consumers for longer than a job can run.
VISIBILITY_SECONDS: Final = 120
# The health check fails when the consumer loop has not reported for this long.
HEARTBEAT_STALE_SECONDS: Final = 90.0

ENVIRONMENTS: Final = ("development", "test", "production")
LOG_LEVELS: Final = ("debug", "info", "warning", "error")


class ConfigError(ValueError):
    """The environment does not describe a valid configuration."""


@dataclass(frozen=True)
class Config:
    app_env: str
    region: str
    # The local AWS emulator (moto, ADR-0023 K2-08); never set in a deployed environment.
    endpoint_url: str | None
    jobs_queue_url: str
    results_queue_url: str
    heartbeat_file: str
    log_level: str

    @property
    def object_origin(self) -> str | None:
        """Locally, presigned URLs must point at the emulator; None in AWS."""
        if self.endpoint_url is None:
            return None
        parts = urlsplit(self.endpoint_url)
        return f"{parts.scheme}://{parts.netloc}"


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if value == "":
        raise ConfigError(f"{name} is required")
    return value


def _url(name: str, value: str, *, https: bool) -> str:
    parts = urlsplit(value)
    allowed = ("https",) if https else ("http", "https")
    if parts.scheme not in allowed or parts.netloc == "":
        raise ConfigError(f"{name} must be an {'HTTPS' if https else 'HTTP(S)'} URL")
    return value


def load_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    app_env = env.get("APP_ENV", "development")
    if app_env not in ENVIRONMENTS:
        raise ConfigError(f"APP_ENV must be one of {', '.join(ENVIRONMENTS)}")
    production = app_env == "production"
    endpoint = env.get("AWS_ENDPOINT_URL", "").strip() or None
    if production and endpoint is not None:
        raise ConfigError("AWS_ENDPOINT_URL is not allowed in production")
    if endpoint is not None:
        _url("AWS_ENDPOINT_URL", endpoint, https=False)
    log_level = env.get("LOG_LEVEL", "info")
    if log_level not in LOG_LEVELS:
        raise ConfigError(f"LOG_LEVEL must be one of {', '.join(LOG_LEVELS)}")
    return Config(
        app_env=app_env,
        region=env.get("AWS_REGION", "us-east-1"),
        endpoint_url=endpoint,
        jobs_queue_url=_url("IMAGE_JOBS_QUEUE_URL", _required(env, "IMAGE_JOBS_QUEUE_URL"), https=production),
        results_queue_url=_url(
            "IMAGE_RESULTS_QUEUE_URL", _required(env, "IMAGE_RESULTS_QUEUE_URL"), https=production
        ),
        heartbeat_file=env.get("HEARTBEAT_FILE", "/tmp/aestara-image-processing.heartbeat"),  # noqa: S108
        log_level=log_level,
    )
