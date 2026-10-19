#!/usr/bin/env python3
"""生成站点默认社交分享图 public/og.png（1200x630）。

依赖 Pillow 与 macOS 自带中文字体：
    python3 scripts/generate-og-image.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 630
BACKGROUND = (14, 21, 20)
GLOW = (40, 96, 82)
ACCENT = (216, 255, 62)
INK = (238, 243, 241)
MUTED = (127, 139, 135)

CJK_FONT_CANDIDATES = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 1),
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/System/Library/Fonts/Songti.ttc", 1),
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 0),
]
LATIN_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
    "/System/Library/Fonts/Supplemental/Futura.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_cjk(size: int) -> ImageFont.FreeTypeFont:
    for path, index in CJK_FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size=size, index=index)
    raise SystemExit("找不到可用的中文字体")


def load_latin(size: int) -> ImageFont.FreeTypeFont:
    for path in LATIN_FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size=size)
    raise SystemExit("找不到可用的西文字体")


def draw_glow(image: Image.Image) -> None:
    """在右上角叠一层径向光晕，避免整块纯色背景。"""
    glow = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    pixels = glow.load()
    center_x, center_y, radius = WIDTH * 0.78, HEIGHT * 0.1, WIDTH * 0.62
    for y in range(HEIGHT):
        for x in range(WIDTH):
            distance = ((x - center_x) ** 2 + (y - center_y) ** 2) ** 0.5
            ratio = max(0.0, 1 - distance / radius) ** 2
            pixels[x, y] = tuple(
                int(background + (glow_color - background) * ratio)
                for background, glow_color in zip(BACKGROUND, GLOW)
            )
    image.paste(glow, (0, 0))


TITLE = "江城图志"
SUBTITLE = "JIANGCHENG ATLAS"
TAGLINE = "沿江穿城，发现武汉值得抵达、停留与讲述的城市坐标"
FOOTER = "atlas.sololeveling.top"


def main() -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    image = image.convert("RGB")
    draw_glow(image)

    draw = ImageDraw.Draw(image)
    margin = 96

    # 品牌标记：圆角方块 + “江”字
    mark_box = (margin, 92, margin + 100, 192)
    draw.rounded_rectangle(mark_box, radius=24, fill=(23, 63, 58))
    mark_font = load_cjk(54)
    draw.text(
        (mark_box[0] + 50, mark_box[1] + 52),
        "江",
        font=mark_font,
        fill=ACCENT,
        anchor="mm",
    )

    title_font = load_cjk(108)
    draw.text((margin, 330), TITLE, font=title_font, fill=INK, anchor="ls")

    subtitle_font = load_latin(30)
    draw.text((margin + 6, 374), SUBTITLE, font=subtitle_font, fill=ACCENT, anchor="ls")

    tagline_font = load_cjk(30)
    draw.text((margin, 452), TAGLINE, font=tagline_font, fill=MUTED, anchor="ls")

    draw.line((margin, 506, WIDTH - margin, 506), fill=(38, 58, 54), width=2)
    footer_font = load_latin(24)
    draw.text((margin, 546), FOOTER, font=footer_font, fill=MUTED, anchor="ls")

    category_font = load_cjk(22)
    draw.text(
        (WIDTH - margin, 546),
        "地标 · 江湖 · 人文 · 街区 · 高校 · 美食",
        font=category_font,
        fill=(90, 106, 101),
        anchor="rs",
    )

    target = pathlib.Path(__file__).resolve().parent.parent / "public" / "og.png"
    image.save(target, format="PNG", optimize=True)
    print(f"wrote {target} ({target.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
