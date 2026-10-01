"""Entry point: `python -m aestara_image_processing` runs the consumer; `--healthcheck` checks it."""

import sys

from .config import HEARTBEAT_STALE_SECONDS, ConfigError, load_config
from .consumer import Consumer, heartbeat_fresh
from .log import configure
from .service import JobRunner


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        config = load_config()
    except ConfigError as error:
        print(f"configuration error: {error}", file=sys.stderr)
        return 2
    if args == ["--healthcheck"]:
        return 0 if heartbeat_fresh(config.heartbeat_file, HEARTBEAT_STALE_SECONDS) else 1
    if args:
        print("usage: python -m aestara_image_processing [--healthcheck]", file=sys.stderr)
        return 2
    configure(config.log_level)
    Consumer(config, JobRunner(config)).run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
