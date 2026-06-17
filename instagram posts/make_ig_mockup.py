# -*- coding: utf-8 -*-
"""
Shelfd IG mockup generator.
Wraps native iPhone screenshots (1290x2796) in a realistic Natural-Titanium
device frame on a 4:5 portrait canvas (Instagram's biggest feed ratio) with a
deep near-black background, a soft lavender radial glow, and a drop shadow.

Quality rules:
- Screenshot is ONLY ever downscaled (LANCZOS), never upscaled -> no deterioration.
- Phone frame + rounded corners are built at native scale then downscaled
  (supersampled) for clean anti-aliased edges.
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFilter

IN_DIR  = r"C:\Users\kingk\Desktop\websites\chat gpt edits\7\instagram posts\photos"
OUT_DIR = r"C:\Users\kingk\Desktop\websites\chat gpt edits\7\instagram posts\ig post 1"

# ---- Canvas (4:5 portrait, high-res 2x of 1080x1350) ----
CW, CH = 2160, 2700

# ---- Frame geometry (native screenshot px) ----
FT        = 62     # titanium rail thickness
GAP       = 13     # dark glass gap between rail and screen
SCREEN_R  = 165    # screen corner radius (native)
BTN_PAD   = 8      # side-button protrusion room

# ---- Look ----
PHONE_H_FRAC = 0.865          # phone height as fraction of canvas height
BG_COLOR     = (10, 10, 14)   # deep near-black
GLOW_COLOR   = (167, 139, 250)  # lavender (#a78bfa)
GLOW_MAX_A   = 105            # peak glow alpha
SHADOW_A     = 0.55
SS = 4  # supersample factor for masks


def rounded_mask(w, h, radius):
    """Anti-aliased rounded-rect alpha via supersampling."""
    m = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=radius * SS, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def vgradient(w, h, top, mid, bot):
    """Vertical 3-stop gradient (top -> mid at 45% -> bot)."""
    g = Image.new("RGB", (1, h))
    px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        if t < 0.45:
            f = t / 0.45
            c = tuple(int(top[i] + (mid[i] - top[i]) * f) for i in range(3))
        else:
            f = (t - 0.45) / 0.55
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * f) for i in range(3))
        px[0, y] = c
    return g.resize((w, h))


def build_phone(screenshot):
    """Return RGBA phone composite (with side buttons) at native scale."""
    sw, sh = screenshot.size  # 1290 x 2796

    # round the screenshot corners (mask only -> screenshot pixels untouched)
    shot = screenshot.convert("RGBA")
    shot.putalpha(rounded_mask(sw, sh, SCREEN_R))

    body_w = sw + 2 * (FT + GAP)
    body_h = sh + 2 * (FT + GAP)
    body_r = SCREEN_R + FT + GAP

    # full canvas includes room for protruding buttons on left/right
    cw = body_w + 2 * BTN_PAD
    ch = body_h
    phone = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    bx = BTN_PAD  # body x offset

    # --- side buttons (drawn first so the rail overlaps their inner edge) ---
    tit_btn = (150, 145, 135)
    def button(cx_left, y0, y1, on_left):
        bw = BTN_PAD + 10
        if on_left:
            x0 = bx - BTN_PAD
            x1 = bx + 8
        else:
            x0 = bx + body_w - 8
            x1 = bx + body_w + BTN_PAD
        d2 = ImageDraw.Draw(phone)
        d2.rounded_rectangle([x0, y0, x1, y1], radius=6, fill=tit_btn + (255,))
    # left: action button + volume up + volume down ; right: power
    button(0, int(ch*0.16), int(ch*0.205), True)
    button(0, int(ch*0.24),  int(ch*0.315), True)
    button(0, int(ch*0.335), int(ch*0.41),  True)
    button(0, int(ch*0.26),  int(ch*0.40),  False)

    # --- titanium rail (vertical gradient masked to rounded body) ---
    grad = vgradient(body_w, body_h,
                     (232, 228, 219),  # top highlight
                     (197, 192, 182),  # natural titanium mid (warm silver)
                     (150, 145, 134))  # bottom shade
    rail = grad.convert("RGBA")
    rail.putalpha(rounded_mask(body_w, body_h, body_r))
    phone.alpha_composite(rail, (bx, 0))

    # subtle metal edge: dark outline + inner highlight
    d = ImageDraw.Draw(phone)
    d.rounded_rectangle([bx+1, 1, bx+body_w-2, body_h-2], radius=body_r,
                        outline=(108, 104, 95, 230), width=4)
    d.rounded_rectangle([bx+6, 6, bx+body_w-7, body_h-7], radius=body_r-5,
                        outline=(238, 234, 226, 150), width=2)

    # --- dark glass bezel under the screen ---
    inner_w = body_w - 2 * FT
    inner_h = body_h - 2 * FT
    glass = Image.new("RGBA", (inner_w, inner_h), (0, 0, 0, 0))
    glass.putalpha(rounded_mask(inner_w, inner_h, SCREEN_R + GAP))
    black = Image.new("RGBA", (inner_w, inner_h), (6, 6, 8, 255))
    black.putalpha(glass.split()[3])
    phone.alpha_composite(black, (bx + FT, FT))

    # --- screen ---
    phone.alpha_composite(shot, (bx + FT + GAP, FT + GAP))
    return phone


def radial_glow(w, h, cx, cy, rad):
    """Soft lavender radial glow as RGBA, built small + blurred for smoothness."""
    s = 4
    gm = Image.new("L", (w // s, h // s), 0)
    d = ImageDraw.Draw(gm)
    r = rad // s
    d.ellipse([cx // s - r, cy // s - r, cx // s + r, cy // s + r], fill=GLOW_MAX_A)
    gm = gm.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(w * 0.10))
    glow = Image.new("RGBA", (w, h), GLOW_COLOR + (0,))
    glow.putalpha(gm)
    return glow


def compose(screenshot):
    phone = build_phone(screenshot)
    pw, ph = phone.size

    # scale phone to target height (downscale only -> screenshot never upscaled)
    target_h = int(CH * PHONE_H_FRAC)
    scale = target_h / ph
    nw, nh = max(1, int(pw * scale)), target_h
    phone = phone.resize((nw, nh), Image.LANCZOS)

    px = (CW - nw) // 2
    py = (CH - nh) // 2 - int(CH * 0.012)  # nudge up slightly

    # background + glow
    canvas = Image.new("RGBA", (CW, CH), BG_COLOR + (255,))
    canvas = Image.alpha_composite(canvas, radial_glow(CW, CH, CW // 2, py + nh // 2, int(CW * 0.46)))

    # drop shadow
    shadow = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sh = Image.new("RGBA", (nw, nh), (0, 0, 0, 0))
    sh.putalpha(phone.split()[3].point(lambda a: int(a * SHADOW_A)))
    shadow.paste(sh, (px, py + 34), sh)
    shadow = shadow.filter(ImageFilter.GaussianBlur(46))
    canvas = Image.alpha_composite(canvas, shadow)

    # phone
    layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    layer.paste(phone, (px, py), phone)
    canvas = Image.alpha_composite(canvas, layer)
    return canvas.convert("RGB")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    files = sorted(glob.glob(os.path.join(IN_DIR, "*.png")))
    for f in files:
        name = os.path.basename(f)
        if only and name != only:
            continue
        out = os.path.join(OUT_DIR, os.path.splitext(name)[0] + "_ig.png")
        img = Image.open(f)
        result = compose(img)
        result.save(out, "PNG", dpi=(144, 144), optimize=True)
        print("OK ->", out, result.size)


if __name__ == "__main__":
    main()
