"""Generates the app and tray icons (run once; output is committed in assets/)."""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "assets")
OUT.mkdir(parents=True, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def sparkle(draw, cx, cy, r, fill, p=2.7):
    """Four-pointed sparkle: an astroid-like curve with sharp tips and concave sides."""
    pts = []
    steps = 256
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s_ = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** p, c)
        y = math.copysign(abs(s_) ** p, s_)
        pts.append((cx + r * x, cy + r * y))
    draw.polygon(pts, fill=fill)


def app_icon(size=1024):
    s = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad = Image.new("RGBA", (s, s))
    top, mid, bot = (124, 92, 255), (178, 76, 230), (255, 92, 168)
    px = grad.load()
    for y in range(s):
        for x in range(0, s, 4):
            t = (x * 0.45 + y * 0.55) / s
            c = lerp(top, mid, t / 0.55) if t < 0.55 else lerp(mid, bot, (t - 0.55) / 0.45)
            for dx in range(4):
                px[x + dx, y] = c + (255,)
    mask = Image.new("L", (s, s), 0)
    margin = int(s * 0.08)
    ImageDraw.Draw(mask).rounded_rectangle([margin, margin, s - margin, s - margin], radius=int(s * 0.2), fill=255)
    img.paste(grad, (0, 0), mask)

    # soft highlight
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([int(s * 0.1), int(s * 0.02), int(s * 0.9), int(s * 0.55)], fill=(255, 255, 255, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.04))
    img = Image.alpha_composite(img, Image.composite(glow, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask))

    d = ImageDraw.Draw(img)
    sparkle(d, s * 0.46, s * 0.54, s * 0.27, (255, 255, 255, 255))
    sparkle(d, s * 0.70, s * 0.29, s * 0.11, (255, 255, 255, 235))
    return img.resize((size, size), Image.LANCZOS)


def tray_icon(size, color):
    s = size * 8
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    sparkle(d, s * 0.45, s * 0.55, s * 0.42, color)
    sparkle(d, s * 0.82, s * 0.2, s * 0.15, color)
    return img.resize((size, size), Image.LANCZOS)


icon = app_icon(1024)
icon.save(OUT / "icon.png")
icon.resize((256, 256), Image.LANCZOS).save(OUT / "icon-256.png")
tray_icon(32, (124, 92, 255, 255)).save(OUT / "tray.png")
tray_icon(16, (0, 0, 0, 255)).save(OUT / "trayTemplate.png")
tray_icon(32, (0, 0, 0, 255)).save(OUT / "trayTemplate@2x.png")
print("icons written to", OUT)
