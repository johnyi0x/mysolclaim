from PIL import Image, ImageDraw
from pathlib import Path

PINK = (255, 143, 175, 255)
DARK = (230, 75, 130, 255)
BLACK = (17, 17, 17, 255)
SLOT = (10, 10, 10, 255)


def draw_piggy(size: int) -> Image.Image:
    g = 64
    img = Image.new("RGBA", (g, g), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fat classic piggy body
    d.ellipse([8, 20, 52, 50], fill=PINK, outline=BLACK, width=2)

    # Legs
    d.rectangle([16, 46, 24, 56], fill=DARK, outline=BLACK, width=1)
    d.rectangle([34, 46, 42, 56], fill=DARK, outline=BLACK, width=1)

    # Snout
    d.ellipse([44, 30, 58, 42], fill=DARK, outline=BLACK, width=2)
    d.rectangle([49, 34, 51, 37], fill=BLACK)
    d.rectangle([53, 34, 55, 37], fill=BLACK)

    # Ear
    d.polygon([(14, 24), (20, 10), (28, 22)], fill=PINK, outline=BLACK)
    d.polygon([(17, 22), (20, 14), (25, 21)], fill=DARK)

    # Eye
    d.rectangle([26, 30, 29, 33], fill=BLACK)

    # Coin slot hole on the back/top — the piggy-bank signature
    d.rectangle([20, 16, 40, 22], fill=BLACK)
    d.rectangle([22, 17, 38, 21], fill=SLOT)
    d.rectangle([23, 18, 37, 19], fill=(55, 55, 55, 255))

    # Tail
    d.arc([2, 32, 14, 44], start=220, end=50, fill=BLACK, width=2)

    return img.resize((size, size), Image.NEAREST)


public = Path(__file__).resolve().parents[1] / "public"
public.mkdir(exist_ok=True)

for name, sz in [("piggy.png", 512), ("piggy-x.png", 1024), ("piggy-64.png", 64)]:
    im = draw_piggy(sz)
    im.save(public / name)
    print(name, "corner_alpha=", im.getpixel((0, 0))[3])

(public / "favicon.svg").write_text(
    """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">
  <ellipse cx="15" cy="18" rx="10" ry="8" fill="#ff8faf" stroke="#111" stroke-width="1.5"/>
  <rect x="9" y="23" width="4" height="5" fill="#e64b82" stroke="#111"/>
  <rect x="17" y="23" width="4" height="5" fill="#e64b82" stroke="#111"/>
  <ellipse cx="25" cy="18" rx="4" ry="3" fill="#e64b82" stroke="#111" stroke-width="1.2"/>
  <rect x="24" y="17" width="1" height="2" fill="#111"/>
  <rect x="26" y="17" width="1" height="2" fill="#111"/>
  <polygon points="8,14 11,6 15,13" fill="#ff8faf" stroke="#111"/>
  <rect x="12" y="15" width="2" height="2" fill="#111"/>
  <rect x="10" y="8" width="10" height="3" fill="#111"/>
  <rect x="11" y="9" width="8" height="1" fill="#333"/>
</svg>
""",
    encoding="utf-8",
)
print("done", public)
