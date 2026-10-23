#!/usr/bin/env python3
"""生成 Google Play 商店素材：应用图标 512×512 与 Feature Graphic 1024×500。

Play 对这两张有硬性尺寸/格式要求（PNG/JPEG，图标必须正好 512×512，
Feature Graphic 必须 1024×500 且不能有边框、不能放"下载/安装"字样）。

用法：python scripts/gen-play-assets.py
产物：store/play/icon-512.png、store/play/feature-graphic-1024x500.png
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_ICON = ROOT / "apps/mobile/assets/icon.png"
OUT = ROOT / "store/play"

# 品牌色（与 app.json 的 splash/adaptiveIcon 背景色一致）
BRAND = (59, 130, 246)
BRAND_DEEP = (30, 64, 175)
INK = (255, 255, 255)

CJK_FONTS = [
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
]


def cjk_font(size: int) -> ImageFont.FreeTypeFont:
    for path in CJK_FONTS:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_icon() -> None:
    """Play 要求正好 512×512 的 PNG（不能带透明圆角，Play 自己裁）。"""
    icon = Image.open(SRC_ICON).convert("RGB").resize((512, 512), Image.LANCZOS)
    icon.save(OUT / "icon-512.png", "PNG", optimize=True)


def make_feature() -> None:
    """1024×500，中心区域（428px 宽）放最重要的信息 —— Play 各处会裁切。"""
    w, h = 1024, 500
    img = Image.new("RGB", (w, h), BRAND)
    draw = ImageDraw.Draw(img)

    # 底色渐变：左上偏亮，右下偏深，避免纯色板结感
    for y in range(h):
        t = y / h
        for_x = (int(BRAND[0] * (1 - t) + BRAND_DEEP[0] * t),
                 int(BRAND[1] * (1 - t) + BRAND_DEEP[1] * t),
                 int(BRAND[2] * (1 - t) + BRAND_DEEP[2] * t))
        draw.line([(0, y), (w, y)], fill=for_x)

    # 右侧两团柔光，给纯色背景一点层次（不抢文字）
    glow = Image.new("RGB", (w, h), BRAND)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([w - 420, -180, w + 120, 360], fill=(96, 165, 250))
    gd.ellipse([w - 260, 200, w + 200, 660], fill=(37, 99, 235))
    glow = glow.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(90))
    img = Image.blend(img, glow, 0.35)
    draw = ImageDraw.Draw(img)

    # 左侧应用图标（120px，圆角 + 白色描边，让它在蓝底上"立"起来）
    s = 148
    pad = 12
    icon = Image.open(SRC_ICON).convert("RGB").resize((s, s), Image.LANCZOS)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=34, fill=255)
    plate = Image.new("RGB", (s + pad * 2, s + pad * 2), INK)
    plate.paste(icon, (pad, pad), mask)
    pmask = Image.new("L", plate.size, 0)
    ImageDraw.Draw(pmask).rounded_rectangle([0, 0, plate.size[0] - 1, plate.size[1] - 1], radius=44, fill=255)
    img.paste(plate, (86, (h - plate.size[1]) // 2), pmask)

    x = 86 + plate.size[0] + 56
    title_font = cjk_font(76)
    tag_font = cjk_font(34)
    sub_font = cjk_font(26)

    draw.text((x, 150), "TalkFirst", font=cjk_font(80), fill=INK)
    draw.text((x, 258), "先聊聊，再成为朋友", font=tag_font, fill=(219, 234, 254))
    draw.text((x, 310), "Talk first, then be friends", font=sub_font, fill=(191, 219, 254))

    img.save(OUT / "feature-graphic-1024x500.png", "PNG", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_icon()
    make_feature()
    for name in ("icon-512.png", "feature-graphic-1024x500.png"):
        p = OUT / name
        with Image.open(p) as im:
            print(f"{name}: {im.size[0]}x{im.size[1]}, {p.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
