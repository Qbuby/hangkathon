"""Derive the light-background wordmark from the shipped silver one.

Usage: python scripts/derive-dark-wordmark.py [repo-root]

public/brand/hangkathon-logo.png is silver artwork drawn for the dark homepage
hero. On the white secondary pages it reads at a 1.4 contrast ratio — 26% of its
opaque pixels are literally #f8f8f8 — so this derives a navy twin for those
pages. The alpha channel is copied verbatim, which keeps the two files
geometrically identical so they can be swapped with no layout shift.
"""
import os
import sys

import numpy as np
from PIL import Image

REPO = os.path.abspath(
    sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..")
)
BRAND = os.path.join(REPO, "public", "brand")
SILVER = os.path.join(BRAND, "hangkathon-logo.png")
DARK = os.path.join(BRAND, "hangkathon-logo-dark.png")

DEEP = np.array([7, 26, 48], dtype=np.float32)  # #071a30, same navy as the touch icon
LIGHT = np.array([138, 166, 192], dtype=np.float32)  # #8aa6c0
WHITE = np.array([255, 255, 255], dtype=np.float32)


def relative_luminance(rgb):
    c = np.asarray(rgb, dtype=np.float32) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main():
    silver = Image.open(SILVER).convert("RGBA")
    a = np.asarray(silver).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3:4]

    # keep the artwork's tonal structure: bright strokes land on the light end of
    # the ramp, deep accents stay navy, so the highlights survive as slate blue.
    # the ramp variable is WCAG relative luminance, the same metric the contrast
    # check below uses, so the median contrast is a number this script controls.
    l = relative_luminance(rgb)[..., None]
    dark_rgb = DEEP + (LIGHT - DEEP) * l

    out = np.concatenate([np.clip(dark_rgb, 0, 255), alpha], axis=2).astype(np.uint8)
    derived = Image.fromarray(out, "RGBA")
    derived.save(DARK)

    opaque = out[..., 3] >= 200
    inks = out[..., :3][opaque]
    median = np.median(inks, axis=0)
    ratios = np.array([contrast(px, WHITE) for px in inks[np.linspace(0, len(inks) - 1, 2000).astype(int)]])
    ratio = contrast(median, WHITE)
    print("silver", silver.size, "-> dark", derived.size)
    print("alpha identical", bool(np.array_equal(out[..., 3], np.asarray(silver)[..., 3])))
    print("median opaque rgb", median.astype(int), "contrast vs #ffffff", round(ratio, 2))
    print("contrast p10/p90", round(float(np.percentile(ratios, 10)), 2), round(float(np.percentile(ratios, 90)), 2))
    if derived.size != silver.size or ratio < 3.0:
        sys.exit("derived wordmark does not meet the geometry/contrast check")


if __name__ == "__main__":
    main()
