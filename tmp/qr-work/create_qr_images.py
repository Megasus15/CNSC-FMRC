"""Create the two requested, matching FMRC QR image artifacts."""

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tmp/qr-runtime"))

import segno
from PIL import Image, ImageDraw, ImageFont

OUT = ROOT / "output/qr-codes"
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 3000
SCALE = 2
CREAM = "#FDFAF6"
MAROON = "#6B202B"
DARK = "#511721"
MUTED = "#79665F"
BORDER = "#DDCFC3"
WHITE = "#FFFFFF"
FONT = Path("C:/Windows/Fonts/arial.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/arialbd.ttf")
LOGO = ROOT / "images/FMRC Logo.png"


def font(size, bold=False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT), round(size * SCALE))


def centered(draw, value, y, size, color, bold=False, tracking=0):
    f = font(size, bold)
    if not tracking:
        draw.text((SIZE * SCALE / 2, y * SCALE), value, font=f, fill=color, anchor="mt")
        return
    spacing = tracking * SCALE
    widths = [draw.textlength(ch, font=f) for ch in value]
    total = sum(widths) + max(0, len(value) - 1) * spacing
    x = (SIZE * SCALE - total) / 2
    cap_box = f.getbbox("H", anchor="ls")
    baseline = y * SCALE + cap_box[3] - cap_box[1]
    for ch, width in zip(value, widths):
        draw.text((x, baseline), ch, font=f, fill=color, anchor="ls")
        x += width + spacing


def render(item):
    im = Image.new("RGB", (SIZE * SCALE, SIZE * SCALE), CREAM)
    d = ImageDraw.Draw(im)

    def box(x, y, w, h):
        return tuple(round(v * SCALE) for v in (x, y, x + w, y + h))

    def rect(x, y, w, h, fill, radius=0, outline=None, width=1):
        if radius:
            d.rounded_rectangle(box(x, y, w, h), radius=round(radius * SCALE),
                                fill=fill, outline=outline, width=round(width * SCALE))
        else:
            d.rectangle(box(x, y, w, h), fill=fill, outline=outline,
                        width=round(width * SCALE))

    # Quiet cream square, thin inset frame, and restrained typography.
    rect(108, 108, 2784, 2784, None, radius=42, outline=BORDER, width=3)
    rect(1374, 108, 252, 10, MAROON)
    centered(d, "UCN-FMRC", 234, 58, MAROON, bold=True, tracking=8)
    centered(d, item["title"], 355, 146, DARK, bold=True)
    centered(d, item["subtitle"], 547, 48, MUTED)

    # A consistent physical footprint, with density fitted to each exact URL.
    # White backing provides at least a four-module quiet zone around the code.
    panel_x, panel_y, panel_side = 575, 735, 1850
    rect(panel_x, panel_y, panel_side, panel_side, WHITE, radius=54,
         outline="#E9DFD5", width=3)
    qr = segno.make(item["url"], version=item["version"], error="h", mode="byte",
                    micro=False, boost_error=False)
    matrix = [list(row) for row in qr.matrix]
    n = len(matrix)
    cell = 1485 / n
    qr_side = n * cell
    qx = panel_x + (panel_side - qr_side) / 2
    qy = panel_y + (panel_side - qr_side) / 2
    origins = ((0, 0), (n - 7, 0), (0, n - 7))

    def in_finder(col, row):
        return any(ox <= col < ox + 7 and oy <= row < oy + 7 for ox, oy in origins)

    for row in range(n):
        for col in range(n):
            if not matrix[row][col] or in_finder(col, row):
                continue
            x, y = qx + col * cell, qy + row * cell
            # Keep timing and alignment patterns geometrically standard.
            if row == 6 or col == 6 or (n-9 <= row <= n-5 and n-9 <= col <= n-5):
                rect(x, y, cell, cell, MAROON)
            else:
                cx, cy, r = x + cell / 2, y + cell / 2, cell * 0.61
                d.polygon([(round(px * SCALE), round(py * SCALE)) for px, py in
                           ((cx, cy-r), (cx+r, cy), (cx, cy+r), (cx-r, cy))], fill=MAROON)

    # Rounded square eyes and circular centers recall the supplied QR.
    for ox, oy in origins:
        x, y = qx + ox * cell, qy + oy * cell
        rect(x, y, cell * 7, cell * 7, DARK, radius=cell * 1.2)
        rect(x + cell, y + cell, cell * 5, cell * 5, WHITE, radius=cell * 0.6)
        d.ellipse(box(x + cell * 1.85, y + cell * 1.85, cell * 3.3, cell * 3.3), fill=DARK)

    # Small logo knockout plus high error correction; scan tests follow export.
    cx, cy = qx + qr_side / 2, qy + qr_side / 2
    knockout = 303.4
    d.ellipse(box(cx-knockout/2, cy-knockout/2, knockout, knockout), fill=WHITE)
    logo_size = round(262.7 * SCALE)
    logo = Image.open(LOGO).convert("RGBA").resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    im.paste(logo, (round(cx*SCALE-logo_size/2), round(cy*SCALE-logo_size/2)), logo)

    centered(d, item["cta"], 2672, 43, MAROON, bold=True, tracking=5)
    centered(d, "ucn-fabmanlab.com", 2770, 49, MUTED)

    final = im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    path = OUT / item["filename"]
    final.save(path, dpi=(300, 300), optimize=True)
    preview = ROOT / "tmp/qr-work" / item["filename"].replace("-hd.png", "-preview.png")
    final.resize((900, 900), Image.Resampling.LANCZOS).save(preview)
    return {**item, "path": str(path), "size": final.size, "error_correction": "H",
            "version": qr.version, "mask": qr.mask,
            "qr_bounds": [qx, qy, qx + qr_side, qy + qr_side],
            "quiet_zone_modules": (panel_side - qr_side) / 2 / cell}


items = [
    {"title": "Website", "subtitle": "Explore our services and products.",
     "cta": "SCAN TO VISIT", "url": "https://ucn-fabmanlab.com/",
     "filename": "fmrc-website-qr-hd.png", "version": 4},
    {"title": "Admin Portal", "subtitle": "Access the FMRC administration portal.",
     "cta": "SCAN TO ACCESS", "url": "https://ucn-fabmanlab.com/admin-auth/auth#signup",
     "filename": "fmrc-admin-portal-qr-hd.png", "version": 6},
]
manifest = [render(item) for item in items]
(ROOT / "tmp/qr-work/manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("Created two matching 3000 x 3000 PNGs in", OUT)
