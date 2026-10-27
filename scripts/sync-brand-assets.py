#!/usr/bin/env python3
"""把品牌图标同步到各处（2026-10-28）。

输入（设计交付物，放在下载目录）：
  talkfirst-icon-android-safe.png   1024×1024，满幅品牌蓝 + 白色笑脸弧环，内容占 70%（Android 安全区）
  SVG 矢量源文件.svg                 1024×1024 矢量源

产出：
  store/brand/talkfirst-icon.svg     矢量源入库（以后改图标从这里改）
  apps/mobile/assets/icon.png        应用图标（满幅，1024）
  apps/mobile/assets/adaptive-icon.png  自适应图标**前景**（蓝底抠成透明，只留白色图案）
  apps/mobile/assets/splash.png      启动图 1284×2778（新品牌蓝 + 圆角图标）
  store/play/icon-512.png            Play 商店图标 512×512
  apps/web/src/app/icon.png          网页图标 512（Next App Router 约定）
  apps/web/src/app/apple-icon.png    180
  apps/web/src/app/favicon.ico       32 + 16

为什么抠透明而不是直接缩放：Android 自适应图标的前景层必须透明，背景色由
app.json 的 adaptiveIcon.backgroundColor 提供；把整张蓝底图当前景会得到一个
「蓝色方格里再套一张蓝底图」的双层效果。

用法：python scripts/sync-brand-assets.py
"""
from __future__ import annotations

import pathlib
import shutil

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = pathlib.Path("D:/Users/17366/Downloads")
SRC_PNG = SRC_DIR / "talkfirst-icon-android-safe.png"
SRC_SVG = SRC_DIR / "SVG 矢量源文件.svg"

BRAND = (11, 127, 255)          # #0B7FFF，取自 SVG
SPLASH_SIZE = (1284, 2778)


def load_icon() -> Image.Image:
    if not SRC_PNG.exists():
        raise SystemExit(f"找不到源图：{SRC_PNG}")
    return Image.open(SRC_PNG).convert("RGB")


def write_icon(icon: Image.Image) -> None:
    """满幅图标：手机桌面、商店、启动图都用它。"""
    icon.save(ROOT / "apps/mobile/assets/icon.png", "PNG", optimize=True)
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "store/play/icon-512.png", "PNG", optimize=True)
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "apps/web/src/app/icon.png", "PNG", optimize=True)
    icon.resize((180, 180), Image.LANCZOS).save(ROOT / "apps/web/src/app/apple-icon.png", "PNG", optimize=True)
    icon.save(ROOT / "apps/web/src/app/favicon.ico", sizes=[(32, 32), (16, 16)])


def write_adaptive_foreground(icon: Image.Image) -> None:
    """
    蓝底 → 透明。图案是纯白、底色是纯蓝，所以用红通道做 alpha：
    底色 r=11（几乎透明），图案 r=255（全不透明），抗锯齿边缘得到中间值。
    """
    rgb = icon.load()
    out = Image.new("RGBA", icon.size, (255, 255, 255, 0))
    dst = out.load()
    width, height = icon.size
    for y in range(height):
        for x in range(width):
            r = rgb[x, y][0]
            alpha = max(0, min(255, int((r - BRAND[0]) * 255 / (255 - BRAND[0]))))
            dst[x, y] = (255, 255, 255, alpha)
    out = out.crop(out.getbbox())
    # 自适应图标的安全区是 66dp/108dp ≈ 61%。源图内容占 70%，圆形遮罩会切到弧环尖端，
    # 所以缩到 62% 再居中留白。
    target = int(icon.size[0] * 0.62)
    scale = target / max(out.size)
    out = out.resize((max(1, int(out.size[0] * scale)), max(1, int(out.size[1] * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", icon.size, (255, 255, 255, 0))
    canvas.paste(out, ((canvas.size[0] - out.size[0]) // 2, (canvas.size[1] - out.size[1]) // 2), out)
    canvas.save(ROOT / "apps/mobile/assets/adaptive-icon.png", "PNG", optimize=True)


def write_splash(icon: Image.Image) -> None:
    """启动图：品牌蓝底 + 居中圆角图标（不用透明，避免不同设备的底色打架）。"""
    canvas = Image.new("RGB", SPLASH_SIZE, BRAND)
    side = 420
    glyph = icon.resize((side, side), Image.LANCZOS)
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, side - 1, side - 1], radius=96, fill=255)
    canvas.paste(glyph, ((SPLASH_SIZE[0] - side) // 2, (SPLASH_SIZE[1] - side) // 2 - 40), mask)
    canvas.save(ROOT / "apps/mobile/assets/splash.png", "PNG", optimize=True)


def main() -> None:
    brand_dir = ROOT / "store/brand"
    brand_dir.mkdir(parents=True, exist_ok=True)
    if SRC_SVG.exists():
        shutil.copyfile(SRC_SVG, brand_dir / "talkfirst-icon.svg")

    icon = load_icon()
    write_icon(icon)
    write_adaptive_foreground(icon)
    write_splash(icon)

    for rel in [
        "apps/mobile/assets/icon.png",
        "apps/mobile/assets/adaptive-icon.png",
        "apps/mobile/assets/splash.png",
        "store/play/icon-512.png",
        "apps/web/src/app/icon.png",
        "apps/web/src/app/apple-icon.png",
        "apps/web/src/app/favicon.ico",
        "store/brand/talkfirst-icon.svg",
    ]:
        path = ROOT / rel
        print(f"{rel:44} {path.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
