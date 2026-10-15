"""生成 Google Play 商店页需要的图片素材（可重复运行，产物直接进仓库）。

Play 的硬性尺寸（核对自 Play Console 的素材要求）：

  - 应用图标 512×512、32 位 PNG（可带 alpha）
  - Feature graphic 1024×500、**24 位 PNG 或 JPEG（不能带 alpha）**

截图**不在这里生成**：必须来自真实运行的 App（见同目录 README）。

用法：python docs/play-assets/make-assets.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ICON_SRC = ROOT / "apps/mobile" / "assets" / "icon.png"

# 取自 apps/mobile/src/theme.ts，别在这里另写一套色值。
PRIMARY = (107, 124, 255)  # colors.primary
WATERMARK = (255, 255, 255)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    """Windows 自带字体；找不到就退回默认位图字体（仍能出图，只是不好看）。"""
    names = ["seguisb.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
    for name in names:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def build_icon() -> None:
    """512×512 图标：直接用 App 的图标等比缩放。"""
    out = HERE / "icon-512.png"
    Image.open(ICON_SRC).convert("RGBA").resize((512, 512), Image.LANCZOS).save(out)
    print(f"icon   -> {out.name} 512x512")


def build_feature_graphic() -> None:
    """1024×500 横幅：品牌底色 + 产品名 + 一句话说明。

    刻意保持克制：一块底色、一行字、一行副标题。商店页上它旁边就是截图，
    横幅再花哨只会互相打架。
    """
    width, height = 1024, 500
    image = Image.new("RGB", (width, height), PRIMARY)
    draw = ImageDraw.Draw(image)

    # 右下角一个很淡的圆形光晕，避免整张纯色板看起来像没做完。
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [width - 360, height - 300, width + 160, height + 220], fill=(*WATERMARK, 26)
    )
    image = Image.alpha_composite(image.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(image)

    draw.text((76, 132), "TalkFirst", font=font(104), fill=WATERMARK)
    draw.text(
        (80, 268),
        "Language exchange, real conversations",
        font=font(36, bold=False),
        fill=WATERMARK,
    )
    draw.text((82, 336), "talkfirst.ccwu.cc", font=font(26, bold=False), fill=(230, 233, 255))

    out = HERE / "feature-graphic-1024x500.png"
    image.save(out)  # RGB → 24 位，无 alpha（Play 不接受带 alpha 的横幅）
    print(f"banner -> {out.name} 1024x500")


if __name__ == "__main__":
    build_icon()
    build_feature_graphic()
