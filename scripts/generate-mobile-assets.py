"""按设计体系生成 mobile 的三张静态资源（C10）。

图形语言：一个白色对话气泡，里面三个「正在输入」的点 —— 对应产品名 TalkFirst
（先聊起来）。三个点在实底图标上是镂空（露出底色），在自适应图标前景层上是
真·透明，由 Android 用 app.json 的 backgroundColor 合成。只用两个 token：
brand-500 (#3B82F6) 与白。

用法：python scripts/generate-mobile-assets.py
输出：apps/mobile/assets/{icon,adaptive-icon,splash}.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BRAND = (0x3B, 0x82, 0xF6)          # brand-500
WHITE = (0xFF, 0xFF, 0xFF)
OUT = Path("apps/mobile/assets")
SS = 4                                # 超采样倍数

# 归一化几何（0..1，相对于图形所占的正方形）
BUBBLE = (0.13, 0.16, 0.97, 0.70)     # x0,y0,x1,y1
BUBBLE_R = 0.16                       # 圆角半径
TAIL = ((0.18, 0.66), (0.42, 0.66), (0.10, 0.95))
DOTS = ((0.35, 0.43, 0.062), (0.55, 0.43, 0.062), (0.75, 0.43, 0.062))


def draw_mark(img: Image.Image, cx: float, cy: float, box: float, dot_fill, scale: float) -> None:
    """把图形画到 img 上；dot_fill 为 None 时把三个点打成全透明。"""
    d = ImageDraw.Draw(img)
    half = box * scale / 2

    def px(u: float, v: float) -> tuple[float, float]:
        return (cx + (u - 0.5) * 2 * half, cy + (v - 0.5) * 2 * half)

    x0, y0 = px(BUBBLE[0], BUBBLE[1])
    x1, y1 = px(BUBBLE[2], BUBBLE[3])
    d.rounded_rectangle((x0, y0, x1, y1), radius=BUBBLE_R * 2 * half, fill=WHITE)
    d.polygon([px(u, v) for u, v in TAIL], fill=WHITE)

    for u, v, r in DOTS:
        dx, dy = px(u, v)
        rr = r * 2 * half
        if dot_fill is None:
            d.ellipse((dx - rr, dy - rr, dx + rr, dy + rr), fill=(0, 0, 0, 0))
        else:
            d.ellipse((dx - rr, dy - rr, dx + rr, dy + rr), fill=dot_fill)


def downscale(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return img.resize(size, Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # 1) icon.png —— 1024²，实底，不透明（iOS 与 Android 共用；iOS 不接受透明）
    big = Image.new("RGB", (1024 * SS, 1024 * SS), BRAND)
    draw_mark(big, 512 * SS, 512 * SS, 1024 * SS, BRAND, 0.62)
    downscale(big, (1024, 1024)).convert("RGB").save(OUT / "icon.png")

    # 2) adaptive-icon.png —— 1024²，透明底，图形收在 Android 安全区内
    #    安全区是以中心为圆心、直径 676px 的圆；图形半对角线必须 ≤ 338，故取 0.50。
    big = Image.new("RGBA", (1024 * SS, 1024 * SS), (0, 0, 0, 0))
    draw_mark(big, 512 * SS, 512 * SS, 1024 * SS, None, 0.50)
    downscale(big, (1024, 1024)).save(OUT / "adaptive-icon.png")

    # 3) splash.png —— 1284×2778，实底，图案居中、字标在下
    big = Image.new("RGB", (1284 * SS, 2778 * SS), BRAND)
    draw_mark(big, 642 * SS, 1150 * SS, 1284 * SS, BRAND, 0.40)
    d = ImageDraw.Draw(big)
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 150 * SS)
    text = "TalkFirst"
    left, top, right, bottom = d.textbbox((0, 0), text, font=font)
    d.text((642 * SS - (right - left) / 2 - left, 1520 * SS - top), text, font=font, fill=WHITE)
    downscale(big, (1284, 2778)).convert("RGB").save(OUT / "splash.png")

    print("已生成 icon.png / adaptive-icon.png / splash.png")


if __name__ == "__main__":
    main()
