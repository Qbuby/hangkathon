#!/usr/bin/env python3
"""从首页桥体贴图里修掉四个桥面标签（算力汇聚/开源生态/人才共创/产业场景）。

原始带字海报存为 hangzhou-upgrade-reference-source.png，本脚本从它重新派生
hangzhou-upgrade-reference.png（渲染层 app/scene.tsx 直接用后者做桥体贴图）。

几何驱动的纯 OpenCV/NumPy 处理（无模型）。桥体是一条沿贝塞尔曲线流动的
玻璃光带（曲线参数来自 app/scene.tsx 的雕塑网格），文字压在「天空 → 亮边 →
玻璃」的三分界上，任何各向同性的填充都会把结构抹花。按带内外分别处理：
1. 天空区（亮边上方）：辉光与笔画按行在左右真实天空间插值——晚霞的云带
   以水平走向为主，同行像素明暗一致；
2. 玻璃区（亮边下方）：光带纹理沿拱轴流动，逐像素沿切向平移到干净区段取
   供体，并按两侧局部均值做亮度匹配后羽化贴回——光带的竖向光纹与走向
   全部保留；
3. 供体落点自动避开所有标签矩形与辉光区。
依赖：pip install opencv-python-headless。
"""
from pathlib import Path

import cv2
import numpy as np

ASSETS = Path(__file__).resolve().parent.parent / "public" / "assets"
SOURCE = ASSETS / "hangzhou-upgrade-reference-source.png"
TARGET = ASSETS / "hangzhou-upgrade-reference.png"

LABELS = [(548, 428, 111, 66), (737, 355, 102, 54), (968, 334, 106, 42), (1170, 378, 115, 59)]
PAD = 14
THRESHOLD = 172   # 白字笔画：min(R,G) 阈值
HALO = 150        # 辉光下限
HALO_REACH = 6
FEATHER = 4

# app/scene.tsx 里雕塑网格的贝塞尔曲线（外缘=亮边，内缘=玻璃下缘）
OUTER = [(243, 604), [(450, 591), (606, 459), (795, 401)], [(919, 357), (1031, 366), (1135, 402)], [(1310, 460), (1481, 577), (1631, 612)]]
INNER = [(243, 617), [(373, 624), (469, 577), (583, 658)], [(647, 488), (807, 435), (944, 444)], [(1082, 446), (1179, 518), (1237, 658)], [(1321, 585), (1480, 612), (1631, 621)]]


def bezier_lookup(curve, samples=400):
    """把分段贝塞尔曲线按弧长均匀采样，返回 x→(y, 斜率) 的查表。"""
    pts = [np.array(curve[0], dtype=float)]
    for c in curve[1:]:
        p0, p1, p2, p3 = pts[-1], np.array(c[0], float), np.array(c[1], float), np.array(c[2], float)
        for t in np.linspace(0, 1, samples, endpoint=False):
            pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3)
        pts.append(p3)
    pts = np.array(pts)
    xs, ys = pts[:, 0], pts[:, 1]
    order = np.argsort(xs)
    xs, ys = xs[order], ys[order]
    # x 单调化（取每个 x 的中位 y）
    uniq = np.unique(xs.round().astype(int))
    med = np.array([np.median(ys[(xs >= u - 0.5) & (xs <= u + 0.5)]) for u in uniq])
    slope = np.gradient(med, uniq)
    return uniq, med, slope


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"缺少原始贴图 {SOURCE}")
    data = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR).astype(np.float32)
    img_h, img_w = data.shape[:2]
    red, green, blue = data[:, :, 2], data[:, :, 1], data[:, :, 0]
    bright = np.minimum(red, green)
    bluishness = blue - red

    outer_x, outer_y, outer_s = bezier_lookup(OUTER)
    inner_x, inner_y, _ = bezier_lookup(INNER)

    def edge_at(table_x, table_y, x):
        return float(np.interp(x, table_x, table_y))

    # 掩膜：笔画 + 辉光
    mask = np.zeros((img_h, img_w), dtype=np.float32)
    for x, y, w, h in LABELS:
        box = np.zeros_like(mask)
        box[y - PAD:y + h + PAD, x - PAD:x + w + PAD] = 1
        strokes = ((bright > THRESHOLD) & (box > 0)).astype("uint8") * 255
        near = cv2.dilate(strokes, np.ones((13, 13), "uint8"))
        halo = ((bright > HALO) & (box > 0) & (near > 0)).astype("uint8") * 255
        mask = np.maximum(mask, cv2.dilate(cv2.bitwise_or(strokes, halo), np.ones((3, 3), "uint8")) / 255.0)

    out = data.copy()
    label_all = np.zeros((img_h, img_w), dtype=bool)
    for x, y, w, h in LABELS:
        label_all[y - PAD:y + h + PAD, x - PAD:x + w + PAD] = True

    # 玻璃区：沿切向取供体 + 局部亮度匹配
    donor = data.copy()
    valid = ~label_all
    for x, y, w, h in LABELS:
        for px in range(x - PAD, x + w + PAD):
            tx, ty = 1.0, float(np.interp(px, outer_x, outer_s))
            norm = np.hypot(tx, ty)
            tx, ty = tx / norm, ty / norm
            for py in range(max(0, y - PAD), min(img_h, y + h + PAD)):
                if mask[py, px] == 0:
                    continue
                oy = edge_at(outer_x, outer_y, px)
                if py < oy - 2:
                    continue  # 天空区走按行插值
                for dist in (190, 250, 310, 370, 430):
                    sx, sy = int(round(px + tx * dist)), int(round(py + ty * dist))
                    if 0 <= sx < img_w and 0 <= sy < img_h and not label_all[max(0, sy - 8):sy + 8, max(0, sx - 8):sx + 8].any():
                        donor[py, px] = data[sy, sx]
                        break

    # 局部亮度匹配（排除文字区做归一化均值）
    wgt = (1 - mask).astype(np.float32)
    blur_recip = cv2.GaussianBlur(out * wgt[:, :, None], (0, 0), 21) / np.maximum(cv2.GaussianBlur(wgt, (0, 0), 21), 1e-3)[:, :, None]
    blur_donor = cv2.GaussianBlur(donor * wgt[:, :, None], (0, 0), 21) / np.maximum(cv2.GaussianBlur(wgt, (0, 0), 21), 1e-3)[:, :, None]
    gain = np.clip(blur_recip / np.maximum(blur_donor, 1), 0.72, 1.38)
    donor_matched = np.clip(donor * gain, 0, 255)

    # 天空区：按行在左右真实天空间插值
    sky_fill = data.copy()
    for x, y, w, h in LABELS:
        for py in range(max(0, y - PAD), min(img_h, y + h + PAD)):
            row_mask = mask[py, x - PAD:x + w + PAD] > 0
            if not row_mask.any():
                continue
            left = right = None
            for gx in range(x - PAD - 1, 0, -1):
                if mask[py, gx] == 0 and not label_all[py, gx]:
                    left = data[py, gx]
                    break
            for gx in range(x + w + PAD, img_w):
                if mask[py, gx] == 0 and not label_all[py, gx]:
                    right = data[py, gx]
                    break
            span = np.arange(x - PAD, x + w + PAD)
            if left is None and right is None:
                continue
            if left is None:
                sky_fill[py, x - PAD:x + w + PAD] = right
            elif right is None:
                sky_fill[py, x - PAD:x + w + PAD] = left
            else:
                t = (span - left[0] if False else (span - (x - PAD)) / max(1, (x + w + PAD) - (x - PAD)))
                sky_fill[py, x - PAD:x + w + PAD] = left * (1 - t)[:, None] + right * t[:, None]

    # 合成：天空区用 sky_fill，玻璃区用亮度匹配后的供体，羽化过渡
    sky_zone = np.zeros((img_h, img_w), dtype=np.float32)
    for px in range(img_w):
        if px not in outer_x:
            continue
        oy = int(edge_at(outer_x, outer_y, px))
        sky_zone[max(0, oy - 3):, px] = 0.0
        sky_zone[:max(0, oy - 3), px] = 1.0
    alpha = (mask * 0.6 + 0.4) * sky_zone
    glass_alpha = mask * (1 - sky_zone)
    out = sky_fill * alpha[:, :, None] + donor_matched * glass_alpha[:, :, None] + out * (1 - np.clip(alpha + glass_alpha, 0, 1))[:, :, None]
    out = np.clip(out, 0, 255).astype(np.uint8)

    # 轻度羽化消除掩膜边界的生硬感
    soft = cv2.GaussianBlur(mask, (0, 0), 1.2)[:, :, None]
    smooth = cv2.GaussianBlur(out, (0, 0), 2.2)
    out = np.clip(out * (1 - soft) + smooth * soft, 0, 255).astype(np.uint8)

    cv2.imwrite(str(TARGET), out)
    print(f"已写出 {TARGET}")


if __name__ == "__main__":
    main()
