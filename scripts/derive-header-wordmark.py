"""Derive the light-background header wordmark from the supplied teal artwork.

Usage: python scripts/derive-header-wordmark.py [repo-root]

The supplied artwork (public/brand/hangkathon-logo-teal-source.png, 1536x1024 RGBA)
is a dark-teal lockup on a fully transparent plate: the bridge mark on the left, the
杭客松 / Hangkathon text on the right, and a faded water reflection below the mark.

For the 68px navigation wordmark the reflection is noise (it is a half-height mirror
whose alpha falls from ~224 to ~96), so this crops it off at the point where the
water line ends, then tightens and resizes through premultiplied alpha. Colour is
copied verbatim — the artwork is already dark ink, so no remapping is needed.

It also writes a with-reflection twin purely so the two crops can be compared at
real header size; that file is not referenced by the app.
"""
import os
import sys
import tempfile

import numpy as np
from PIL import Image

REPO = os.path.abspath(
    sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..")
)
BRAND = os.path.join(REPO, "public", "brand")
SOURCE = os.path.join(BRAND, "hangkathon-logo-teal-source.png")
OUTPUT = os.path.join(BRAND, "hangkathon-logo-teal.png")
# 对照版只用于目视比较（68px 头部高度下哪版可读），写到临时目录，不进仓库
COMPARE = os.path.join(tempfile.gettempdir(), "hangkathon-logo-withreflection.png")

WIDTH = 1400
PAD = 4
# 倒影从水线以下开始淡出：这一行的平均 alpha 已从 ~224 掉到 ~155，是主体与倒影的分界
REFLECTION_TOP = 756
# 相机原图四周有一圈 alpha=1 的压缩噪点，先清掉再紧裁
NOISE_ALPHA = 8
WHITE = np.array([255, 255, 255], dtype=np.float32)


def relative_luminance(rgb):
    c = np.asarray(rgb, dtype=np.float32) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return float(c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))


def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def load():
    im = Image.open(SOURCE).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    a[..., 3] = np.where(a[..., 3] < NOISE_ALPHA, 0.0, a[..., 3])
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def bbox(im, y_bottom=None):
    a = np.asarray(im)[..., 3]
    if y_bottom is not None:
        a = a[:y_bottom]
    ys, xs = np.where(a > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def resize_premul(im, size):
    """Resize RGBA through premultiplied alpha so edges do not pick up a halo."""
    a = np.asarray(im).astype(np.float32)
    alpha = a[..., 3:4] / 255.0
    pm = np.concatenate([a[..., :3] * alpha, a[..., 3:4]], axis=2)
    small = np.asarray(
        Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), "RGBA").resize(size, Image.LANCZOS)
    ).astype(np.float32)
    sa = small[..., 3:4] / 255.0
    rgb = np.where(sa > 0.004, small[..., :3] / np.maximum(sa, 1e-4), 0.0)
    out = np.concatenate([np.clip(rgb, 0, 255), small[..., 3:4]], axis=2)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def crop_and_scale(im, box, path):
    x0, y0, x1, y1 = box
    cropped = im.crop(
        (max(0, x0 - PAD), max(0, y0 - PAD), min(im.width, x1 + PAD), min(im.height, y1 + PAD))
    )
    scaled = resize_premul(cropped, (WIDTH, max(1, round(WIDTH * cropped.height / cropped.width))))
    scaled.save(path)
    return scaled


def main():
    art = load()
    full = bbox(art)
    print("source content bbox", full, "size", art.size)

    # 主体（不含倒影）：先按分界线切掉下半部分，再取紧裁框
    body_box = bbox(art, y_bottom=REFLECTION_TOP)
    body = crop_and_scale(art, body_box, OUTPUT)
    print("wordmark (no reflection)", body.size, "ratio", round(body.width / body.height, 3))

    # 对照版：保留倒影
    with_ref = crop_and_scale(art, full, COMPARE)
    print("compare (with reflection)", with_ref.size, "ratio", round(with_ref.width / with_ref.height, 3))

    a = np.asarray(body).astype(np.float32)
    opaque = a[..., 3] >= 128
    rgb = a[..., :3][opaque]
    alpha = a[..., 3:4][opaque] / 255.0
    composited = rgb * alpha + WHITE * (1 - alpha)
    median = np.median(composited, axis=0)
    ratio = contrast(median, WHITE)
    print("median composited rgb", median.astype(int), "contrast vs #ffffff", round(ratio, 2))
    print("rendered width at 68px header height:", round(68 * body.width / body.height))
    if ratio < 4.5:
        sys.exit("header wordmark contrast is below the 4.5 check")


if __name__ == "__main__":
    main()
