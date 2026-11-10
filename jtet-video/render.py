#!/usr/bin/env python3
"""J-TET 60 second 2D explainer — PIL se frames, ffmpeg se video."""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
DUR = 60.0
NF = int(DUR * FPS)

FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

AMBER = (255, 176, 32)
TEAL = (42, 217, 181)
PINK = (255, 92, 138)
WHITE = (244, 248, 255)
MUTED = (147, 166, 196)
CARD = (22, 31, 62)
CARD2 = (15, 22, 48)
DARK = (10, 16, 40)

_fonts = {}


def F(size, bold=True):
    key = (size, bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(FONT_B if bold else FONT_R, size)
    return _fonts[key]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out(t):
    return 1 - (1 - clamp(t)) ** 3


def ease_io(t):
    t = clamp(t)
    return 3 * t * t - 2 * t * t * t


def lerp(a, b, t):
    return a + (b - a) * t


def prog(t, start, dur):
    return clamp((t - start) / dur)


def rgba(c, a):
    return (c[0], c[1], c[2], int(clamp(a) * 255))


# ------------------------------------------------------------------ background
def build_background():
    y, x = np.mgrid[0:H, 0:W]
    ty = (y / H).astype(np.float32)
    top = np.array([11, 16, 46], np.float32)
    bot = np.array([4, 6, 18], np.float32)
    img = top[None, None, :] * (1 - ty[..., None]) + bot[None, None, :] * ty[..., None]

    def glow(cx, cy, r, color, strength):
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2).astype(np.float32)
        g = np.clip(1 - d / r, 0, 1) ** 2.2 * strength
        return g[..., None] * np.array(color, np.float32)

    img += glow(140, 220, 950, (255, 150, 40), 0.20)
    img += glow(980, 1680, 1050, (40, 200, 180), 0.14)
    dd = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    img *= np.clip(1 - 0.30 * np.clip(dd - 0.55, 0, 2) ** 1.4, 0, 1)[..., None]
    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")

    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for gx in range(0, W, 72):
        gd.line([(gx, 0), (gx, H)], fill=(120, 160, 255, 12), width=1)
    for gy in range(0, H, 72):
        gd.line([(0, gy), (W, gy)], fill=(120, 160, 255, 12), width=1)
    return Image.alpha_composite(base.convert("RGBA"), grid)


def glow_sprite(radius, color):
    s = radius * 2
    yy, xx = np.mgrid[0:s, 0:s]
    d = np.sqrt((xx - radius) ** 2 + (yy - radius) ** 2) / radius
    a = np.clip(1 - d, 0, 1) ** 2.4
    arr = np.zeros((s, s, 4), np.uint8)
    arr[..., 0] = color[0]
    arr[..., 1] = color[1]
    arr[..., 2] = color[2]
    arr[..., 3] = (a * 78).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


# ------------------------------------------------------------------ primitives
def rrect(d, box, r, fill=None, outline=None, width=3):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text(d, xy, s, font, fill, anchor="la", stroke=0, stroke_fill=None):
    d.text(xy, s, font=font, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill)


def wrap(d, s, font, maxw):
    lines, cur = [], ""
    for w in s.split(" "):
        test = (cur + " " + w).strip()
        if d.textlength(test, font=font) <= maxw:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def chip(d, x, y, label, fg, bg, size=32, pad=(26, 14)):
    f = F(size, True)
    w = d.textlength(label, font=f) + pad[0] * 2
    h = size + pad[1] * 2
    rrect(d, (x, y, x + w, y + h), h / 2, fill=bg)
    text(d, (x + pad[0], y + h / 2), label, f, fg, anchor="lm")
    return w, h


def icon_check(d, cx, cy, s, col, width=7):
    d.line([(cx - s * 0.45, cy + s * 0.02), (cx - s * 0.10, cy + s * 0.38),
            (cx + s * 0.48, cy - s * 0.36)], fill=col, width=width, joint="curve")


def icon_clock(d, cx, cy, s, col, width=6):
    d.ellipse((cx - s, cy - s, cx + s, cy + s), outline=col, width=width)
    d.line([(cx, cy - s * 0.55), (cx, cy)], fill=col, width=width)
    d.line([(cx, cy), (cx + s * 0.45, cy + s * 0.22)], fill=col, width=width)


def icon_book(d, cx, cy, s, col, width=6):
    rrect(d, (cx - s, cy - s * 0.8, cx + s, cy + s * 0.8), 10, outline=col, width=width)
    d.line([(cx, cy - s * 0.8), (cx, cy + s * 0.8)], fill=col, width=width)
    for i in range(3):
        yy = cy - s * 0.35 + i * s * 0.34
        d.line([(cx - s * 0.7, yy), (cx - s * 0.22, yy)], fill=col, width=max(3, width - 3))
        d.line([(cx + s * 0.22, yy), (cx + s * 0.7, yy)], fill=col, width=max(3, width - 3))


def icon_bolt(d, cx, cy, s, col):
    d.polygon([(cx + s * 0.18, cy - s), (cx - s * 0.55, cy + s * 0.12),
               (cx - s * 0.02, cy + s * 0.12), (cx - s * 0.18, cy + s),
               (cx + s * 0.58, cy - s * 0.14), (cx + s * 0.04, cy - s * 0.14)], fill=col)


def bar(d, x, y, w, h, frac, col, track=(255, 255, 255, 26)):
    r = h / 2
    rrect(d, (x, y, x + w, y + h), r, fill=track)
    if frac > 0.002:
        rrect(d, (x, y, x + max(h, w * frac), y + h), r, fill=col)


# ------------------------------------------------------------------ scene parts
def heading(d, t, kicker, title, appear_at=0.0):
    a = ease_out(prog(t, appear_at, 0.6))
    text(d, (90, 250 - 40 * (1 - a)), kicker.upper(), F(30, True), rgba(AMBER, a))
    a2 = ease_out(prog(t, appear_at + 0.12, 0.7))
    text(d, (90, 300 - 46 * (1 - a2)), title, F(76, True), rgba(WHITE, a2))


def stat_row(d, t, label, value, maxv, appear, col, y):
    a = ease_out(prog(t, appear, 0.55))
    if a <= 0.002:
        return
    x = 90 + 60 * (1 - a)
    text(d, (x, y), label, F(40, True), rgba(WHITE, a))
    frac = ease_io(prog(t, appear + 0.10, 1.0))
    bar(d, x, y + 62, 760, 26, frac * (value / maxv), rgba(col, a))
    text(d, (x + 786, y + 24), str(int(round(value * frac))), F(46, True), rgba(col, a), anchor="lm")


# ------------------------------------------------------------------ scenes
def scene_intro(d, t):
    a = ease_out(prog(t, 0.05, 0.9))
    if a <= 0.002:
        return
    pulse = 1 + 0.03 * math.sin(t * 2.2)
    r = 300 * pulse
    d.ellipse((W / 2 - r, 900 - r, W / 2 + r, 900 + r), outline=rgba(AMBER, 0.20 * a), width=4)
    r2 = r * 0.74
    d.ellipse((W / 2 - r2, 900 - r2, W / 2 + r2, 900 + r2), outline=rgba(TEAL, 0.16 * a), width=3)

    size = int(lerp(126, 186, ease_out(prog(t, 0.1, 1.1))))
    a1 = ease_out(prog(t, 0.15, 0.9))
    text(d, (W / 2, 880), "J-TET", F(size, True), rgba(WHITE, a1), anchor="mm",
         stroke=3, stroke_fill=rgba(AMBER, 0.55 * a1))
    a2 = ease_out(prog(t, 0.9, 0.8))
    text(d, (W / 2, 1008 + 20 * (1 - a2)), "JHARKHAND TEACHER ELIGIBILITY TEST",
         F(30, True), rgba(AMBER, a2), anchor="mm")

    a3 = ease_out(prog(t, 1.5, 0.8))
    if a3 > 0.002:
        f = F(30, True)
        w = d.textlength("JAC · RANCHI", font=f) + 52
        rrect(d, (W / 2 - w / 2, 1080 + 20 * (1 - a3), W / 2 + w / 2, 1138 + 20 * (1 - a3)),
              29, fill=rgba(AMBER, 0.95 * a3))
        text(d, (W / 2, 1109 + 20 * (1 - a3)), "JAC · RANCHI", f, rgba(DARK, a3), anchor="mm")

    a4 = ease_out(prog(t, 2.4, 0.9))
    text(d, (W / 2, 1300 + 26 * (1 - a4)), "60 second me:", F(48, True), rgba(WHITE, a4), anchor="mm")
    a5 = ease_out(prog(t, 2.8, 0.9))
    text(d, (W / 2, 1372 + 26 * (1 - a5)), "pattern  ·  eligibility  ·  plan",
         F(46, False), rgba(TEAL, a5), anchor="mm")


def scene_what(d, t):
    heading(d, t, "Step 01", "JTET kya hai?")
    rows = [
        ("Paper 1  →  Class 1-5", "Primary teacher", AMBER, "book"),
        ("Paper 2  →  Class 6-8", "Upper primary teacher", TEAL, "book"),
        ("150 Q · 150 Marks · 2:30 hrs", "Offline OMR  ·  MCQ  ·  no negative marking", PINK, "clock"),
    ]
    y = 520
    for i, (title, sub, col, ic) in enumerate(rows):
        a = ease_out(prog(t, 0.5 + i * 0.55, 0.65))
        if a <= 0.002:
            y += 270
            continue
        x = 90 + 80 * (1 - a)
        rrect(d, (x, y, x + 900, y + 216), 28, fill=rgba(CARD, 0.92 * a),
              outline=rgba(col, 0.35 * a), width=2)
        rrect(d, (x, y + 24, x + 10, y + 192), 6, fill=rgba(col, a))
        if ic == "book":
            icon_book(d, x + 92, y + 108, 44, rgba(col, a))
        else:
            icon_clock(d, x + 92, y + 108, 44, rgba(col, a))
        tsize = 44 if len(title) > 26 else 46
        text(d, (x + 168, y + 76), title, F(tsize, True), rgba(WHITE, a))
        text(d, (x + 168, y + 142), sub, F(28, False), rgba(MUTED, a))
        y += 270

    a = ease_out(prog(t, 3.2, 0.8))
    if a > 0.002:
        text(d, (90, 1340 + 20 * (1 - a)), "Dono papers 150 marks ke, ek hi din alag-alag shift me.",
             F(30, False), rgba(MUTED, a))


def scene_p1(d, t):
    heading(d, t, "Step 02 · Paper 1", "Paper 1 pattern")
    text(d, (90, 420), "Class 1-5  ·  150 questions  ·  150 marks  ·  2:30 hrs",
         F(30, False), rgba(MUTED, ease_out(prog(t, 0.2, 0.6))))
    rows = [("Child Development & Pedagogy", 30), ("Language 1", 30), ("Language 2", 30),
            ("Mathematics", 30), ("EVS", 30)]
    y = 520
    for i, (label, val) in enumerate(rows):
        stat_row(d, t, label, val, 30, 0.45 + i * 0.42, TEAL if i % 2 == 0 else AMBER, y)
        y += 150

    a = ease_out(prog(t, 2.9, 0.7))
    if a > 0.002:
        w1, _ = chip(d, 90, 1290, "No negative marking", DARK, rgba(TEAL, 0.95 * a), size=30)
        chip(d, 90 + w1 + 18, 1290, "1 mark / question", DARK, rgba(AMBER, 0.95 * a), size=30)

    a2 = ease_out(prog(t, 3.5, 0.8))
    if a2 > 0.002:
        rrect(d, (90, 1420, 990, 1650), 30, fill=rgba(CARD, 0.9 * a2),
              outline=rgba(AMBER, 0.4 * a2), width=2)
        text(d, (130, 1462), "Total = 150 marks", F(46, True), rgba(WHITE, a2))
        text(d, (130, 1530), "Qualifying: 90/150 (General)", F(34, False), rgba(AMBER, a2))
        bar(d, 130, 1596, 820, 16, ease_io(prog(t, 3.8, 1.0)) * 0.6, rgba(TEAL, a2))


def scene_p2(d, t):
    heading(d, t, "Step 03 · Paper 2", "Paper 2 pattern")
    text(d, (90, 420), "Class 6-8  ·  150 questions  ·  150 marks  ·  2:30 hrs",
         F(30, False), rgba(MUTED, ease_out(prog(t, 0.2, 0.6))))
    rows = [("Child Development & Pedagogy", 30), ("Language 1", 30), ("Language 2", 30),
            ("Maths & Science", 60), ("Social Science", 60)]
    y = 520
    for i, (label, val) in enumerate(rows):
        stat_row(d, t, label, val, 60, 0.45 + i * 0.42, PINK if val == 60 else TEAL, y)
        y += 150

    a = ease_out(prog(t, 3.1, 0.8))
    if a > 0.002:
        text(d, (90, 1290 + 20 * (1 - a)), "Maths+Science  YA  Social Science  —  60 marks", F(30, True),
             rgba(AMBER, a))

    a2 = ease_out(prog(t, 3.8, 0.8))
    if a2 > 0.002:
        rrect(d, (90, 1370, 990, 1580), 30, fill=rgba(CARD, 0.9 * a2),
              outline=rgba(PINK, 0.35 * a2), width=2)
        text(d, (130, 1412), "Regional Language paper", F(40, True), rgba(WHITE, a2))
        text(d, (130, 1472), "Khortha · Nagpuri · Mundari · Santali", F(28, False), rgba(MUTED, a2))
        text(d, (130, 1512), "Ho · Kurukh · Urdu · Bangla", F(28, False), rgba(MUTED, a2))


def scene_elig(d, t):
    heading(d, t, "Step 04", "Eligibility")
    cards = [
        ("Paper 1 · Class 1-5", ["12th pass (45-50%)", "+ D.El.Ed / B.El.Ed"], AMBER),
        ("Paper 2 · Class 6-8", ["Graduation", "+ B.Ed / D.El.Ed"], TEAL),
    ]
    for i, (title, lines, col) in enumerate(cards):
        a = ease_out(prog(t, 0.45 + i * 0.5, 0.7))
        if a <= 0.002:
            continue
        cx = 90 + i * 460
        yy = 500 + 40 * (1 - a)
        rrect(d, (cx, yy, cx + 430, yy + 320), 30, fill=rgba(CARD, 0.94 * a),
              outline=rgba(col, 0.4 * a), width=2)
        d.ellipse((cx + 36, yy + 40, cx + 104, yy + 108), fill=rgba(col, a))
        icon_check(d, cx + 70, yy + 76, 24, rgba(DARK, a), width=7)
        text(d, (cx + 36, yy + 138), title, F(32, True), rgba(WHITE, a))
        ty = yy + 200
        for ln in lines:
            text(d, (cx + 36, ty), ln, F(30, False), rgba(MUTED if ln.startswith("+") else WHITE, a))
            ty += 54

    a = ease_out(prog(t, 1.7, 0.8))
    if a > 0.002:
        chip(d, 90, 900, "Age 18+ (Paper 1)", DARK, rgba(AMBER, 0.95 * a), size=30)
        chip(d, 470, 900, "Age 21+ (Paper 2)", DARK, rgba(TEAL, 0.95 * a), size=30)

    a2 = ease_out(prog(t, 2.5, 0.9))
    if a2 > 0.002:
        rrect(d, (90, 1030, 990, 1260), 30, fill=rgba(CARD2, 0.92 * a2),
              outline=rgba(WHITE, 0.10 * a2), width=2)
        icon_bolt(d, 152, 1145, 40, rgba(AMBER, a2))
        text(d, (222, 1092), "B.Ed / D.El.Ed final year?", F(36, True), rgba(WHITE, a2))
        text(d, (222, 1150), "Aap bhi apply kar sakte ho.", F(30, False), rgba(MUTED, a2))

    a3 = ease_out(prog(t, 3.3, 0.9))
    if a3 > 0.002:
        text(d, (90, 1340 + 20 * (1 - a3)), "JTET pass = lifetime validity certificate.", F(32, True),
             rgba(TEAL, a3))


def scene_qualify(d, t):
    heading(d, t, "Step 05", "Qualifying marks")
    cx, cy, r = 540, 900, 240
    a = ease_out(prog(t, 0.2, 0.6))
    if a <= 0.002:
        return
    d.arc((cx - r, cy - r, cx + r, cy + r), 0, 360, fill=(255, 255, 255, 30), width=44)
    frac = ease_io(prog(t, 0.4, 1.6))
    if frac > 0.004:
        d.arc((cx - r, cy - r, cx + r, cy + r), -90, -90 + 360 * 0.60 * frac,
              fill=rgba(AMBER, a), width=44)

    text(d, (540, 868), "%d%%" % int(round(60 * frac)), F(118, True), rgba(WHITE, a), anchor="mm")
    text(d, (540, 958), "General category", F(30, False), rgba(MUTED, a), anchor="mm")

    a2 = ease_out(prog(t, 2.0, 0.8))
    if a2 > 0.002:
        text(d, (540, 1030), "%d / 150" % int(round(90 * frac)), F(44, True), rgba(TEAL, a2), anchor="mm")

    rows = [("General", "60%", AMBER, 2.4), ("BC / EBC / EWS", "55%", TEAL, 2.8),
            ("SC / ST / PwD", "50%", PINK, 3.2)]
    y = 1330
    for label, val, col, at in rows:
        aa = ease_out(prog(t, at, 0.6))
        if aa <= 0.002:
            y += 88
            continue
        x = 90 + 50 * (1 - aa)
        rrect(d, (x, y, x + 900, y + 74), 37, fill=rgba(CARD, 0.9 * aa))
        d.ellipse((x + 24, y + 26, x + 48, y + 50), fill=rgba(col, aa))
        text(d, (x + 70, y + 37), label, F(32, True), rgba(WHITE, aa), anchor="lm")
        text(d, (x + 850, y + 37), val, F(34, True), rgba(col, aa), anchor="rm")
        y += 88

    a3 = ease_out(prog(t, 3.9, 0.8))
    if a3 > 0.002:
        text(d, (540, 1660), "Certificate validity: LIFETIME", F(32, True), rgba(AMBER, a3), anchor="mm")


def scene_plan(d, t):
    heading(d, t, "Step 06", "Taiyari ka 5-step plan")
    steps = [
        ("Syllabus + JAC ka official PDF", "Pehle din hi print karo"),
        ("NCERT Class 3-8 ki basics", "Maths, EVS, Science strong karo"),
        ("Pichhle 5 saal ke PYQ", "Pattern samajh me aa jayega"),
        ("Har hafte 1 mock test", "Error notebook zaroor banao"),
        ("Regional language practice", "Khortha / Nagpuri / Santali"),
    ]
    x0, y0 = 130, 540
    grow = ease_io(prog(t, 0.3, 4.6))
    if grow > 0.01:
        d.line([(x0 + 26, y0), (x0 + 26, y0 + 45 + 980 * grow)], fill=rgba(AMBER, 0.35), width=6)

    for i, (title, sub) in enumerate(steps):
        at = 0.4 + i * 0.85
        a = ease_out(prog(t, at, 0.6))
        if a <= 0.002:
            continue
        cy = y0 + 55 + i * 196
        done = ease_out(prog(t, at + 0.35, 0.4))
        d.ellipse((x0 - 2, cy - 30, x0 + 54, cy + 24), fill=rgba(CARD, a), outline=rgba(AMBER, a), width=3)
        if done > 0.3:
            d.ellipse((x0 - 2, cy - 30, x0 + 54, cy + 24), fill=rgba(AMBER, a))
            icon_check(d, x0 + 26, cy - 3, 22, rgba(DARK, a), width=6)
        else:
            text(d, (x0 + 26, cy - 3), str(i + 1), F(28, True), rgba(AMBER, a), anchor="mm")
        tx = x0 + 84 + 40 * (1 - a)
        text(d, (tx, cy - 24), title, F(38, True), rgba(WHITE, a))
        text(d, (tx, cy + 24), sub, F(28, False), rgba(MUTED, a))


def scene_outro(d, t):
    a0 = ease_out(prog(t, 0.1, 0.7))
    text(d, (W / 2, 830 + 30 * (1 - a0)), "Roz 3-4 ghante + 1 mock",
         F(44, False), rgba(MUTED, a0), anchor="mm")
    a = ease_out(prog(t, 0.5, 1.0))
    size = int(lerp(96, 124, ease_out(prog(t, 0.5, 1.2))))
    text(d, (W / 2, 980), "All the best!", F(size, True), rgba(WHITE, a), anchor="mm",
         stroke=3, stroke_fill=rgba(AMBER, 0.5 * a))
    a2 = ease_out(prog(t, 1.5, 0.8))
    text(d, (W / 2, 1120 + 20 * (1 - a2)), "Aaj se shuru — selection door nahi.",
         F(34, False), rgba(TEAL, a2), anchor="mm")
    a3 = ease_out(prog(t, 2.2, 0.8))
    if a3 > 0.002:
        f = F(34, True)
        w = d.textlength("SAVE  ·  SHARE", font=f) + 60
        rrect(d, (W / 2 - w / 2, 1210 + 20 * (1 - a3), W / 2 + w / 2, 1280 + 20 * (1 - a3)),
              35, fill=rgba(AMBER, 0.95 * a3))
        text(d, (W / 2, 1245 + 20 * (1 - a3)), "SAVE  ·  SHARE", f, rgba(DARK, a3), anchor="mm")
    a4 = ease_out(prog(t, 2.8, 0.8))
    text(d, (W / 2, 1370 + 16 * (1 - a4)), "Made by Farhan", F(26, True), rgba(MUTED, a4), anchor="mm")


# ------------------------------------------------------------------ timeline
SCENE_FN_ORDER = [
    [scene_intro], [scene_what], [scene_p1], [scene_p2],
    [scene_elig], [scene_qualify], [scene_plan], [scene_outro],
]


def load_schedule():
    """schedule.json ho to scene boundaries narration ke hisaab se."""
    global SCENES
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule.json")
    if not os.path.exists(path):
        return
    import json as _json
    with open(path) as fh:
        data = _json.load(fh)
    b = data["bounds"]
    if len(b) != len(SCENE_FN_ORDER) + 1:
        return
    SCENES = [(float(b[i]), float(b[i + 1]), SCENE_FN_ORDER[i]) for i in range(len(SCENE_FN_ORDER))]
    print("schedule:", [round(x, 2) for x in b])


SCENES = [
    (0.0, 5.0, [scene_intro]),
    (5.0, 12.0, [scene_what]),
    (12.0, 22.0, [scene_p1]),
    (22.0, 33.0, [scene_p2]),
    (33.0, 40.0, [scene_elig]),
    (40.0, 47.0, [scene_qualify]),
    (47.0, 56.0, [scene_plan]),
    (56.0, 60.0, [scene_outro]),
]


def draw_hud(img, t):
    d = ImageDraw.Draw(img)
    p = t / DUR
    cur = 0
    for i, (s0, s1, _) in enumerate(SCENES):
        if s0 <= t < s1:
            cur = i
    d.line([(90, 152), (130, 152)], fill=rgba(TEAL, 0.8), width=5)
    text(d, (144, 152), "J-TET  ·  60 SEC GUIDE", F(24, True), rgba(MUTED, 0.85), anchor="lm")
    text(d, (W - 90, 152), "%02d / %02d" % (cur + 1, len(SCENES)), F(24, True),
         rgba(MUTED, 0.75), anchor="rm")

    # bottom dots
    n = len(SCENES)
    gap, r = 30, 5
    total = (n - 1) * gap
    x0 = W / 2 - total / 2
    for i in range(n):
        cx = x0 + i * gap
        if i == cur:
            d.ellipse((cx - 9, 1741 - 9, cx + 9, 1741 + 9), fill=rgba(AMBER, 0.95))
        elif i < cur:
            d.ellipse((cx - r, 1741 - r, cx + r, 1741 + r), fill=rgba(TEAL, 0.65))
        else:
            d.ellipse((cx - r, 1741 - r, cx + r, 1741 + r), fill=(255, 255, 255, 42))
    text(d, (90, 1741), "jac.jharkhand.gov.in", F(22, False), rgba(MUTED, 0.55), anchor="lm")
    text(d, (W - 90, 1741), "Made by Farhan", F(22, False), rgba(MUTED, 0.55), anchor="rm")

    d.rectangle((0, H - 8, W, H), fill=(255, 255, 255, 22))
    d.rectangle((0, H - 8, max(4, W * p), H), fill=rgba(AMBER, 0.9))


def compose(fi, bg, glow_a, glow_t):
    t = fi / FPS
    base = bg.copy()

    gx = int(W / 2 + 260 * math.sin(t * 0.35))
    gy = int(760 + 320 * math.cos(t * 0.28))
    base.alpha_composite(glow_a, (gx - 520, gy - 520))
    base.alpha_composite(glow_t, (int(W / 2 + 320 * math.cos(t * 0.22)) - 560,
                                  int(1350 + 260 * math.sin(t * 0.31)) - 560))

    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for i in range(24):
        px = (i * 397 + t * 26 * (1 + i % 3)) % W
        py = (i * 733 - t * 34 * (1 + i % 4)) % H
        rr = 2 + (i % 3)
        dd.ellipse((px - rr, py - rr, px + rr, py + rr), fill=(255, 220, 160, 26 + (i % 4) * 12))
    base.alpha_composite(dots)

    for (s0, s1, fns) in SCENES:
        if not (s0 <= t < s1):
            continue
        local = t - s0
        dur = s1 - s0
        fade = 1.0
        if s0 > 0:
            fade *= ease_out(clamp(local / 0.45))
        if s1 < DUR - 0.01:
            fade *= ease_out(clamp((dur - local) / 0.45))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for fn in fns:
            fn(d, local)
        if fade < 0.999:
            arr = np.array(layer)
            arr[..., 3] = (arr[..., 3].astype(np.float32) * fade).astype(np.uint8)
            layer = Image.fromarray(arr, "RGBA")
        base.alpha_composite(layer)

    draw_hud(base, t)
    return base


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    load_schedule()
    bg = build_background()
    glow_a = glow_sprite(520, AMBER)
    glow_t = glow_sprite(560, TEAL)

    if "--sample" in sys.argv:
        times = sys.argv[sys.argv.index("--sample") + 1].split(",")
        for s in times:
            t = float(s)
            img = compose(int(t * FPS), bg, glow_a, glow_t)
            img.convert("RGB").save(os.path.join(here, "sample-%05.2f.png" % t))
        print("samples done")
        return

    ff = __import__("imageio_ffmpeg").get_ffmpeg_exe()
    out = os.path.join(here, os.environ.get("OUT_NAME", "jtet-60s.mp4"))
    audio = os.path.join(here, "mix.wav")
    if not os.path.exists(audio):
        audio = os.path.join(here, "music.wav")
    cmd = [ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H),
           "-r", str(FPS), "-i", "-"]
    if os.path.exists(audio):
        cmd += ["-i", audio]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart"]
    if os.path.exists(audio):
        cmd += ["-c:a", "aac", "-b:a", "160k", "-shortest"]
    cmd += [out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE)
    try:
        for fi in range(NF):
            img = compose(fi, bg, glow_a, glow_t)
            proc.stdin.write(img.convert("RGB").tobytes())
            if fi % 300 == 0:
                print("frame %d/%d" % (fi, NF), flush=True)
    finally:
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", "replace")
        proc.wait()
    if proc.returncode != 0:
        print("ffmpeg failed:\n", err[-2000:])
    else:
        print("video:", out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
