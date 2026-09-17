"""Derive the Hangkesong brand assets from a supplied logo artwork.

Usage: python scripts/generate-brand-assets.py <source-logo.png> [repo-root]

The supplied artwork arrives alpha-keyed off a white plate, so it keeps faint
cut-out speckles and coloured fringing along its edges. This script clears that
noise and resizes through premultiplied alpha so the transparent edges do not
pick up a halo, then writes the navigation wordmark, square mark, favicon and
touch icons into public/.
"""
import os
import sys
import tempfile

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
REPO = os.path.abspath(
    sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..")
)
NAVY = (7, 26, 48)


def load_clean():
    im = Image.open(SRC).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3]

    # kill the faint cut-out speckles that ring the artwork
    alpha = np.where(alpha < 22, 0.0, alpha)

    # the source was keyed off a white plate: low-alpha edge pixels carry
    # coloured fringing, so pull their chroma toward luminance
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    t = np.clip((235.0 - alpha) / 235.0, 0.0, 1.0)[..., None] * 0.92
    rgb = rgb * (1 - t) + lum[..., None] * t

    out = np.concatenate([np.clip(rgb, 0, 255), np.clip(alpha, 0, 255)[..., None]], axis=2)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def bbox(im, x0=0, x1=None, y0=0, y1=None, thr=16):
    a = np.asarray(im)[..., 3]
    sub = a[y0:y1, x0:x1]
    ys, xs = np.where(sub > thr)
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)


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


def on_square(mark, size, pad_ratio, bg=None):
    side = max(mark.width, mark.height)
    canvas_side = int(round(side * (1 + pad_ratio * 2)))
    inner = int(round(side / (1 + pad_ratio * 2)))
    scaled = resize_premul(
        mark,
        (max(1, round(mark.width * inner / side)), max(1, round(mark.height * inner / side))),
    )
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (bg + (255,)) if bg else (0, 0, 0, 0))
    canvas.alpha_composite(
        scaled, ((canvas_side - scaled.width) // 2, (canvas_side - scaled.height) // 2)
    )
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    brand = os.path.join(REPO, "public", "brand")
    os.makedirs(brand, exist_ok=True)

    clean = load_clean()
    full_box = bbox(clean)
    print("content bbox", full_box, "size", full_box[2] - full_box[0], full_box[3] - full_box[1])

    # --- navigation wordmark: content + a hair of breathing room ---
    pad = 4
    word = clean.crop((full_box[0] - pad, full_box[1] - pad, full_box[2] + pad, full_box[3] + pad))
    word = resize_premul(word, (1400, round(1400 * word.height / word.width)))
    word.save(os.path.join(brand, "hangkathon-logo.png"))
    print("wordmark", word.size, "ratio", round(word.width / word.height, 3))
    clean.save(os.path.join(brand, "hangkathon-logo-source.png"))

    # --- bridge-only mark: mask the 杭客松 / Hangkathon lockup and the g
    # descender so the base lens keeps its full, uncut sweep ---
    mark_arr = np.asarray(clean).copy()
    yy, xx = np.mgrid[0 : mark_arr.shape[0], 0 : mark_arr.shape[1]]
    mark_arr[(xx > 790) & (yy < 600), 3] = 0
    mark_arr[xx > 1085, 3] = 0
    mark_img = Image.fromarray(mark_arr, "RGBA")
    bridge_box = bbox(mark_img)
    print("bridge bbox", bridge_box)
    mark = mark_img.crop(bridge_box)
    mark.save(os.path.join(brand, "hangkathon-mark.png"))

    for size in (192, 512):
        on_square(mark, size, 0.05).save(os.path.join(brand, f"icon-{size}.png"))

    on_square(mark, 180, 0.05, bg=NAVY).convert("RGB").save(
        os.path.join(REPO, "public", "apple-touch-icon.png")
    )

    on_square(mark, 256, 0.05).save(
        os.path.join(REPO, "public", "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # preview sheet on the real page background, for eyeballing the result
    sheet = Image.new("RGB", (1500, 420), NAVY)
    w2 = resize_premul(word, (900, round(900 * word.height / word.width)))
    sheet.paste(w2, (40, 60), w2)
    m = on_square(mark, 220, 0.05)
    sheet.paste(m, (1010, 40), m)
    for i, s in enumerate((48, 32, 16)):
        t = on_square(mark, s, 0.05)
        sheet.paste(t, (1240, 40 + i * 60), t)
    preview = os.path.join(tempfile.gettempdir(), "hangkathon-brand-preview.png")
    sheet.save(preview)
    print("ok ->", preview)


if __name__ == "__main__":
    main()
