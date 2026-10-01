"""image-processing: derivative rendering for the Aesthetic Platform (ADR-0023 K2-01, K2-06).

A queue consumer with no database access and no PHI. Each job names one
original through a presigned GET and its outputs through presigned write-once
PUTs; the service renders a thumbnail and a display preview and reports their
size and SHA-256. It never changes an original.
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("aestara-image-processing")
except PackageNotFoundError:  # pragma: no cover - only when run from a bare source tree
    __version__ = "0.0.0"
