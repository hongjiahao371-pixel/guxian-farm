# -*- coding: utf-8 -*-
"""抠图管线总入口：抠品红底 -> 缩到 344px -> 输出 assets/figs/<id>.png"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import keymag  # noqa: E402

D = os.path.dirname(os.path.abspath(__file__))
OUT_H = 288          # 游戏里最高画 165px（1.1*150）；288 留 1.74x 余量，再大只是浪费包体

# (源文件名, 贴图 id) —— 贴图 id 必须和 data.js 里 FG.NPCS 的键一致
BATCH = [
    ("fig-linweng.jpg", "linweng"),
    ("fig-caiju.jpg", "caijuweng"),
    ("fig-xushi.jpg", "xushi"),
    ("fig-qiaofu.jpg", "qiaofu"),
    ("fig-caiyao.jpg", "caiyaoren"),
    ("fig-tongzi.jpg", "tongzi"),
    ("fig-a.jpg", "farmer"),
]

DEST = os.path.join(os.path.dirname(D), "pixel-farm", "guxian-farm", "assets", "figs")
os.makedirs(DEST, exist_ok=True)

only = sys.argv[1:] or None
for fname, figid in BATCH:
    if only and figid not in only:
        continue
    src = os.path.join(D, fname)
    if not os.path.exists(src):
        print("!! missing source %s" % fname)
        continue
    try:
        keymag.unkey(src, os.path.join(DEST, figid + ".png"), target_h=OUT_H)
    except SystemExit as e:
        print("!! %s failed: %s" % (figid, e))
