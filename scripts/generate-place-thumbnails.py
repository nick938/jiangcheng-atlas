#!/usr/bin/env python3
"""生成 public/places/ 的详情图缩略图。

背景：原图单张 237–632 KB，但地图详情卡的图片色带只有 98px 高、
独立详情页 hero 约 296px 高（移动端 218px）。这里生成 320/640 两档，
页面用 <img srcset>/background-image 按需选择。

用法：
    # 用环境里的 Pillow（任意 python3 + Pillow 均可）
    python3 scripts/generate-place-thumbnails.py
    python3 scripts/generate-place-thumbnails.py --widths 320 640 --quality 78

特性：
  * 幂等可重复执行：源图没变就跳过（比较 mtime），--force 可强制重建。
  * 只新增文件，不删除也不覆盖 public/places/ 下的原图。
  * 同时输出 .jpg 与 .webp（webp 更小，留给后续按 Accept 头协商使用）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 环境缺 Pillow 时给出明确提示
    sys.exit("需要 Pillow：pip install Pillow（或使用仓库环境里的 python3）")

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = REPO_ROOT / "public" / "places"
THUMB_DIR_NAME = "thumbs"
SOURCE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".avif"}


def iter_sources() -> list[Path]:
    if not SOURCE_DIR.is_dir():
        return []
    return sorted(
        path
        for path in SOURCE_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES
    )


def build_thumb(source: Path, target: Path, width: int, quality: int, force: bool) -> str:
    if (
        not force
        and target.exists()
        and target.stat().st_mtime >= source.stat().st_mtime
    ):
        return "skip"

    with Image.open(source) as image:
        image = image.convert("RGB")
        if image.width <= width:
            # 原图比目标还窄（或一样宽）：直接等比缩放没有意义，按原宽度输出即可。
            resized = image
        else:
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.LANCZOS)

        target.parent.mkdir(parents=True, exist_ok=True)
        if target.suffix == ".webp":
            resized.save(target, "WEBP", quality=quality, method=6)
        else:
            resized.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
    return "write"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--widths", type=int, nargs="+", default=[320, 640])
    parser.add_argument("--quality", type=int, default=78)
    parser.add_argument("--force", action="store_true", help="忽略 mtime，全部重建")
    args = parser.parse_args()

    sources = iter_sources()
    if not sources:
        print(f"没有在 {SOURCE_DIR} 找到源图，退出。")
        return 0

    thumb_dir = SOURCE_DIR / THUMB_DIR_NAME
    written = skipped = 0
    total_before = total_after = 0

    for source in sources:
        before = source.stat().st_size
        total_before += before
        for width in args.widths:
            for suffix in (".jpg", ".webp"):
                target = thumb_dir / f"{source.stem}-{width}{suffix}"
                result = build_thumb(source, target, width, args.quality, args.force)
                if result == "write":
                    written += 1
                    size = target.stat().st_size
                    total_after += size
                    print(f"  {target.relative_to(REPO_ROOT)}  {size / 1024:.1f} KB")
                else:
                    skipped += 1
                    total_after += target.stat().st_size
        print(f"{source.name}: {before / 1024:.1f} KB → {args.widths[0]}px 缩略图")

    print(
        f"\n完成：新增/更新 {written} 个文件，跳过 {skipped} 个（源图未变）。"
        f"输出目录 {thumb_dir.relative_to(REPO_ROOT)}。原图未改动。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
