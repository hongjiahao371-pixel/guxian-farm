# -*- coding: utf-8 -*-
"""
按色相把纯品红平涂底抠成透明 PNG。

为什么用「品红」而不是红/绿/蓝：
  人物固有色是赭石、藤黄、花青、淡墨、暖白——全是低饱和的暖色和蓝灰，
  唯一的高饱和品红色就属于背景。M = min(R,B) - G 这一项在品红底上约 +122，
  在赭石/藤黄/花青/暖白/浓墨上分别是 -60 / -90 / -30 / -5 / -140，
  两簇之间有一条很宽的空档，判定稳。

为什么要做 un-blend（去底色）：
  抗锯齿边缘像素是 底色×(1-a) + 主体×a 的混合。若只把 alpha 设出来而不还原 RGB，
  边缘会残留品红，贴到暖褐底图上就是一圈粉边。这里按已知的均匀底色逐通道反解。

用法: python key-figure.py <in.jpg> <out.png> [threshold]
"""
import os
import sys
import numpy as np
from PIL import Image


def _shift(a, dy, dx, fill=0.0):
    """把数组沿 (dy,dx) 平移，越界处填 fill（不能用 np.roll，会从另一头绕回来）。

    dy=1 表示内容整体下移一行：out[1:] = a[:-1]。"""
    out = np.full_like(a, fill)
    H, W = a.shape[:2]
    src_y = slice(max(0, -dy), H - max(0, dy))
    dst_y = slice(max(0, dy), H - max(0, -dy))
    src_x = slice(max(0, -dx), W - max(0, dx))
    dst_x = slice(max(0, dx), W - max(0, -dx))
    out[dst_y, dst_x] = a[src_y, src_x]
    return out


def despeckle_edge_chroma(rgb, alpha, thresh=12.0, passes=2):
    """把轮廓带上仍带品红、但 alpha 未到 0 的像素，用邻近实心像素的颜色回填。"""
    out = rgb.copy()
    for _ in range(passes):
        M = np.minimum(out[:, :, 0], out[:, :, 2]) - out[:, :, 1]
        bad = (M > thresh) & (alpha > 0.25) & (alpha < 0.92)
        if not bad.any():
            break
        solid = (alpha > 0.6) & ~bad
        acc = np.zeros_like(out)
        cnt = np.zeros(alpha.shape)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            acc += _shift(out * solid[:, :, None], dy, dx, 0.0)
            cnt += _shift(solid.astype(np.float64), dy, dx, 0.0)
        fillable = bad & (cnt > 0)
        if not fillable.any():
            break
        out[fillable] = acc[fillable] / cnt[fillable][:, None]
    return out


def resize_premultiplied(img, target_h):
    """按目标高度缩放。

    必须先预乘 alpha 再缩放：直接缩放 RGBA 时，全透明区域的 RGB 仍留着底色，
    LANCZOS 会把它和邻近边缘混在一起，缩小后就是一圈彩边。"""
    w, h = img.size
    if not target_h or h == target_h:
        return img
    a = np.asarray(img).astype(np.float64)
    al = a[:, :, 3:4] / 255.0
    pm = np.dstack([a[:, :, :3] * al, a[:, :, 3:4]])   # 预乘
    im = Image.fromarray(np.clip(pm, 0, 255).astype(np.uint8), "RGBA")
    nw = max(1, int(round(w * target_h / float(h))))
    im = im.resize((nw, target_h), Image.LANCZOS)
    a = np.asarray(im).astype(np.float64)
    al = a[:, :, 3:4] / 255.0
    safe = np.where(al > 1e-4, al, 1.0)
    rgb = np.clip(a[:, :, :3] / safe, 0, 255)
    rgb = np.where(al > 1e-4, rgb, a[:, :, :3])
    return Image.fromarray(np.dstack([rgb, a[:, :, 3:4]]).astype(np.uint8), "RGBA")


def unkey(path, out, bg_from_border=14, edge_boost=0.0, crop=True, pad=6,
          target_h=None):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float64)
    H, W, _ = a.shape

    # 1) 从四边一圈像素取中位数，量出这张图的"标准底色"
    band = np.concatenate([
        a[:bg_from_border].reshape(-1, 3), a[-bg_from_border:].reshape(-1, 3),
        a[:, :bg_from_border].reshape(-1, 3), a[:, -bg_from_border:].reshape(-1, 3),
    ])
    bg = np.median(band, axis=0)
    bgM = min(bg[0], bg[2]) - bg[1]
    if bgM < 40:
        raise SystemExit("底色不够接近品红(M=%.1f)，这张图不能用此法：%s" % (bgM, path))

    # 2) 品红度 -> 主体不透明度。方向别搞反：品红度越低越像主体，背景才是最高的。
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    M = np.minimum(R, B) - G
    alpha = np.clip((bgM - M) / bgM + edge_boost, 0.0, 1.0)
    # 阈值化掉噪声底，同时保住中间调
    alpha = np.where(alpha < 0.04, 0.0, alpha)
    alpha = np.where(alpha > 0.0, np.clip((alpha - 0.04) / (1.0 - 0.04), 0.0, 1.0), 0.0)

    # 3) un-blend：P = a*S + (1-a)*Bg  =>  S = (P - (1-a)*Bg) / a
    m = alpha > 0.06
    S = a.copy()
    S[m] = (a[m] - (1.0 - alpha[m])[:, None] * bg[None, :]) / alpha[m][:, None]
    # 还原过头（算出负分量或超界）时退回原像素，避免主体边缘发黑
    bad = m & ((S < -6).any(axis=2) | (S > 255).any(axis=2))
    S[bad] = a[bad]
    S = np.clip(S, 0, 255)
    # 极低 alpha 的像素颜色不可信，直接拉到最近的实心像素色（避免彩边）
    lo = m & (alpha <= 0.25)
    if lo.any():
        S[lo] = a[lo]

    outa = np.dstack([S, alpha * 255.0])
    img = Image.fromarray(outa.astype(np.uint8), "RGBA")

    # 3.5) JPEG 4:2:0 色度渗染会让轮廓带的品红度偏高 -> 上面算出的 alpha 偏低
    #      -> un-blend 扣不干净，残留一圈品红。用邻近实心像素把这条带子回填掉。
    outa[:, :, :3] = despeckle_edge_chroma(outa[:, :, :3], outa[:, :, 3] / 255.0)
    img = Image.fromarray(outa.astype(np.uint8), "RGBA")

    if crop:
        ys, xs = np.nonzero(alpha > 0.5)
        if len(ys):
            y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
            x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
            img = img.crop((x0, y0, x1, y1))

    if target_h:
        img = resize_premultiplied(img, target_h)

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out, "PNG", optimize=True)

    # 4) 实测验收：残品红 / 主体误抠 / 尺寸
    arr = np.asarray(img).astype(np.float64)
    al = arr[:, :, 3] / 255.0
    vis = arr[:, :, :3][al > 0.25]
    vM = np.minimum(vis[:, 0], vis[:, 2]) - vis[:, 1]
    body = arr[:, :, :3][al > 0.95]
    bM = np.minimum(body[:, 0], body[:, 2]) - body[:, 1] if len(body) else np.array([0.0])
    cov = float((al > 0.5).mean())
    print("底色 RGB=%s  bgM=%.1f" % (tuple(int(x) for x in bg), bgM))
    print("输出 %s  %s  %d 字节" % (out, img.size, os.path.getsize(out)))
    print("  覆盖 %.1f%%   不透明像素 %d" % (cov * 100, len(body)))
    print("  可见像素品红度 max=%.1f  均值=%.1f  >20 的像素 %d 个" %
          (vM.max(), vM.mean(), int((vM > 20).sum())))
    print("  实心区品红度 max=%.1f  >20 的像素 %d 个" % (bM.max(), int((bM > 20).sum())))
    return img


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    eb = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    th = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "0" else None
    unkey(src, dst, edge_boost=eb, target_h=th)
