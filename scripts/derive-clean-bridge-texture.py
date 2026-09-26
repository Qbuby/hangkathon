#!/usr/bin/env python3
"""从首页桥体贴图里修掉四个桥面标签（算力汇聚/开源生态/人才共创/产业场景）。

原始带字海报存为 hangzhou-upgrade-reference-source.png，本脚本从它重新派生
hangzhou-upgrade-reference.png（渲染层 app/scene.tsx 直接用后者做桥体贴图）。

做法：在四个标签的包围盒里，按「亮且偏白」选出文字像素（桥面的青色辉光
红通道低，白字两个通道都高，用 min(r,g) 就能分开），掩膜膨胀后用强模糊的
周边内容回填，边缘羽化。只动文字像素，桥面纹理不受影响。
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ASSETS = Path(__file__).resolve().parent.parent / "public" / "assets"
SOURCE = ASSETS / "hangzhou-upgrade-reference-source.png"
TARGET = ASSETS / "hangzhou-upgrade-reference.png"

# 四个标签的包围盒 [x, y, w, h]，与 app/scene.tsx 旧版 labelPatch 的坐标一致
LABELS = [(548, 428, 111, 66), (737, 355, 102, 54), (968, 334, 106, 42), (1170, 378, 115, 59)]
PAD = 16          # 包围盒外扩，保证字形完整落进处理区
THRESHOLD = 132   # min(r,g) 超过它算文字像素
DILATE = 7        # 掩膜膨胀（MaxFilter 核径，奇数）
FEATHER = 2.6     # 掩膜边缘羽化
BLUR = 10         # 回填用的模糊半径


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"缺少原始贴图 {SOURCE}")
    img = Image.open(SOURCE).convert("RGB")
    for x, y, w, h in LABELS:
        box = (x - PAD, y - PAD, x + w + PAD, y + h + PAD)
        region = img.crop(box)
        pixels = np.asarray(region).astype(int)
        mask = (np.minimum(pixels[:, :, 0], pixels[:, :, 1]) > THRESHOLD).astype("uint8") * 255
        mask_image = Image.fromarray(mask).filter(ImageFilter.MaxFilter(DILATE))
        fill = region.filter(ImageFilter.GaussianBlur(BLUR))
        soft = mask_image.filter(ImageFilter.GaussianBlur(FEATHER))
        cleaned = Image.composite(fill, region, soft)
        img.paste(cleaned, box[:2])
        print(f"label @({x},{y}) 文字像素 {int((np.asarray(mask_image) > 0).sum())}")
    img.save(TARGET)
    print(f"已写出 {TARGET}")


if __name__ == "__main__":
    main()
