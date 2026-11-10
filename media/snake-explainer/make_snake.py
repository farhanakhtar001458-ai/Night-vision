#!/usr/bin/env python3
"""
High-motion 2D explainer (English): how snake venom spreads after a bite on the leg.
Reuses the drawing / text / easing helpers from make_video.py (Pillow + numpy, HarfBuzz shaping).
"""
import math, os, re, sys, wave, random, subprocess
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, '/home/user/antibiotics-video')
import make_video as mv
from make_video import (W, H, FPS, TR, FFMPEG, WHITE, MUTED, TEAL, AMBER, CORAL, SKY, GREEN, VIOLET, PANEL, DARK,
                        eio, eout, ein, eback, mix, seg, kf, clamp01, text_sprite, place, polyline, bezier_path,
                        rrect, dot, ellipse, sdf_sprite, ss_sprite, capsule_sdf, rrect_sdf, sphere, rod, icon,
                        background, vignette, drift, title, label, build_caption, caption, RS, BL)

WORK = '/home/user/snake-video/work'
OUT = '/home/user/snake-video/snake_venom_explainer_en.mp4'
VENOM = (150, 235, 90); VENOM_D = (70, 140, 40); SKIN = (236, 196, 168); TISSUE = (240, 160, 170)
RED = (255, 90, 90); BLUE_V = (60, 110, 200); PALE = (200, 230, 255)
WOUND = (664, 520); MAG = (1400, 500); HEART = (1500, 430)

# ---------------------------------------------------------------- helpers
def reveal(cv, spr, x, y, p, alpha=1.0):
    """Left-to-right wipe-in of a text sprite (centred at x,y)."""
    if p <= 0: return
    w = max(1, int(spr.width * clamp01(p)))
    place(cv, spr.crop((0, 0, w, spr.height)), x - spr.width / 2 + w / 2, y, alpha=alpha)

def ring(cv, cx, cy, r, color, alpha=255, width=6):
    pts = [(cx + r * math.cos(k / 48 * 2 * math.pi), cy + r * math.sin(k / 48 * 2 * math.pi)) for k in range(49)]
    polyline(cv, pts, color, width, alpha)

def snake(cv, head_x, head_y, t, n=34, step=22, amp=58, freq=0.45, spd=6.0, fang=0.0, alpha=1.0):
    pts = []
    for i in range(n + 1):
        x = head_x - (n - i) * step
        y = head_y + amp * math.sin(i * freq - t * spd) * (i / n) ** 0.7
        pts.append((x, y))
    polyline(cv, pts, (46, 110, 52), 44, int(255 * alpha))
    polyline(cv, [(x, y - 9) for x, y in pts], (150, 220, 110), 9, int(120 * alpha))
    for i in range(0, n, 3):
        place(cv, dot(6, (25, 60, 30), int(230 * alpha)), pts[i][0], pts[i][1])
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    ang = math.degrees(math.atan2(y2 - y1, x2 - x1))
    place(cv, ellipse(42, 30, (60, 140, 64), alpha), x2, y2, rot=-ang)
    place(cv, dot(6, (255, 220, 60), int(255 * alpha)), x2 + 14, y2 - 14)
    place(cv, dot(6, (255, 220, 60), int(255 * alpha)), x2 + 14, y2 + 14)
    if fang > 0:
        for dy in (-12, 12):
            polyline(cv, [(x2 + 30, y2 + dy * 0.5), (x2 + 30 + 34 * fang, y2 + dy * 0.2)], WHITE, 5, int(255 * alpha))

# ---------------------------------------------------------------- sprites
@lru_cache(None)
def leg_spr():
    return sdf_sprite(240, 700, capsule_sdf(120, 110, 120, 590, 108),
                      lambda x, y: np.stack([236 - 30 * np.abs(x - 120) / 108, 196 - 30 * np.abs(x - 120) / 108,
                                             168 - 30 * np.abs(x - 120) / 108], -1))

@lru_cache(None)
def body_spr():
    def sd(x, y):
        d1 = np.hypot(x - 320, y - 130) - 80
        d2 = rrect_sdf(300, 380, 60)(x - 170, y - 210)
        d3 = capsule_sdf(270, 560, 270, 930, 62)(x, y)
        d4 = capsule_sdf(370, 560, 370, 930, 62)(x, y)
        d5 = capsule_sdf(150, 300, 110, 560, 40)(x, y)
        d6 = capsule_sdf(490, 300, 530, 560, 40)(x, y)
        return np.minimum.reduce([d1, d2, d3, d4, d5, d6])
    return sdf_sprite(640, 1000, sd, (34, 72, 112), 0.9)

_CELLS = None
def cells():
    global _CELLS
    if _CELLS is None:
        rnd = random.Random(42); out = []
        while len(out) < 150:
            x = rnd.uniform(20, 580); y = rnd.uniform(20, 580)
            if math.hypot(x - 300, y - 300) > 296: continue
            out.append((x, y, rnd.uniform(18, 30)))
        _CELLS = out
    return _CELLS

def tissue_spr(t, R):
    """Magnified tissue disc: cells turn green and dissolve as the venom front R expands."""
    big = Image.new('RGBA', (1200, 1200), (0, 0, 0, 0)); d = ImageDraw.Draw(big)
    for (x, y, r) in cells():
        dist = math.hypot(x - 300, y - 300)
        k_in = clamp01((R - dist) / 50)
        col = mix((236, 150, 160), VENOM_D if False else (120, 230, 80), k_in)
        shrink = 1 - 0.45 * clamp01((R - dist - 40) / 70)
        alpha = 1 - 0.75 * clamp01((R - dist - 90) / 80)
        if alpha <= 0.03: continue
        rr = r * shrink * 2; cx, cy = x * 2, y * 2
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=tuple(int(c) for c in col) + (int(255 * alpha),),
                  outline=(160, 60, 80, int(200 * alpha)), width=5)
        d.ellipse([cx - rr * .3, cy - rr * .3, cx + rr * .3, cy + rr * .3], fill=(150, 70, 110, int(200 * alpha)))
    rnd = random.Random(9)
    if R > 5:
        for i in range(70):
            a = rnd.uniform(0, 2 * math.pi); rad = R * math.sqrt(rnd.uniform(0, 1))
            jit = 6 * math.sin(t * 5 + i)
            x = 300 + math.cos(a) * rad + jit; y = 300 + math.sin(a) * rad
            d.ellipse([(x - 5) * 2, (y - 5) * 2, (x + 5) * 2, (y + 5) * 2], fill=(210, 255, 160, 210))
    img = big.resize((600, 600), RS)
    base = Image.new('RGBA', (600, 600), (246, 205, 210, 255))
    base.alpha_composite(img)
    yy, xx = np.mgrid[0:600, 0:600].astype(np.float32) + 0.5
    m = np.clip(0.5 - (np.hypot(xx - 300, yy - 300) - 300), 0, 1)
    a = np.asarray(base.getchannel('A'), dtype=np.float32) * m
    base.putalpha(Image.fromarray(a.astype(np.uint8)))
    return base

# ---------------------------------------------------------------- scenes
def s_hook(cv, t):
    drift(cv, t, 1, 40)
    for k in range(6):                                  # rotating light beams
        a = t * 0.18 + k * math.pi / 3
        polyline(cv, [(960, 540), (960 + math.cos(a) * 1500, 540 + math.sin(a) * 1500)], (60, 120, 170), 46, 16)
    strike = ein(seg(t, 1.0, 1.4, lambda u: u))
    hx = mix(520, 1200, strike)
    snake(cv, hx, 600, t, fang=seg(t, 0.9, 1.3), spd=5 if t < 1.2 else 9)
    title(cv, 'SNAKE VENOM', t, y=200, px=110, t0=0.3, color=WHITE)
    label(cv, 'How venom travels through the body', 960, 330, t, 2.0, px=44, color=MUTED)

def s_bite(cv, t):
    drift(cv, t, 2, 24)
    place(cv, leg_spr(), 560, 520)
    # fangs approach the wound, then withdraw
    fx = mix(900, WOUND[0] + 6, eout(seg(t, 0.4, 1.0))) if t < 1.6 else mix(WOUND[0] + 6, 900, eout(seg(t, 1.6, 2.2)))
    for dy in (-16, 16):
        polyline(cv, [(fx + 60, WOUND[1] + dy - 8), (fx, WOUND[1] + dy)], WHITE, 7, int(255 * seg(t, 0.3, 0.6)))
    # wound pulses & venom droplets flying into the magnified tissue
    if t > 1.0:
        for k in range(3):
            rr = 10 + 70 * (((t - 1.0 - 0.4 * k) % 1.2) / 1.2)
            ring(cv, WOUND[0], WOUND[1], rr, RED, int(200 * (1 - (rr - 10) / 70)), 5)
        place(cv, dot(60, RED, int(90 * (0.5 + 0.5 * math.sin(t * 9)))), WOUND[0], WOUND[1])
    for i in range(12):
        t0 = 1.0 + 0.04 * i
        p = seg(t, t0, t0 + 0.9, eout)
        if p <= 0 or p >= 1: continue
        x = mix(WOUND[0], MAG[0] - 280, p); y = mix(WOUND[1], MAG[1], p) - 170 * math.sin(math.pi * p)
        place(cv, dot(8, VENOM), x, y)
    # magnifier
    spread = 300 * eout(seg(t, 2.0, 4.8))
    place(cv, tissue_spr(t, spread), MAG[0], MAG[1])
    ring(cv, MAG[0], MAG[1], 284, TEAL, 255, 8)
    label(cv, 'Two hollow fangs inject venom', 960, 150, t, 1.0, px=46, color=WHITE, bold=True)
    label(cv, 'Local tissue breakdown: swelling and pain', MAG[0], 835, t, 3.2, px=38, color=AMBER)

def s_spread(cv, t):
    """Scene 3: continuation of the bite -- venom front expands through the magnified tissue."""
    drift(cv, t, 8, 20)
    place(cv, leg_spr(), 560, 520)
    if True:
        ring(cv, WOUND[0], WOUND[1], 40 + 30 * math.sin(t * 5), RED, 160, 5)
        place(cv, dot(60, RED, int(90 * (0.5 + 0.5 * math.sin(t * 9)))), WOUND[0], WOUND[1])
    for i in range(12):
        place(cv, dot(6, VENOM, 200), WOUND[0] + 40 + 10 * math.sin(t * 6 + i) + i * 14, WOUND[1] + 20 * math.cos(t * 4 + i))
    spread = 300 * eout(seg(t, 0.0, 3.2))
    place(cv, tissue_spr(t, spread), MAG[0], MAG[1])
    ring(cv, MAG[0], MAG[1], 284, TEAL, 255, 8)
    label(cv, 'Venom breaks down cells as it spreads', 960, 150, t, 0.4, px=46, color=WHITE, bold=True)
    label(cv, 'Local tissue breakdown: swelling and pain', MAG[0], 835, t, 1.6, px=38, color=AMBER)

VEINS = [
    [(640, 560), (760, 540), (1000, 500), (1250, 460), HEART],
    [(640, 600), (720, 640), (900, 620), (1150, 560), (1380, 470), HEART],
    [(640, 540), (700, 430), (900, 380), (1150, 400), HEART],
    [(680, 600), (800, 700), (1100, 650), (1400, 560), HEART],
]
def s_vessels(cv, t):
    drift(cv, t, 3, 20)
    place(cv, leg_spr(), 560, 520, alpha=0.35)
    for P in VEINS:
        samp = [bezier_path(P, k / 60) for k in range(61)]
        polyline(cv, samp, BLUE_V, 16, 120)
        polyline(cv, samp, PALE, 4, 150)
    for pi, P in enumerate(VEINS):                       # venom particles streaming to the heart
        for i in range(7):
            u = (t * 0.42 + i / 7 + pi * 0.19) % 1.0
            x, y = bezier_path(P, u)
            place(cv, dot(16, VENOM, 70), x, y)
            place(cv, dot(7, VENOM), x, y)
    beat = 1 + 0.10 * max(0.0, math.sin(t * 2 * math.pi * 1.3)) ** 4
    place(cv, sphere(44, (210, 60, 80), 0.5), HEART[0] - 22, HEART[1], scale=beat)
    place(cv, sphere(44, (230, 80, 100), 0.5), HEART[0] + 22, HEART[1], scale=beat)
    place(cv, dot(70, RED, int(60 * beat)), HEART[0], HEART[1])
    place(cv, dot(9, RED, int(255 * (0.5 + 0.5 * math.sin(t * 9)))), WOUND[0], WOUND[1])
    label(cv, 'Enters blood and lymph vessels', 1380, 250, t, 0.8, px=44, color=WHITE, bold=True)
    label(cv, 'Flowing toward the heart', 1380, 320, t, 1.8, px=40, color=MUTED)

LOOP = [(960, 900), (900, 760), (880, 600), (930, 470), (960, 340), (1040, 470), (1060, 600), (1020, 760), (960, 900)]
def s_body(cv, t):
    drift(cv, t, 4, 20)
    g = seg(t, 0.5, 5.5)
    place(cv, dot(300, VENOM, int(40 * g)), 960, 520)
    place(cv, body_spr(), 960, 500)
    # organs turn green as venom reaches them
    organs = [((960, 330), 40, (255, 150, 170), 0.6), ((905, 430), 16, (200, 90, 60), 1.4), ((1015, 430), 16, (200, 90, 60), 1.4),
              ((1010, 450), 0, None, 0)]
    for k, ((ox, oy), rr, col, t0) in enumerate([((900, 300), 36, (240, 200, 210), 0.8), ((1020, 300), 36, (240, 200, 210), 1.0),
                                                 ((1000, 430), 42, (255, 170, 90), 2.0), ((905, 430), 16, (200, 110, 80), 2.6),
                                                 ((1015, 430), 16, (200, 110, 80), 2.8)]):
        c = mix(col, VENOM, seg(t, t0, t0 + 0.8))
        place(cv, dot(rr, tuple(int(v) for v in c), 230), ox, oy)
    beat = 1 + 0.12 * max(0.0, math.sin(t * 2 * math.pi * 1.3)) ** 4
    place(cv, sphere(34, (220, 60, 80), 0.5), 948, 350, scale=beat)
    place(cv, sphere(34, (235, 80, 100), 0.5), 972, 350, scale=beat)
    samp = [bezier_path(LOOP, k / 160) for k in range(161)]
    polyline(cv, samp, PALE, 3, 90)
    for i in range(14):                                     # circulation loop
        u = (t * 0.22 + i / 14) % 1.0
        x, y = bezier_path(LOOP, u)
        place(cv, dot(14, VENOM, 70), x, y)
        place(cv, dot(6, VENOM), x, y)
    label(cv, 'Circulates through the whole body', 1480, 300, t, 1.5, px=42, color=WHITE, bold=True)
    label(cv, 'Organs affected within minutes to hours', 1480, 370, t, 3.0, px=36, color=MUTED)

def s_types(cv, t):
    drift(cv, t, 5, 30)
    title(cv, 'Three main types of venom', t, y=120, px=60)
    cards = [
        ('Neurotoxins', 'Block nerve signals', 'Breathing can fail', VIOLET, 'bolt', 0.6),
        ('Hemotoxins', 'Destroy blood cells', 'Cause bleeding', CORAL, 'drop', 2.6),
        ('Cytotoxins', 'Kill tissue cells', 'Cause swelling and damage', TEAL, 'cell', 4.6),
    ]
    for i, (name, l1, l2, col, kind, t0) in enumerate(cards):
        cx = 420 + i * 540
        p = seg(t, t0, t0 + 0.9, eback)
        if p <= 0: continue
        place(cv, rrect(460, 460, 28, PANEL, 0.96), cx, 520, scale=p)
        place(cv, rrect(460, 8, 4, col), cx, 520 - 230 * p, scale=p)
        place(cv, ic_custom(kind, col), cx, 400 + 4 * math.sin(t * 3 + i), scale=p * (1 + 0.05 * math.sin(t * 4 + i)))
        place(cv, text_sprite(name, 48, col, True), cx, 540, alpha=clamp01(p))
        place(cv, text_sprite(l1, 34, WHITE), cx, 605, alpha=clamp01(p))
        place(cv, text_sprite(l2, 34, MUTED), cx, 655, alpha=clamp01(p))

@lru_cache(None)
def ic_custom(kind, col):
    S = 150
    def fn(d, ss):
        k = ss
        if kind == 'bolt':
            pts = [(.55, .02), (.25, .55), (.5, .55), (.35, .98), (.8, .4), (.55, .4), (.7, .02)]
            d.polygon([(x * S * k, y * S * k) for x, y in pts], fill=tuple(col) + (255,))
        elif kind == 'drop':
            d.ellipse([.18 * S * k, .38 * S * k, .82 * S * k, .98 * S * k], fill=tuple(col) + (255,))
            d.polygon([(.5 * S * k, .02 * S * k), (.2 * S * k, .55 * S * k), (.8 * S * k, .55 * S * k)], fill=tuple(col) + (255,))
        elif kind == 'cell':
            d.ellipse([.08 * S * k, .08 * S * k, .92 * S * k, .92 * S * k], outline=tuple(col) + (255,), width=int(.09 * S * k))
            d.line([(.32 * S * k, .32 * S * k), (.68 * S * k, .68 * S * k)], fill=AMBER + (255,), width=int(.09 * S * k))
            d.line([(.68 * S * k, .32 * S * k), (.32 * S * k, .68 * S * k)], fill=AMBER + (255,), width=int(.09 * S * k))
    return ss_sprite(S, S, fn)

def s_aid(cv, t):
    drift(cv, t, 6, 20)
    title(cv, 'What to do right now', t, y=120, px=60)
    do_items = ['Stay calm and keep still', 'Keep the limb below heart level',
                'Remove rings and tight clothing', 'Call emergency services now']
    dont_items = ['Cut the wound', 'Suck out the venom', 'Apply a tourniquet']
    place(cv, text_sprite('DO', 56, GREEN, True), 550, 260, alpha=seg(t, 0.2, 0.8))
    place(cv, text_sprite("DON'T", 56, CORAL, True), 1370, 260, alpha=seg(t, 4.0, 4.6))
    for i, s_ in enumerate(do_items):
        p = seg(t, 0.8 + 0.7 * i, 1.5 + 0.7 * i, eout)
        if p <= 0: continue
        y = 380 + i * 115
        x = mix(-300, 550, p)
        place(cv, rrect(780, 92, 22, PANEL, 0.96), x, y)
        place(cv, icon('check', 60), x - 340, y)
        place(cv, text_sprite(s_, 32, WHITE), x + 40, y)
    for i, s_ in enumerate(dont_items):
        p = seg(t, 4.2 + 0.7 * i, 4.9 + 0.7 * i, eout)
        if p <= 0: continue
        y = 380 + i * 115
        x = mix(2220, 1370, p)
        place(cv, rrect(780, 92, 22, PANEL, 0.96), x, y)
        place(cv, icon('cross', 60), x - 340, y)
        place(cv, text_sprite(s_, 32, WHITE), x + 40, y)

def s_outro(cv, t):
    drift(cv, t, 7, 30)
    p = seg(t, 0.2, 1.2, eback)
    for k in range(3):
        rr = 120 + 180 * (((t - 0.5 * k) % 2.4) / 2.4)
        ring(cv, 960, 420, rr, TEAL, int(160 * (1 - (rr - 120) / 180)), 4)
    place(cv, text_sprite('ANTIVENOM', 150, TEAL, True), 960, 400, scale=max(p, 0.001))
    label(cv, 'Get medical help immediately', 960, 580, t, 1.3, px=56, color=WHITE, bold=True)
    label(cv, 'Antivenom is the only specific treatment', 960, 660, t, 2.2, px=40, color=MUTED)
    fo = seg(t, 4.6, 5.4)
    if fo > 0:
        cv.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, int(255 * fo))))

# ---------------------------------------------------------------- timeline
SHAKE = {'s_hook': (1.4, 1.9, 22)}
SCRIPT = [
    ('s_hook', s_hook, 'snk_01.wav', 'fade', 'A snake bite can be life-threatening. Here is how its venom spreads.', 6.0),
    ('s_bite', s_bite, 'snk_02.wav', 'wipe', 'The snake drives two hollow fangs into the leg, injecting venom deep into the tissue.', 8.0),
    ('s_spread', s_spread, 'snk_03.wav', 'fade', 'The venom first breaks down local cells, causing swelling and pain.', 6.5),
    ('s_vessels', s_vessels, 'snk_04.wav', 'wipe', 'It then enters blood vessels and the lymph system, carried toward the heart.', 7.0),
    ('s_body', s_body, 'snk_05.wav', 'fade', 'From there it circulates through the whole body, reaching organs within minutes to hours.', 7.5),
    ('s_types', s_types, 'snk_06.wav', 'wipe', 'Neurotoxins block nerve signals, hemotoxins destroy blood and tissue, and cytotoxins kill cells.', 9.5),
    ('s_aid', s_aid, 'snk_07.wav', 'fade', 'Stay calm, keep the limb still and below heart level, and call emergency services now. Do not cut the wound, suck out venom, or use a tourniquet.', 12.0),
    ('s_outro', s_outro, 'snk_08.wav', 'wipe', 'Antivenom is the only specific treatment. Every minute counts.', 6.0),
]
SC = []

def wav_len(path):
    with wave.open(path) as w: return w.getnframes() / w.getframerate()

def build_timeline():
    start = 0.0
    for key, fn, wav, trans, text, min_dur in SCRIPT:
        L = wav_len(os.path.join(WORK, wav))
        dur = max(min_dur, L + 1.6)
        sents = [s_ for s_ in re.split(r'(?<=[.!?])\s+', text) if s_.strip()]
        tot = sum(len(s_) for s_ in sents); caps = []; acc = 0.0
        for s_ in sents:
            a = 0.5 + L * acc / tot; acc += len(s_); b = 0.5 + L * acc / tot
            caps.append((a, b, build_caption(s_, 36)))
        SC.append(dict(key=key, fn=fn, start=start, dur=dur, trans=trans, caps=caps, wav=wav))
        start += dur - TR
    return start + TR

def scene_canvas(sc, t):
    cv = background()
    sc['fn'](cv, t)
    caption(cv, sc['caps'], t)
    sh = SHAKE.get(sc['key'])
    if sh and sh[0] <= t <= sh[1]:
        amp = sh[2] * (1 - seg(t, sh[0], sh[1]))
        dx, dy = int(amp * math.sin(t * 70)), int(amp * math.cos(t * 53))
        out = Image.new('RGBA', (W, H), (4, 10, 20, 255))
        out.paste(cv, (dx, dy))
        cv = out
    return cv

def frame_canvas(T):
    active = [i for i, s_ in enumerate(SC) if s_['start'] <= T < s_['start'] + s_['dur']]
    if not active: active = [len(SC) - 1]
    if len(active) == 1:
        s_ = SC[active[0]]
        return scene_canvas(s_, T - s_['start'])
    a, b = active[0], active[1]
    sa, sb = SC[a], SC[b]
    p = eio((T - sb['start']) / TR)
    A = scene_canvas(sa, T - sa['start']); B = scene_canvas(sb, T - sb['start'])
    if sb['trans'] == 'fade':
        z = 1 + 0.06 * p
        Az = A.resize((int(W * z), int(H * z)), BL)
        ox, oy = (Az.width - W) // 2, (Az.height - H) // 2
        Az = Az.crop((ox, oy, ox + W, oy + H))
        Bz_s = 1.04 - 0.04 * p
        Bz = B.resize((int(W * Bz_s), int(H * Bz_s)), BL)
        bx, by = (Bz.width - W) // 2, (Bz.height - H) // 2
        Bz = Bz.crop((bx, by, bx + W, by + H))
        return Image.blend(Az, Bz, p)
    F = 260.0
    pos = -F + p * (W + 2 * F)
    xs = np.arange(W, dtype=np.float32)
    row = np.clip((pos - xs) / F + 0.5, 0, 1) * 255
    mask = Image.fromarray(np.tile(row.astype(np.uint8), (H, 1)), 'L')
    return Image.composite(B, A, mask)

def frame_bytes(T):
    cv = frame_canvas(T)
    arr = np.asarray(cv.convert('RGB'), dtype=np.float32)
    arr *= vignette()[..., None]
    if T < 0.5: arr *= eio(T / 0.5)
    return np.clip(arr, 0, 255).astype(np.uint8).tobytes()

def frame_bytes_idx(i):
    return frame_bytes(i / FPS)

def build_audio(total, rate=24000):
    n = int(total * rate) + 1
    left = np.zeros(n, np.float32)
    t = np.arange(n, dtype=np.float32) / rate
    pad = np.zeros(n, np.float32)
    for f, a in [(98.0, 0.5), (146.8, 0.35), (196.0, 0.4), (246.9, 0.18)]:
        pad += a * np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.07 * t))
    env = 0.55 + 0.45 * np.sin(2 * np.pi * 0.05 * t)
    fade = np.clip(np.minimum(t / 2.0, (total - t) / 3.0), 0, 1)
    left += 0.016 * pad * env * fade
    rng = np.random.default_rng(3)
    for s_ in SC[1:]:
        L = int(TR * rate * 1.1); i0 = int(s_['start'] * rate)
        noise = rng.standard_normal(L).astype(np.float32)
        y = np.zeros(L, np.float32); acc = 0.0
        for k in range(L):
            acc += (0.02 + 0.22 * (k / L) ** 1.5) * (noise[k] - acc); y[k] = acc
        y *= np.sin(np.pi * np.arange(L) / L) ** 2 * 0.9
        m = max(0, min(L, n - i0)); left[i0:i0 + m] += y[:m] * 0.22
    # impact thump at the snake strike
    i0 = int(1.25 * rate); L = int(0.6 * rate); tt = np.arange(L) / rate
    thump = np.sin(2 * np.pi * (60 - 40 * tt) * tt) * np.exp(-6 * tt) * 0.5
    m = min(L, n - i0); left[i0:i0 + m] += thump[:m]
    for s_ in SC:
        w = wave.open(os.path.join(WORK, s_['wav']))
        raw = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32767
        w.close()
        raw = raw / max(1e-6, np.max(np.abs(raw))) * 0.9
        i0 = int((s_['start'] + 0.5) * rate); end = min(n, i0 + len(raw))
        left[i0:end] += raw[: end - i0]
    left = np.clip(left, -0.98, 0.98)
    return np.stack([left, left], -1)

def write_wav(path, samples, rate):
    data = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate); w.writeframes(data.tobytes())

def main():
    total = build_timeline()
    nframes = int(round(total * FPS))
    audio_path = os.path.join(WORK, 'snake_mix.wav')
    write_wav(audio_path, build_audio(total), 24000)
    print('timeline total', round(total, 2), 's, frames', nframes, flush=True)
    for s_ in SC: print(s_['key'], round(s_['start'], 2), round(s_['dur'], 2), flush=True)
    if len(sys.argv) > 1 and sys.argv[1] == 'preview':
        for T in [float(x) for x in sys.argv[2:]]:
            arr = np.frombuffer(frame_bytes(T), np.uint8).reshape(H, W, 3)
            Image.fromarray(arr).save(os.path.join(WORK, 'snk_preview_%05.2f.png' % T))
            print('saved', T, flush=True)
        return
    cmd = [FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', audio_path, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-t', f'{total:.3f}', OUT]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    from multiprocessing import Pool
    with Pool(2) as pool:
        for i, buf in enumerate(pool.imap(frame_bytes_idx, range(nframes), chunksize=12)):
            proc.stdin.write(buf)
            if i % 300 == 0: print('frame', i, '/', nframes, flush=True)
    proc.stdin.close(); proc.wait()
    print('done ->', OUT, flush=True)

if __name__ == '__main__':
    main()
