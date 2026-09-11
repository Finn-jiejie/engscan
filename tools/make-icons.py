# -*- coding: utf-8 -*-
"""生成 engscan 的 PWA 图标（纯 PIL，无外部素材）。

设计：墨色圆角底 + 米色文字行 + 蓝色播放圆点，远远看一眼就知道是"扫描 + 朗读"。
输出：icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')

INK = (35, 33, 29, 255)        # #23211d
CREAM = (247, 246, 242, 255)   # #f7f6f2
CREAM_DIM = (247, 246, 242, 150)
BLUE = (47, 111, 176, 255)     # #2f6fb0
WHITE = (255, 255, 255, 255)


def rounded(size, radius_ratio, fill):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=fill)
    return img


def draw_glyph(img, size, scale=1.0):
    """在给定画布上画内容。scale<1 时为 maskable 安全区留白。"""
    d = ImageDraw.Draw(img)
    s = size * scale
    off = (size - s) / 2.0
    u = s / 100.0  # 1 单位 = 画布 1%

    def X(v):
        return off + v * u

    # 三条"文字行"，越往下越短，模拟书页被阅读的节奏
    lines = [(26, 22, 72), (26, 39, 78), (26, 56, 61)]
    lh = 7.6 * u
    for i, (x, y, w) in enumerate(lines):
        col = CREAM if i == 0 else CREAM_DIM
        d.rounded_rectangle(
            [X(x), X(y), X(x + w), X(y) + lh],
            radius=lh / 2,
            fill=col,
        )

    # 右下角播放圆点
    cx, cy, r = X(74), X(74), 13 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE)
    t = r * 0.46
    d.polygon(
        [(cx - t * 0.72, cy - t), (cx - t * 0.72, cy + t), (cx + t * 0.95, cy)],
        fill=WHITE,
    )
    return img


def make(size, radius_ratio, scale, path, corner_alpha=True):
    if corner_alpha and radius_ratio > 0:
        img = rounded(size, radius_ratio, INK)
    else:
        img = Image.new('RGBA', (size, size), INK)
    draw_glyph(img, size, scale)
    # 圆角的保留 alpha（系统主题底色各异，透明比黑角好看）；全出血的压平即可
    img = img if corner_alpha else img.convert('RGB')
    img.save(path, 'PNG', optimize=True)
    print('wrote', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    make(192, 0.22, 1.0, os.path.join(OUT, 'icon-192.png'))
    make(512, 0.22, 1.0, os.path.join(OUT, 'icon-512.png'))
    # maskable：全出血底 + 内容缩进到安全区（80%）
    make(512, 0.0, 0.78, os.path.join(OUT, 'icon-maskable-512.png'), corner_alpha=False)
    # iOS 自己会切圆角，所以给全出血方图
    make(180, 0.0, 0.92, os.path.join(OUT, 'apple-touch-icon.png'), corner_alpha=False)
