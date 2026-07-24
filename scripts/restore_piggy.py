"""
Restore original piggy brand assets from the first GenerateImage version.

Source of truth:
  ..\\.cursor\\projects\\c-Users-oldca-Downloads-sol-reclaim\\assets\\piggy-bank-pixel.png
  (or any path passed as argv[1])

Writes:
  public/piggy.png   — site logo / apple icon
  public/piggy-x.png — X/Twitter profile picture (same art)
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DEFAULT_SRC = Path(
    r"C:\Users\oldca\.cursor\projects\c-Users-oldca-Downloads-sol-reclaim\assets\piggy-bank-pixel.png"
)


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        raise SystemExit(f"Missing original piggy asset: {src}")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name in ("piggy.png", "piggy-x.png"):
        dst = PUBLIC / name
        shutil.copyfile(src, dst)
        print(f"wrote {dst} ({dst.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
