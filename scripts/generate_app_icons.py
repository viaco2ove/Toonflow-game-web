from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


WEB_ROOT = Path(__file__).resolve().parents[1]
ANDROID_RES = WEB_ROOT.parent / "Toonflow-game-android" / "app" / "src" / "main" / "res"
PUBLIC_DIR = WEB_ROOT / "public"
MASTER_DIR = WEB_ROOT / "src" / "assets" / "branding"


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(lerp(c1[0], c2[0], t)),
        int(lerp(c1[1], c2[1], t)),
        int(lerp(c1[2], c2[2], t)),
    )


def generate_master_icon(size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    deep = (9, 18, 39)
    blue = (22, 39, 77)
    violet = (77, 45, 127)
    glow = (255, 166, 83)

    cx = size * 0.72
    cy = size * 0.23
    max_d = math.hypot(size, size)
    for y in range(size):
        for x in range(size):
            d1 = math.hypot(x - cx, y - cy) / max_d
            d2 = math.hypot(x - size * 0.22, y - size * 0.84) / max_d
            base = blend(deep, blue, min(1.0, max(0.0, 1.15 - d1 * 2.2)))
            halo = blend(base, violet, min(1.0, max(0.0, 0.95 - d2 * 2.4)) * 0.45)
            px[x, y] = (*halo, 255)

    ribbon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ribbon)
    path_points_1 = []
    for i in range(0, 101):
        t = i / 100
        x = lerp(size * 0.08, size * 0.96, t)
        y = size * (0.68 - 0.34 * math.sin(t * math.pi * 0.95) - 0.06 * math.sin(t * math.pi * 3.2))
        path_points_1.append((x, y))
    path_points_2 = []
    for i in range(0, 101):
        t = i / 100
        x = lerp(size * 0.05, size * 0.98, t)
        y = size * (0.74 - 0.28 * math.sin(t * math.pi * 1.04) - 0.04 * math.cos(t * math.pi * 4.1))
        path_points_2.append((x, y))

    rd.line(path_points_1, fill=(255, 132, 96, 180), width=int(size * 0.16), joint="curve")
    rd.line(path_points_2, fill=(120, 180, 255, 130), width=int(size * 0.11), joint="curve")
    rd.line(path_points_1, fill=(255, 220, 170, 210), width=int(size * 0.04), joint="curve")
    rd.line(path_points_2, fill=(205, 235, 255, 185), width=int(size * 0.028), joint="curve")
    ribbon = ribbon.filter(ImageFilter.GaussianBlur(radius=size * 0.012))
    img = Image.alpha_composite(img, ribbon)

    stars = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    star_specs = [
        (0.18, 0.21, 0.006),
        (0.30, 0.77, 0.004),
        (0.48, 0.30, 0.005),
        (0.64, 0.58, 0.004),
        (0.84, 0.15, 0.005),
        (0.74, 0.78, 0.004),
    ]
    for sx, sy, sr in star_specs:
        r = size * sr
        x = size * sx
        y = size * sy
        sd.ellipse((x - r, y - r, x + r, y + r), fill=(255, 247, 225, 255))
        sd.line((x - r * 2.2, y, x + r * 2.2, y), fill=(255, 238, 206, 180), width=max(1, int(r * 0.5)))
        sd.line((x, y - r * 2.2, x, y + r * 2.2), fill=(255, 238, 206, 180), width=max(1, int(r * 0.5)))
    stars = stars.filter(ImageFilter.GaussianBlur(radius=size * 0.0018))
    img = Image.alpha_composite(img, stars)

    portal = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pd = ImageDraw.Draw(portal)
    box = (
        size * 0.22,
        size * 0.22,
        size * 0.78,
        size * 0.78,
    )
    pd.ellipse(box, fill=(255, 185, 96, 28))
    pd.ellipse(box, outline=(255, 196, 123, 255), width=int(size * 0.045))
    inner = (
        size * 0.31,
        size * 0.31,
        size * 0.69,
        size * 0.69,
    )
    pd.ellipse(inner, fill=(12, 23, 43, 220))
    portal = portal.filter(ImageFilter.GaussianBlur(radius=size * 0.004))
    img = Image.alpha_composite(img, portal)

    play = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    td = ImageDraw.Draw(play)
    tri = [
        (size * 0.44, size * 0.38),
        (size * 0.44, size * 0.62),
        (size * 0.63, size * 0.50),
    ]
    td.polygon(tri, fill=(255, 244, 231, 255))
    play = play.filter(ImageFilter.GaussianBlur(radius=size * 0.001))
    img = Image.alpha_composite(img, play)

    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size, size), radius=int(size * 0.23), fill=255)
    rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rounded.paste(img, (0, 0), mask)
    return rounded


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_web_icons(master: Image.Image) -> None:
    ensure_dir(PUBLIC_DIR)
    ensure_dir(MASTER_DIR)
    master.save(MASTER_DIR / "app-icon-master.png")
    master.resize((512, 512), Image.LANCZOS).save(PUBLIC_DIR / "favicon.png")
    master.resize((180, 180), Image.LANCZOS).save(PUBLIC_DIR / "apple-touch-icon.png")
    master.resize((32, 32), Image.LANCZOS).save(PUBLIC_DIR / "favicon-32x32.png")
    master.resize((16, 16), Image.LANCZOS).save(PUBLIC_DIR / "favicon-16x16.png")
    master.resize((48, 48), Image.LANCZOS).save(
        PUBLIC_DIR / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )


def save_android_icons(master: Image.Image) -> None:
    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, size in sizes.items():
        target = ANDROID_RES / folder
        ensure_dir(target)
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(target / "ic_launcher.png")
        resized.save(target / "ic_launcher_round.png")


def main() -> None:
    master = generate_master_icon()
    save_web_icons(master)
    save_android_icons(master)
    print("Generated web favicon and Android launcher icons.")


if __name__ == "__main__":
    main()
