"""Automatic before/after registration (Bible §8.1; ADR-0026 K3-13).

Estimates a similarity transform (uniform scale, rotation, translation) that
places the after image over the before image, from the two display previews.
No shear and no perspective: alignment may move and turn a photo, never
reshape it. Images are decoded only by libvips, under the same hardening as
derivatives; OpenCV receives grey pixel arrays and finds AKAZE features,
matched across the two images and fitted with RANSAC. When too few matches
agree, or the fit is implausible, the result is "no reliable alignment" and
the set stays as it was.

The transform is expressed as the api defines it (packages/api-contracts,
RegistrationTransform): in units of the before image's height, origin at its
centre, y down; the after image is first scaled to the before image's height
and centred, then scaled, rotated (clockwise on screen) and moved.

This module runs inside the sandbox child (sandbox.py).
"""

import math
from typing import Any, Final

import cv2
import numpy as np
import numpy.typing as npt
import pyvips

from .contract import Transform
from .errors import JobFailure
from .imaging import check_signature, load_image, to_srgb

# Features are found on images at most this size; enough detail, bounded time.
WORK_EDGE_PX: Final = 1024
MIN_INLIERS: Final = 12
MIN_INLIER_RATIO: Final = 0.25
RATIO_TEST: Final = 0.8
REPROJECTION_PX: Final = 3.0
# A fit outside these is treated as a wrong match, not an alignment (ADR-0026 K3-13).
SCALE_RANGE: Final = (0.5, 2.0)
MAX_ROTATION_DEG: Final = 20.0
MAX_TRANSLATION: Final = 2.0


def _grey(data: bytes, content_type: str) -> npt.NDArray[np.uint8]:
    """Decodes with libvips (JPEG or PNG only), applies orientation, returns an 8-bit grey array."""
    check_signature(data, content_type)
    try:
        image = to_srgb(load_image(data, content_type))
        if image.hasalpha():
            image = image.flatten(background=[255, 255, 255])
        image = image.copy_memory().autorot()
        scale = WORK_EDGE_PX / max(image.width, image.height)
        if scale < 1:
            image = image.resize(scale, kernel="lanczos3")
        grey = image.colourspace("b-w")
        if grey.format != "uchar":
            grey = grey.cast("uchar")
        grey = grey.extract_band(0)
        pixels = grey.write_to_memory()
        width, height = grey.width, grey.height
    except pyvips.Error:
        raise JobFailure("DECODE_FAILED") from None
    return np.frombuffer(pixels, dtype=np.uint8).reshape(height, width)


def estimate(before: npt.NDArray[np.uint8], after: npt.NDArray[np.uint8]) -> Transform:
    """The similarity transform placing `after` over `before`; JobFailure when none is reliable."""
    akaze = cv2.AKAZE.create()
    kp_b, desc_b = akaze.detectAndCompute(before, None)
    kp_a, desc_a = akaze.detectAndCompute(after, None)
    if desc_b is None or desc_a is None or len(kp_b) < MIN_INLIERS or len(kp_a) < MIN_INLIERS:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    good = [
        pair[0]
        for pair in matcher.knnMatch(desc_a, desc_b, k=2)
        if len(pair) == 2 and pair[0].distance < RATIO_TEST * pair[1].distance
    ]
    if len(good) < MIN_INLIERS:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    src = np.array([kp_a[m.queryIdx].pt for m in good], dtype=np.float32)
    dst = np.array([kp_b[m.trainIdx].pt for m in good], dtype=np.float32)
    matrix, mask = cv2.estimateAffinePartial2D(
        src,
        dst,
        method=cv2.RANSAC,
        ransacReprojThreshold=REPROJECTION_PX,
        maxIters=2000,
        confidence=0.99,
        refineIters=10,
    )
    if matrix is None or mask is None:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    inliers = int(mask.sum())
    if inliers < MIN_INLIERS or inliers / len(good) < MIN_INLIER_RATIO:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    return to_contract(matrix, before.shape, after.shape, inliers)


def to_contract(
    matrix: npt.NDArray[np.floating[Any] | np.integer[Any]],
    before_shape: tuple[int, ...],
    after_shape: tuple[int, ...],
    inliers: int,
) -> Transform:
    """Converts OpenCV's pixel matrix (after → before) into the api's resolution-free transform."""
    a, b, tx = (float(v) for v in matrix[0])
    c, d, ty = (float(v) for v in matrix[1])
    s = math.hypot(a, c)
    theta = math.degrees(math.atan2(c, a))
    hb, wb = float(before_shape[0]), float(before_shape[1])
    ha, wa = float(after_shape[0]), float(after_shape[1])
    # p_b = M p_a = s' (hb / ha) R (p_a - c_a) + hb t' + c_b
    scale = s * ha / hb
    cax, cay = wa / 2, ha / 2
    rcx, rcy = a * cax + b * cay, c * cax + d * cay
    t_x = (tx + rcx - wb / 2) / hb
    t_y = (ty + rcy - hb / 2) / hb
    if not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1] or abs(theta) > MAX_ROTATION_DEG:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    if abs(t_x) > MAX_TRANSLATION or abs(t_y) > MAX_TRANSLATION:
        raise JobFailure("NO_RELIABLE_ALIGNMENT")
    return Transform(round(scale, 5), round(theta, 4), round(t_x, 5), round(t_y, 5), inliers)


def register(before: bytes, before_type: str, after: bytes, after_type: str) -> Transform:
    """Decodes both previews and estimates the transform. Never writes an image."""
    return estimate(_grey(before, before_type), _grey(after, after_type))
