"""Synthetic test images (no real photographs, no PHI) and helpers for the AWS emulator."""

import hashlib
import json
import struct
import uuid
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pyvips

# A synthetic name planted in metadata; it must never reach a derivative.
PLANTED_TEXT = b"Jane Example 1970-01-01"


def gradient(width: int, height: int) -> pyvips.Image:
    xyz = pyvips.Image.xyz(width, height)
    red = (xyz[0] * 255 / width).cast("uchar")
    green = (xyz[1] * 255 / height).cast("uchar")
    blue = ((xyz[0] + xyz[1]) % 256).cast("uchar")
    return red.bandjoin([green, blue]).copy(interpretation="srgb")


def _segment(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def _exif(orientation: int) -> bytes:
    """A big-endian TIFF block: IFD0 with Orientation and a GPS IFD with a latitude."""
    ifd0_offset = 8
    ifd0 = struct.pack(">H", 2)
    gps_offset = ifd0_offset + 2 + 2 * 12 + 4
    ifd0 += struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0)
    ifd0 += struct.pack(">HHII", 0x8825, 4, 1, gps_offset)
    ifd0 += struct.pack(">I", 0)
    rational_offset = gps_offset + 2 + 3 * 12 + 4
    gps = struct.pack(">H", 3)
    gps += struct.pack(">HHI4s", 0x0000, 1, 4, bytes([2, 2, 0, 0]))
    gps += struct.pack(">HHI2sH", 0x0001, 2, 2, b"N\x00", 0)
    gps += struct.pack(">HHII", 0x0002, 5, 3, rational_offset)
    gps += struct.pack(">I", 0)
    rationals = struct.pack(">IIIIII", 40, 1, 26, 1, 4600, 100)
    return b"Exif\x00\x00" + b"MM\x00\x2a" + struct.pack(">I", ifd0_offset) + ifd0 + gps + rationals


def jpeg_with_metadata(width: int = 4032, height: int = 3024, orientation: int = 6) -> bytes:
    """A JPEG carrying EXIF (orientation and GPS), XMP, IPTC, a Display P3 profile and a comment."""
    base = gradient(width, height).jpegsave_buffer(Q=90, profile="p3")
    profile = pyvips.Image.jpegload_buffer(base).get("icc-profile-data")
    pixels = gradient(width, height).jpegsave_buffer(Q=90, keep=pyvips.enums.ForeignKeep.NONE)
    xmp = (
        b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta><dc:creator>"
        + PLANTED_TEXT
        + b"</dc:creator></x:xmpmeta>"
    )
    iptc = b"Photoshop 3.0\x008BIM\x04\x04\x00\x00" + struct.pack(">H", len(PLANTED_TEXT) + 5)
    iptc += b"\x1c\x02\x50" + struct.pack(">H", len(PLANTED_TEXT)) + PLANTED_TEXT
    segments = (
        _segment(0xE1, _exif(orientation))
        + _segment(0xE1, xmp)
        + _segment(0xE2, b"ICC_PROFILE\x00\x01\x01" + profile)
        + _segment(0xED, iptc)
        + _segment(0xFE, PLANTED_TEXT)
    )
    return bytes(pixels[:2] + segments + pixels[2:])


def png_rgba16(width: int = 640, height: int = 480) -> bytes:
    rgb = gradient(width, height).cast("ushort") * 257
    alpha = (pyvips.Image.xyz(width, height)[0] * 65535 / width).cast("ushort")
    return bytes(rgb.bandjoin(alpha).copy(interpretation="rgb16").pngsave_buffer())


def grey_jpeg(width: int = 800, height: int = 600) -> bytes:
    grey = gradient(width, height).colourspace("b-w")
    return bytes(grey.jpegsave_buffer(Q=90, keep=pyvips.enums.ForeignKeep.NONE))


def png_header_only(width: int, height: int) -> bytes:
    """A PNG whose header claims a size but whose image data is junk: decodable only as far as the header."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", b"junk") + chunk(b"IEND", b"")


def markers(jpeg: bytes) -> list[int]:
    """The JPEG header markers up to the start of scan."""
    found = []
    i = 2
    while i + 4 <= len(jpeg) and jpeg[i] == 0xFF:
        marker = jpeg[i + 1]
        found.append(marker)
        if marker == 0xDA:
            break
        i += 2 + int.from_bytes(jpeg[i + 2 : i + 4], "big")
    return found


@dataclass
class Emulator:
    endpoint: str
    bucket: str
    jobs_queue: str
    results_queue: str
    s3: Any
    sqs: Any

    def put_source(self, data: bytes, content_type: str = "image/jpeg") -> str:
        key = f"CLINICAL_ORIGINAL/{uuid.uuid4()}"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def job(
        self,
        source_key: str,
        data: bytes,
        content_type: str = "image/jpeg",
        *,
        sha256: str | None = None,
        expires_in: timedelta = timedelta(minutes=10),
        attempt: int = 1,
    ) -> dict[str, Any]:
        """A job message shaped as the api worker builds it (derivatives.ts, dispatch)."""
        outputs = []
        for kind, edge in (("THUMBNAIL", 400), ("DISPLAY_PREVIEW", 2048)):
            key = f"CLINICAL_DERIVATIVE/{uuid.uuid4()}"
            url = self.s3.generate_presigned_url(
                "put_object",
                Params={"Bucket": self.bucket, "Key": key, "ContentType": "image/jpeg", "IfNoneMatch": "*"},
                ExpiresIn=600,
            )
            outputs.append(
                {
                    "kind": kind,
                    "url": url,
                    "headers": {"content-type": "image/jpeg", "if-none-match": "*"},
                    "maxEdgePx": edge,
                    "contentType": "image/jpeg",
                    "key": key,
                }
            )
        source_url = self.s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": source_key}, ExpiresIn=600
        )
        return {
            "jobId": str(uuid.uuid4()),
            "attempt": attempt,
            "source": {
                "url": source_url,
                "contentType": content_type,
                "byteSize": len(data),
                "sha256": sha256 or hashlib.sha256(data).hexdigest(),
            },
            "outputs": outputs,
            "expiresAt": (datetime.now(UTC) + expires_in).isoformat(),
        }

    def send(self, message: dict[str, Any] | str) -> None:
        body = message if isinstance(message, str) else json.dumps(message)
        self.sqs.send_message(QueueUrl=self.jobs_queue, MessageBody=body)

    def results(self) -> list[dict[str, Any]]:
        out = self.sqs.receive_message(QueueUrl=self.results_queue, MaxNumberOfMessages=10, WaitTimeSeconds=0)
        return [json.loads(m["Body"]) for m in out.get("Messages", [])]

    def read(self, key: str) -> bytes:
        body: bytes = self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        return body
