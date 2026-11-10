#!/usr/bin/env python3
"""
2D motion-graphics explainer: How antibiotics work inside the body (Hindi narration).
Pure Python rendering (Pillow + numpy + uharfbuzz/freetype for Devanagari shaping).
Keyframed animation with easing curves, crossfade/wipe scene transitions,
Devanagari captions, generated ambient score + transition whooshes, H.264 output.
"""
import math, os, re, sys, wave, random, subprocess
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw
import uharfbuzz as hb
import freetype

W, H, FPS = 1920, 1080, 30
TR = 0.8                       # transition length (s)
BASE = '/home/user/antibiotics-video'
WORK = BASE + '/work'
FFMPEG = '/home/user/video-env/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v9.0.2'
DEV, DEVB = BASE + '/fonts/dev400.ttf', BASE + '/fonts/dev700.ttf'
LAT, LATB = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
RS, BL = Image.Resampling.LANCZOS, Image.Resampling.BICUBIC

WHITE = (245, 247, 250); MUTED = (141, 162, 190); TEAL = (46, 196, 182); AMBER = (255, 191, 105)
CORAL = (255, 107, 107); SKY = (123, 223, 242); GREEN = (120, 220, 150); VIOLET = (170, 140, 255)
PANEL = (14, 38, 66); DARK = (6, 14, 28)

# ---------------------------------------------------------------- easing / keyframes
def clamp01(x): return 0.0 if x < 0 else (1.0 if x > 1 else x)
def eio(t):
    t = clamp01(t); return 0.5 - 0.5 * math.cos(math.pi * t)
def eout(t):
    t = clamp01(t); return 1 - (1 - t) ** 3
def ein(t):
    t = clamp01(t); return t ** 3
def eback(t):
    c1 = 1.70158; c3 = c1 + 1; t = clamp01(t)
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
def mix(a, b, p):
    if isinstance(a, tuple): return tuple(x + (y - x) * p for x, y in zip(a, b))
    return a + (b - a) * p
def seg(t, t0, t1, ease=eio):
    """Progress from t0 to t1 mapped through an easing curve (clamped)."""
    return ease((t - t0) / (t1 - t0)) if t1 > t0 else (1.0 if t >= t1 else 0.0)
def kf(t, keys, ease=eio):
    """Keyframes: list of (time, value). Eased interpolation between neighbours."""
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1: return mix(v0, v1, ease((t - t0) / (t1 - t0)))
    return keys[-1][1]

# ---------------------------------------------------------------- text (HarfBuzz shaping + FreeType raster)
_faces, _hbf, _glyphs, _txt = {}, {}, {}, {}
def _face(path, px):
    k = (path, px)
    if k not in _faces:
        f = freetype.Face(path); f.set_pixel_sizes(0, px); _faces[k] = f
    return _faces[k]
def _hbfont(path):
    if path not in _hbf:
        fa = hb.Face(hb.Blob.from_file_path(path)); _hbf[path] = (hb.Font(fa), fa.upem)
    return _hbf[path]
def _glyph(path, px, gid):
    k = (path, px, gid)
    if k not in _glyphs:
        f = _face(path, px)
        f.load_glyph(gid, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
        g = f.glyph; bm = g.bitmap
        arr = None
        if bm.rows and bm.width:
            arr = np.frombuffer(bytes(bm.buffer), np.uint8).reshape(bm.rows, bm.pitch)[:, :bm.width].copy()
        _glyphs[k] = (arr, g.bitmap_left, g.bitmap_top)
    return _glyphs[k]

def text_sprite(s, px=40, color=WHITE, bold=False):
    key = (s, px, color, bold)
    if key in _txt: return _txt[key]
    dev_path, lat_path = (DEVB, LATB) if bold else (DEV, LAT)
    devface = _face(dev_path, px)
    ops, pen = [], 0.0
    for wi, word in enumerate(s.split(' ')):
        if wi > 0: pen += px * 0.26
        runs = []
        for ch in word:
            k = 'd' if devface.get_char_index(ord(ch)) else 'l'
            if runs and runs[-1][0] == k: runs[-1][1] += ch
            else: runs.append([k, ch])
        for k, txt in runs:
            path = dev_path if k == 'd' else lat_path
            fo, upem = _hbfont(path)
            buf = hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties()
            hb.shape(fo, buf, {"kern": True, "liga": True})
            sc = px / upem
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
                ops.append((path, info.codepoint, pen + pos.x_offset * sc, pos.y_offset * sc))
                pen += pos.x_advance * sc
    asc, desc, pad = int(px * 1.25), int(px * 0.5), max(4, px // 5)
    cw, ch = int(pen + 2 * pad) + 2, asc + desc + 2 * pad
    mask = np.zeros((ch, cw), np.float32); base = pad + asc
    for path, gid, x, yo in ops:
        arr, l, t = _glyph(path, px, gid)
        if arr is None: continue
        y0 = int(round(base - t - yo)); x0 = int(round(pad + x + l))
        h, w = arr.shape
        ys0, ys1 = max(0, y0), min(ch, y0 + h); xs0, xs1 = max(0, x0), min(cw, x0 + w)
        if ys1 <= ys0 or xs1 <= xs0: continue
        src = arr[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0].astype(np.float32) / 255
        mask[ys0:ys1, xs0:xs1] = np.maximum(mask[ys0:ys1, xs0:xs1], src)
    out = np.zeros((ch, cw, 4), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = color
    out[..., 3] = (mask * 255).astype(np.uint8)
    spr = Image.fromarray(out)
    _txt[key] = spr
    return spr

# ---------------------------------------------------------------- sprite primitives
def sdf_sprite(w, h, sdf, col, opacity=1.0):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx += 0.5; yy += 0.5
    a = np.clip(0.5 - sdf(xx, yy), 0, 1) * opacity
    if callable(col): c = col(xx, yy)
    elif isinstance(col, tuple):
        c = np.empty((h, w, 3), np.float32); c[:] = col
    else: c = col
    out = np.empty((h, w, 4), np.uint8)
    out[..., :3] = np.clip(c, 0, 255)
    out[..., 3] = a * 255
    return Image.fromarray(out)

def ss_sprite(w, h, fn, ss=3):
    big = Image.new('RGBA', (w * ss, h * ss), (0, 0, 0, 0))
    fn(ImageDraw.Draw(big), ss)
    return big.resize((w, h), RS)

def capsule_sdf(x1, y1, x2, y2, r):
    bax, bay = x2 - x1, y2 - y1
    def f(x, y):
        pax, pay = x - x1, y - y1
        h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-9), 0, 1)
        return np.hypot(pax - bax * h, pay - bay * h) - r
    return f

def rrect_sdf(w, h, r):
    def f(x, y):
        qx = np.abs(x - w / 2) - (w / 2 - r); qy = np.abs(y - h / 2) - (h / 2 - r)
        return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    return f

@lru_cache(None)
def rrect(w, h, r, color, opacity=1.0):
    return sdf_sprite(w, h, rrect_sdf(w, h, r), color, opacity)

@lru_cache(None)
def sphere(r, base, k=0.42):
    d = int(2 * r) + 4; c = d / 2
    def col(x, y):
        u = (x - c) / r; v = (y - c) / r
        hl = np.clip(1 - np.hypot(u + 0.35, v + 0.4) / 1.1, 0, 1) ** 2 * k
        sh = np.clip(0.8 - 0.2 * v, 0.6, 1.0)
        out = np.empty(x.shape + (3,), np.float32)
        for i in range(3): out[..., i] = base[i] * sh * (1 - hl) + 255 * hl
        return out
    return sdf_sprite(d, d, lambda x, y: np.hypot(x - c, y - c) - r, col)

@lru_cache(None)
def dot(r, color, alpha=255):
    d = int(2 * r) + 4; c = d / 2
    return sdf_sprite(d, d, lambda x, y: np.hypot(x - c, y - c) - r, color, alpha / 255)

@lru_cache(None)
def ellipse(rx, ry, color, opacity=1.0):
    w, h = int(2 * rx) + 6, int(2 * ry) + 6; cx, cy = w / 2, h / 2
    return sdf_sprite(w, h, lambda x, y: (np.hypot((x - cx) / rx, (y - cy) / ry) - 1) * min(rx, ry), color, opacity)

def place(cv, spr, x, y, scale=1.0, rot=0.0, alpha=1.0):
    """Composite sprite centred at (x,y) with scale/rotation/opacity, clipped to canvas."""
    if alpha <= 0.003 or scale <= 0.003: return
    if scale != 1.0:
        w = max(1, int(round(spr.width * scale))); h = max(1, int(round(spr.height * scale)))
        if w < 2 or h < 2: return
        spr = spr.resize((w, h), BL)
    if rot: spr = spr.rotate(rot, resample=BL, expand=True)
    if alpha < 1.0:
        spr = spr.copy(); spr.putalpha(spr.getchannel('A').point(lambda v: int(v * alpha + 0.5)))
    X = int(round(x - spr.width / 2)); Y = int(round(y - spr.height / 2))
    sx0, sy0 = max(0, -X), max(0, -Y)
    sx1, sy1 = min(spr.width, W - X), min(spr.height, H - Y)
    if sx1 <= sx0 or sy1 <= sy0: return
    if (sx0, sy0, sx1, sy1) != (0, 0, spr.width, spr.height): spr = spr.crop((sx0, sy0, sx1, sy1))
    cv.alpha_composite(spr, (X + sx0, Y + sy0))

def polyline(cv, pts, color, width=6, alpha=255):
    if len(pts) < 2: return
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0 = int(min(xs)) - width - 4; y0 = int(min(ys)) - width - 4
    w = int(max(xs)) - x0 + width + 4; h = int(max(ys)) - y0 + width + 4
    if w < 2 or h < 2 or w > 4000 or h > 3000: return
    ss = 3
    big = Image.new('RGBA', (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    P = [((x - x0) * ss, (y - y0) * ss) for x, y in pts]
    d.line(P, fill=tuple(color) + (alpha,), width=max(1, int(width * ss)), joint='curve')
    place(cv, big.resize((w, h), RS), x0 + w / 2, y0 + h / 2)

def bezier_path(points, u):
    """Catmull-Rom spline through points, u in [0,1]."""
    n = len(points) - 1
    f = clamp01(u) * n; i = min(int(f), n - 1); t = f - i
    p0 = points[max(i - 1, 0)]; p1 = points[i]; p2 = points[i + 1]; p3 = points[min(i + 2, n)]
    def cr(a, b, c, d):
        return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
    return (cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]))

# ---------------------------------------------------------------- molecules / biology sprites
def mol_sprite(atoms, bonds, bond_col=(205, 215, 230)):
    xs = [a[0] - a[2] for a in atoms]; ys = [a[1] - a[2] for a in atoms]
    xe = [a[0] + a[2] for a in atoms]; ye = [a[1] + a[2] for a in atoms]
    pad = 10
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = int(max(xe) - x0 + pad), int(max(ye) - y0 + pad)
    def fn(d, ss):
        for i, j in bonds:
            a, b = atoms[i], atoms[j]
            d.line([((a[0] - x0) * ss, (a[1] - y0) * ss), ((b[0] - x0) * ss, (b[1] - y0) * ss)],
                   fill=tuple(bond_col) + (255,), width=int(6 * ss))
        for x, y, r, c in atoms:
            cx, cy, rr = (x - x0) * ss, (y - y0) * ss, r * ss
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=tuple(c) + (255,))
    return ss_sprite(w, h, fn)

def hex_chain(n, R=24, tail=True):
    s3 = math.sqrt(3); verts = {}; edges = set()
    for i in range(n):
        cx = i * s3 * R
        vs = []
        for k in range(6):
            a = math.radians(30 + 60 * k)
            key = (round(cx + R * math.cos(a), 1), round(R * math.sin(a), 1))
            verts[key] = 1; vs.append(key)
        for k in range(6):
            edges.add(tuple(sorted([vs[k], vs[(k + 1) % 6]])))
    keys = list(verts.keys()); idx = {k: i for i, k in enumerate(keys)}
    atoms = [(k[0], k[1], 5, (AMBER if (i * 7) % 5 == 0 else WHITE) if i % 4 else CORAL) for i, k in enumerate(keys)]
    bonds = [(idx[a], idx[b]) for a, b in edges]
    if tail:
        rx, ry = max(keys)
        last = idx[(rx, ry)]
        atoms += [(rx + 26, ry + 18, 5, WHITE), (rx + 26, ry + 52, 6, CORAL)]
        bonds += [(last, len(atoms) - 2), (len(atoms) - 2, len(atoms) - 1)]
    return atoms, bonds

@lru_cache(None)
def penicillin_spr():
    A = [(0, 0), (56, 0), (74, 46), (28, 76), (-18, 46)]
    B = [(100, -10), (118, 36)]
    at = [(x, y, 6, WHITE) for x, y in A] + [(x, y, 6, WHITE) for x, y in B]
    at += [(-50, 20, 6, WHITE), (-78, -24, 6, WHITE), (-30, -48, 6, TEAL), (-100, 4, 7, CORAL), (-72, 56, 7, CORAL)]
    bo = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 5), (5, 6), (6, 2), (4, 7), (7, 8), (8, 9), (8, 10), (8, 11)]
    return mol_sprite(at, bo)

@lru_cache(None)
def tetra_spr():
    a, b = hex_chain(3, 24, tail=True)
    return mol_sprite(a, b)

@lru_cache(None)
def quin_spr():
    a, b = hex_chain(2, 26, tail=True)
    return mol_sprite(a, b)

@lru_cache(None)
def bact_big():
    w, h, r, cy = 560, 260, 130, 130
    cx1, cx2 = 130, 430
    seg_d = capsule_sdf(cx1, cy, cx2, cy, r)
    wall = sdf_sprite(w, h, lambda x, y: seg_d(x, y), lambda x, y: np.stack([
        250 - 30 * np.abs(y - cy) / r, 182 - 40 * np.abs(y - cy) / r, 100 - 30 * np.abs(y - cy) / r], -1))
    cyto = sdf_sprite(w, h, capsule_sdf(cx1, cy, cx2, cy, r - 24),
                      lambda x, y: np.stack([30 - 12 * (y - cy) / r, 66 - 14 * (y - cy) / r, 106 - 16 * (y - cy) / r], -1))
    ring = sdf_sprite(w, h, lambda x, y: np.abs(seg_d(x, y) - (r - 24)) - 2.2, TEAL, 0.9)
    base = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    base.alpha_composite(wall); base.alpha_composite(cyto); base.alpha_composite(ring)
    def dna(d, ss):
        P1, P2, rungs = [], [], []
        for k in range(0, 121):
            x = 180 + k
            th = (x - 180) / 9.0
            y1 = cy + 15 * math.sin(th); y2 = cy - 15 * math.sin(th)
            P1.append(((x) * ss, y1 * ss)); P2.append(((x) * ss, y2 * ss))
            if k % 7 == 0: rungs.append(((x * ss, y1 * ss), (x * ss, y2 * ss)))
        d.line(P1, fill=(255, 226, 130, 255), width=3 * ss, joint='curve')
        d.line(P2, fill=(255, 226, 130, 255), width=3 * ss, joint='curve')
        for a, b in rungs: d.line([a, b], fill=(255, 226, 130, 170), width=2 * ss)
    base.alpha_composite(ss_sprite(w, h, dna))
    for (x, y) in [(350, 100), (388, 160), (326, 168)]:
        base.alpha_composite(sphere(13, TEAL), (x - 15, y - 15))
    return base

@lru_cache(None)
def rod(color=CORAL, w=120, h=50):
    r = h / 2
    s = capsule_sdf(r, r, w - r, r, r)
    body = sdf_sprite(w, h, s, lambda x, y: np.stack([
        np.clip(color[0] + 40 - 60 * (y - r) / r, 0, 255) * np.ones_like(x),
        np.clip(color[1] + 20 - 40 * (y - r) / r, 0, 255) * np.ones_like(x),
        np.clip(color[2] + 20 - 40 * (y - r) / r, 0, 255) * np.ones_like(x)], -1))
    hl = ss_sprite(w, h, lambda d, ss: d.ellipse([10 * ss, 8 * ss, (w - 30) * ss, 20 * ss], fill=(255, 255, 255, 70)))
    body.alpha_composite(hl)
    return body

@lru_cache(None)
def human_cell(r=170):
    d = 2 * r + 6; c = d / 2
    body = sdf_sprite(d, d, lambda x, y: np.hypot(x - c, y - c) - r,
                      lambda x, y: np.stack([160 - 30 * (y - c) / r, 232 - 20 * (y - c) / r, 196 - 20 * (y - c) / r], -1))
    rim = sdf_sprite(d, d, lambda x, y: np.abs(np.hypot(x - c, y - c) - (r - 6)) - 2, (90, 170, 140), 0.8)
    body.alpha_composite(rim)
    body.alpha_composite(sphere(56, (110, 178, 150), 0.3), (int(c - 56 - 30 + 10), int(c - 56 - 10)))
    for (x, y) in [(c - 90, c - 80), (c + 100, c - 40), (c + 70, c + 90), (c - 110, c + 60), (c + 20, c - 120)]:
        body.alpha_composite(dot(7, TEAL), (int(x - 11), int(y - 11)))
    return body

@lru_cache(None)
def phagocyte(r=190):
    d = 2 * r + 8; c = d / 2
    body = sdf_sprite(d, d, lambda x, y: np.hypot(x - c, y - c) - r,
                      lambda x, y: np.stack([240 - 20 * (y - c) / r, 245 - 15 * (y - c) / r, 252 - 10 * (y - c) / r], -1))
    for (x, y, rr) in [(c - 45, c - 30, 52), (c + 40, c - 40, 46), (c + 10, c + 40, 58)]:
        body.alpha_composite(sphere(rr, (120, 150, 200), 0.3), (int(x - rr - 2), int(y - rr - 2)))
    for k in range(18):
        a = k * 2.4; rr = 110 + (k * 37) % 60
        body.alpha_composite(dot(5, (150, 176, 214), 200), (int(c + rr * math.cos(a) - 9), int(c + rr * math.sin(a) - 9)))
    return body

@lru_cache(None)
def ribo_big():
    d = 340
    large = sphere(135, TEAL, 0.45); small = sphere(92, (110, 225, 214), 0.5)
    base = Image.new('RGBA', (d, d), (0, 0, 0, 0))
    lx, ly = d / 2 - 0, d / 2 + 40   # large subunit centre
    sx, sy = d / 2 + 0, d / 2 - 80   # small subunit centre
    base.alpha_composite(large, (int(lx - large.width / 2), int(ly - large.height / 2)))
    base.alpha_composite(small, (int(sx - small.width / 2), int(sy - small.height / 2)))
    return base

@lru_cache(None)
def pill_spr():
    w, h = 340, 150; r = 75
    s = capsule_sdf(r, r, w - r, r, r)
    return sdf_sprite(w, h, s, lambda x, y: np.where(
        (x < w / 2)[..., None], np.array(AMBER, np.float32)[None, None, :] * np.ones((h, w, 1), np.float32),
        np.array(TEAL, np.float32)[None, None, :] * np.ones((h, w, 1), np.float32)))

@lru_cache(None)
def capsule_small(color=AMBER, w=92, h=40):
    r = h / 2
    return sdf_sprite(w, h, capsule_sdf(r, r, w - r, r, r), color)

# ---------------------------------------------------------------- icons
@lru_cache(None)
def icon(kind, size=110):
    S = size
    def fn(d, ss):
        k = ss
        if kind == 'check':
            d.line([(S * .2 * k, S * .55 * k), (S * .42 * k, S * .76 * k), (S * .8 * k, S * .26 * k)], fill=GREEN + (255,), width=int(S * .12 * k), joint='curve')
        elif kind == 'cross':
            d.line([(S * .25 * k, S * .25 * k), (S * .75 * k, S * .75 * k)], fill=CORAL + (255,), width=int(S * .12 * k))
            d.line([(S * .75 * k, S * .25 * k), (S * .25 * k, S * .75 * k)], fill=CORAL + (255,), width=int(S * .12 * k))
        elif kind == 'warn':
            d.polygon([(S * .5 * k, S * .08 * k), (S * .95 * k, S * .9 * k), (S * .05 * k, S * .9 * k)], fill=AMBER + (255,))
            d.rectangle([S * .46 * k, S * .36 * k, S * .54 * k, S * .66 * k], fill=DARK + (255,))
            d.ellipse([S * .45 * k, S * .72 * k, S * .55 * k, S * .8 * k], fill=DARK + (255,))
        elif kind == 'virus':
            c = S / 2
            for a in range(0, 360, 45):
                x2 = c + math.cos(math.radians(a)) * S * .42; y2 = c + math.sin(math.radians(a)) * S * .42
                d.line([(c * k, c * k), (x2 * k, y2 * k)], fill=CORAL + (255,), width=int(S * .06 * k))
                d.ellipse([(x2 - S * .06) * k, (y2 - S * .06) * k, (x2 + S * .06) * k, (y2 + S * .06) * k], fill=CORAL + (255,))
            d.ellipse([(c - S * .24) * k, (c - S * .24) * k, (c + S * .24) * k, (c + S * .24) * k], fill=CORAL + (255,))
            d.line([(S * .15 * k, S * .15 * k), (S * .85 * k, S * .85 * k)], fill=DARK + (255,), width=int(S * .07 * k))
            d.line([(S * .85 * k, S * .15 * k), (S * .15 * k, S * .85 * k)], fill=DARK + (255,), width=int(S * .07 * k))
        elif kind == 'wall':
            d.ellipse([S * .08 * k, S * .08 * k, S * .92 * k, S * .92 * k], outline=AMBER + (255,), width=int(S * .1 * k))
            d.ellipse([S * .26 * k, S * .26 * k, S * .74 * k, S * .74 * k], outline=TEAL + (255,), width=int(S * .05 * k))
        elif kind == 'beads':
            pts = [(S * (.1 + .2 * i), S * (.5 + (.2 if i % 2 else -.15))) for i in range(5)]
            d.line([(x * k, y * k) for x, y in pts], fill=(200, 210, 225, 255), width=int(S * .05 * k), joint='curve')
            for x, y in pts: d.ellipse([(x - .09 * S) * k, (y - .09 * S) * k, (x + .09 * S) * k, (y + .09 * S) * k], fill=AMBER + (255,))
        elif kind == 'helix':
            A = [(S * (.1 + .8 * i / 60), S * .5 + S * .3 * math.sin(i / 60 * 2 * math.pi * 1.5)) for i in range(61)]
            B = [(x, S * 1.0 - y) for x, y in A]
            d.line([(x * k, y * k) for x, y in A], fill=SKY + (255,), width=int(S * .06 * k), joint='curve')
            d.line([(x * k, y * k) for x, y in B], fill=VIOLET + (255,), width=int(S * .06 * k), joint='curve')
            for i in range(0, 61, 6):
                d.line([(A[i][0] * k, A[i][1] * k), (B[i][0] * k, B[i][1] * k)], fill=(200, 210, 225, 200), width=int(S * .03 * k))
    return ss_sprite(S, S, fn)

# ---------------------------------------------------------------- scene helpers
_BGL = None
def background():
    global _BGL
    if _BGL is None:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        top, bot = np.array([11, 28, 50], np.float32), np.array([5, 13, 26], np.float32)
        g = (yy / H)[..., None]
        base = top * (1 - g) + bot * g
        d = np.hypot((xx - 960) / 1000, (yy - 470) / 620)
        glow = np.clip(1 - d, 0, 1)[..., None] ** 2 * np.array([22, 52, 74], np.float32)
        base = base + glow
        grid = ((xx % 60 < 1.6) & (yy % 60 < 1.6))[..., None] * np.array([40, 70, 96], np.float32) * 0.35
        base = base + grid
        _BGL = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert('RGBA')
    return _BGL.copy()

_VIG = None
def vignette():
    global _VIG
    if _VIG is None:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
        _VIG = (1 - 0.32 * np.clip(d - 0.55, 0, 1) ** 1.6).astype(np.float32)
    return _VIG

def drift(cv, t, seed, n=26):
    rnd = random.Random(seed)
    for i in range(n):
        x0, y0 = rnd.uniform(0, W), rnd.uniform(0, H)
        sp = rnd.uniform(6, 16); ph = rnd.uniform(0, 6.28); r = rnd.choice([2, 2, 3, 4])
        x = (x0 + t * sp) % W; y = y0 + 14 * math.sin(t * 0.7 + ph)
        place(cv, dot(r, SKY, int(rnd.uniform(30, 90))), x, y)

def title(cv, s, t, y=120, px=64, t0=0.15, color=WHITE):
    p = seg(t, t0, t0 + 0.7, eout)
    if p <= 0: return
    spr = text_sprite(s, px, color, True)
    place(cv, spr, W / 2, y + (1 - p) * 26, alpha=p)
    u = seg(t, t0 + 0.35, t0 + 1.1)
    if u > 0:
        place(cv, rrect(int(260 * u) + 2, 5, 2, TEAL), W / 2, y + spr.height / 2 + 14)

def label(cv, s, x, y, t, t0, px=44, color=WHITE, bold=False, align='center'):
    p = seg(t, t0, t0 + 0.6, eout)
    if p <= 0: return
    spr = text_sprite(s, px, color, bold)
    xx = x if align == 'center' else x + spr.width / 2
    place(cv, spr, xx, y + (1 - p) * 14, alpha=p)

def wrap(s, px=38, maxw=1500):
    lines, cur = [], ''
    for wd in s.split(' '):
        cand = (cur + ' ' + wd).strip()
        if cur and text_sprite(cand, px).width > maxw: lines.append(cur); cur = wd
        else: cur = cand
    if cur: lines.append(cur)
    return lines

def build_caption(sentence, px=38):
    lines = wrap(sentence, px)
    sprs = [text_sprite(l, px, WHITE) for l in lines]
    lw = max(s_.width for s_ in sprs); lh = int(px * 1.55)
    bw, bh = lw + 80, len(lines) * lh + 30
    bar = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    bar.alpha_composite(rrect(bw, bh, 18, DARK, 0.78))
    for i, sp in enumerate(sprs):
        bar.alpha_composite(sp, (int((bw - sp.width) / 2), int(15 + i * lh + (lh - sp.height) / 2 + px * 0.1)))
    return bar

CAP_Y = 972
def caption(cv, caps, t):
    for t0, t1, spr in caps:
        if t0 - 0.05 <= t < t1 + 0.05:
            a = min(seg(t, t0, t0 + 0.3, eout), 1 - seg(t, t1 - 0.25, t1, eio))
            place(cv, spr, W / 2, CAP_Y + (1 - a) * 12, alpha=a)
            return

# ---------------------------------------------------------------- scenes
def s1(cv, t):
    drift(cv, t, 1)
    for i, (x, y, a) in enumerate([(230, 260, 0.35), (1640, 230, 0.3), (1580, 820, 0.3), (300, 830, 0.28)]):
        place(cv, rod(MUTED, 120, 46), x + 40 * math.sin(t * 0.6 + i), y + 20 * math.cos(t * 0.5 + i), rot=-18 + 20 * i, alpha=a)
    sc = seg(t, 0.0, 1.1, eback)
    ang = kf(t, [(0, -28), (1.8, 0)], eout)
    place(cv, pill_spr(), 960, 400 + 10 * math.sin(t * 1.6), scale=max(sc, 0.001), rot=ang)
    p = seg(t, 0.6, 1.4, eout)
    place(cv, text_sprite('एंटीबायोटिक्स कैसे काम करते हैं?', 84, WHITE, True), 960, 610 + (1 - p) * 30, alpha=p)
    u = seg(t, 1.0, 1.9)
    if u > 0: place(cv, rrect(int(520 * u) + 2, 5, 2, AMBER), 960, 668)
    label(cv, 'शरीर के अंदर की एक 2D एनिमेटेड यात्रा', 960, 712, t, 1.4, px=42, color=MUTED)

def s2(cv, t):
    drift(cv, t, 2)
    place(cv, ellipse(330, 215, (26, 56, 88), 0.8), 960, 520, scale=seg(t, 0, 0.9, eout) * (1 + 0.012 * math.sin(t * 2)))
    label(cv, 'संक्रमित ऊतक', 960, 790, t, 0.8, px=36, color=MUTED)
    n = 0
    for nd in BACT_TREE:
        if t < nd['born']: continue
        n += 1
        mv = seg(t, nd['born'], nd['born'] + 0.9, eout)
        x, y = mix(nd['src'], nd['pos'], mv)
        sc = seg(t, nd['born'], nd['born'] + 0.5, eback) * 0.95
        ang = nd['ang'] + 7 * math.sin(t * 2 + nd['src'][0] * 0.01)
        place(cv, rod(CORAL), x, y, scale=sc, rot=ang)
    label(cv, 'बैक्टीरिया की संख्या', 1640, 150, t, 0.2, px=40, color=MUTED)
    place(cv, text_sprite(str(n), 120, AMBER, True), 1640, 260)

def s3(cv, t):
    drift(cv, t, 3)
    title(cv, 'बैक्टीरिया की बनावट', t)
    sc = mix(0.62, 1.0, eout(t / 1.6)) if t < 1.6 else 1.0
    cx, cy = 700, 540
    bact = bact_big()
    place(cv, bact, cx, cy, scale=sc * (1 + 0.006 * math.sin(t * 1.5)))
    def P(px_, py_):
        return (cx + (px_ - 280) * sc, cy + (py_ - 130) * sc)
    labs = [('कोशिका भित्ति', P(280, 0), (1090, 290), 3.0),
            ('झिल्ली', P(523, 76), (1090, 430), 5.0),
            ('DNA', P(240, 130), (1090, 570), 7.0),
            ('राइबोसोम: प्रोटीन की फ़ैक्ट्री', P(385, 160), (1090, 730), 9.0)]
    for txt, (tx, ty), (lx, ly), t0 in labs:
        p = seg(t, t0, t0 + 0.7, eout)
        if p <= 0: continue
        elbow = (lx - 40, ly)
        pts = [(tx, ty), (tx + (elbow[0] - tx) * 0.5, ty + (elbow[1] - ty) * 0.2), elbow]
        segs = []; total = 0
        for a, b in zip(pts, pts[1:]):
            segs.append((a, b, math.hypot(b[0] - a[0], b[1] - a[1]))); total += segs[-1][2]
        need = p * total; acc = 0; out = [pts[0]]
        for a, b, l_ in segs:
            if acc + l_ <= need: out.append(b); acc += l_
            else:
                f = (need - acc) / max(l_, 1e-6); out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)); break
        polyline(cv, out, WHITE, 3, int(220 * p))
        place(cv, dot(9, AMBER), tx, ty, alpha=p)
        place(cv, dot(16, AMBER, 60), tx, ty, scale=0.8 + 0.4 * math.sin(t * 3 + t0) ** 2)
        label(cv, txt, lx + 20, ly, t, t0 + 0.2, px=44, align='left', bold=False)

def s4(cv, t):
    drift(cv, t, 4)
    title(cv, 'तरीका 1: कोशिका भित्ति पर हमला', t)
    cx, cy = 1180, 560
    sc = kf(t, [(0, 0.9), (2.0, 1.0)], eout)
    bact = bact_big()
    vis = 1 - seg(t, 8.15, 8.32, eio)
    grow = 1 + 0.22 * ein(seg(t, 6.0, 8.1))
    if vis > 0:
        place(cv, bact, cx, cy, scale=sc * grow, alpha=vis)
    # penicillin-type molecule docks on the wall
    mx = kf(t, [(0, 200), (2.0, 200), (3.6, 868)], eout)
    mv = seg(t, 0.2, 0.8, eout) * (1 - seg(t, 8.0, 8.3))
    if t >= 0.2:
        place(cv, penicillin_spr(), mx, cy - 6 + 6 * math.sin(t * 4) * (1 - seg(t, 3.6, 4.2)), rot=kf(t, [(0, -15), (3.6, 4)], eout), alpha=mv)
        if t < 8.0: label(cv, 'पेनिसिलिन', mx, 690, t, 2.4, px=36, color=AMBER)
    # glow where the drug binds
    g = seg(t, 3.6, 4.2) * (1 - seg(t, 5.5, 6.2))
    if g > 0: place(cv, dot(90, AMBER, int(70 * g)), 900, cy)
    # cracks
    rnd = random.Random(11)
    for k in range(5):
        base_a = math.radians(160 + k * 10 - 20)
        pts = [(900, cy)]
        x, y = 900, cy
        for s_ in range(5):
            x += math.cos(base_a + rnd.uniform(-0.4, 0.4)) * 26
            y += math.sin(base_a + rnd.uniform(-0.4, 0.4)) * 26
            pts.append((x, y))
        p = seg(t, 4.3 + 0.1 * k, 5.0 + 0.1 * k, eout)
        fade_c = 1 - seg(t, 8.0, 8.3, eio)
        if p > 0 and fade_c > 0:
            n = max(2, int(len(pts) * p + 0.5))
            polyline(cv, pts[:n], (30, 16, 40), 6, int(255 * fade_c))
            polyline(cv, pts[:n], (255, 240, 200), 2, int(230 * fade_c))
    # burst particles
    b = seg(t, 8.15, 9.9, eout)
    if b > 0:
        rnd2 = random.Random(5)
        for k in range(24):
            a = rnd2.uniform(0, 2 * math.pi); dist = rnd2.uniform(180, 420)
            px_ = cx + math.cos(a) * dist * b; py_ = cy + math.sin(a) * dist * b * 0.8
            al = 1 - seg(t, 8.9, 9.9, eio)
            if al > 0: place(cv, rod(CORAL, 40, 16), px_, py_, rot=math.degrees(a) + 90 * b, alpha=al)
    label(cv, 'बैक्टीरिया नष्ट', cx, 800, t, 9.6, px=52, color=WHITE, bold=True)

def s5(cv, t):
    drift(cv, t, 5)
    title(cv, 'तरीका 2: प्रोटीन बनने से रोकना', t)
    cx, cy = 900, 560
    # mRNA strand behind ribosome
    def mrna_fn(d, ss):
        d.line([((x) * ss, (80 + 16 * math.sin(x / 90.0 + t * 1.2)) * ss) for x in range(0, 1401, 4)],
               fill=SKY + (200,), width=5 * ss, joint='curve')
        for x in range(40, 1400, 110):
            yy_ = 80 + 16 * math.sin(x / 90.0 + t * 1.2)
            d.ellipse([(x - 6) * ss, (yy_ - 6) * ss, (x + 6) * ss, (yy_ + 6) * ss], fill=SKY + (230,))
    place(cv, ss_sprite(1400, 160, mrna_fn), cx, cy + 40, alpha=0.85)
    # protein chain
    beads = []
    for k in range(12):
        add = 1.0 + 0.28 * k
        if t < add: break
        bx, by = 900 - 58 * k, 330 - 30 * math.sin(k * 0.8)
        col = mix(AMBER, (110, 122, 140), seg(t, 6.5, 7.5))
        beads.append((bx, by, add, col))
    for i, (bx, by, add, col) in enumerate(beads):
        if i > 0:
            px_, py_ = beads[i - 1][0], beads[i - 1][1]
            polyline(cv, [(px_, py_), (bx, by)], (190, 200, 215), 7, 200)
    for bx, by, add, col in beads:
        place(cv, dot(16, tuple(int(c) for c in col)), bx, by, scale=seg(t, add, add + 0.4, eback))
    # ribosome
    rb = ribo_big()
    place(cv, rb, cx, cy - 10)
    # antibiotic (tetracycline-type) docks at binding site
    dt = seg(t, 5.0, 6.4, eout)
    bx0, by0 = 1660, 240; bx1, by1 = 960, 470
    ax, ay = mix((bx0, by0), (bx1, by1), dt)
    ay -= 70 * math.sin(math.pi * dt)
    place(cv, tetra_spr(), ax, ay, rot=-20 * (1 - dt), alpha=seg(t, 4.9, 5.2))
    g = seg(t, 6.4, 6.9) * (1 - seg(t, 8.5, 9.4))
    if g > 0: place(cv, dot(80, CORAL, int(90 * g)), 960, 470)
    stop = seg(t, 6.9, 7.5, eback)
    if stop > 0:
        place(cv, icon('cross', 130), 1290, 380, scale=stop)
    label(cv, 'प्रोटीन का निर्माण रुक गया', 900, 230, t, 7.4, px=46, color=WHITE, bold=True)

def s6(cv, t):
    drift(cv, t, 6)
    title(cv, 'तरीका 3: DNA की नकल रोकना', t)
    x0, x1, yc, amp, per = 300, 1620, 560, 66, 300.0
    xs = kf(t, [(0, 300), (3.2, 300), (7.2, 1050)], eio)
    xs = xs if t < 7.2 else 1050
    def helixA(x): return yc + amp * math.sin(2 * math.pi * (x - x0) / per)
    def helixB(x): return yc - amp * math.sin(2 * math.pi * (x - x0) / per)
    def ya(x):
        if x <= xs: return helixA(x)
        w_ = clamp01((x - xs) / 140)
        return helixA(x) * (1 - w_) + (yc - 100) * w_
    def yb(x):
        if x <= xs: return helixB(x)
        w_ = clamp01((x - xs) / 140)
        return helixB(x) * (1 - w_) + (yc + 100) * w_
    sx, sy, sw, sh = 260, 330, 1400, 460
    def fn(d, ss):
        P1 = [((x - sx) * ss, (ya(x) - sy) * ss) for x in np.arange(x0 - 20, x1 + 1, 3)]
        P2 = [((x - sx) * ss, (yb(x) - sy) * ss) for x in np.arange(x0 - 20, x1 + 1, 3)]
        for x in np.arange(x0, min(xs, x1), 22):
            d.line([((x - sx) * ss, (ya(x) - sy) * ss), ((x - sx) * ss, (yb(x) - sy) * ss)], fill=(255, 226, 130, 150), width=3 * ss)
        d.line(P1, fill=SKY + (255,), width=9 * ss, joint='curve')
        d.line(P2, fill=VIOLET + (255,), width=9 * ss, joint='curve')
    place(cv, ss_sprite(sw, sh, fn), sx + sw / 2, sy + sh / 2)
    # gyrase enzyme sits on the split point
    ey = kf(t, [(0, 230), (2.0, 230), (3.4, 400)], eio)
    if t >= 2.0:
        en = sphere(54, (150, 118, 240), 0.5)
        place(cv, en, xs + 10, ey, scale=seg(t, 2.0, 2.8, eback))
        place(cv, dot(14, DARK, 230), xs + 10, ey)
    # fluoroquinolone-type drug docks onto the enzyme
    dt = seg(t, 5.4, 7.0, eout)
    qx0, qy0 = 1620, 850; qx1, qy1 = xs + 80, 400
    place(cv, quin_spr(), mix(qx0, qx1, dt), mix(qy0, qy1, dt), rot=-15 * (1 - dt), alpha=seg(t, 5.3, 5.6))
    st = seg(t, 7.3, 7.9, eback)
    if st > 0: place(cv, icon('cross', 120), xs + 10, ey - 110, scale=st)
    label(cv, 'DNA की नकल रुक गई', 960, 835, t, 7.6, px=46, color=WHITE, bold=True)

def s7(cv, t):
    drift(cv, t, 7)
    title(cv, 'हमारी कोशिकाएं क्यों सुरक्षित हैं?', t)
    bx, by = 520, 470
    place(cv, bact_big(), bx, by, scale=0.8)
    hx, hy = 1400, 470
    place(cv, human_cell(170), hx, hy, scale=seg(t, 0.5, 1.3, eback) or 0.001)
    # drug flies in along an arc and hits the bacterium
    u = seg(t, 1.4, 3.0, eio)
    dx = mix(960, bx + 60, u); dy = mix(190, by - 60, u) - 120 * math.sin(math.pi * u)
    place(cv, penicillin_spr(), dx, dy, scale=0.62, rot=-30 * (1 - u), alpha=seg(t, 1.3, 1.5))
    fl = seg(t, 3.0, 3.25) * (1 - seg(t, 3.25, 3.9))
    if fl > 0: place(cv, dot(190, (255, 255, 255), int(120 * fl)), bx, by)
    def badge(cx, cy, txt, ok, t0):
        p = seg(t, t0, t0 + 0.5, eback)
        if p <= 0: return
        tw = text_sprite(txt, 40, WHITE, True)
        ic = icon('check' if ok else 'cross', 64)
        total = tw.width + 80 + 40
        x_start = cx - total / 2
        place(cv, ic, x_start + 32, cy, scale=p, alpha=min(1, p))
        place(cv, tw, x_start + 80 + tw.width / 2, cy, alpha=min(1, p))
    badge(bx, 700, 'कोशिका भित्ति', True, 4.6)
    badge(hx, 700, 'कोशिका भित्ति', False, 5.1)
    badge(bx, 800, 'दवा का निशाना', True, 8.2)
    badge(hx, 800, 'दवा का निशाना', False, 8.7)

def s8(cv, t):
    drift(cv, t, 8)
    title(cv, 'दवा का सफ़र', t)
    P = [(330, 520), (560, 330), (900, 330), (1200, 420), (1480, 600)]
    # vessel
    samp = [bezier_path(P, k / 120) for k in range(121)]
    polyline(cv, samp, (40, 96, 150), 60, 150)
    polyline(cv, samp, (120, 200, 240), 14, 110)
    place(cv, ellipse(95, 95, (255, 140, 160), 0.85), 330, 520)
    label(cv, 'पेट', 330, 650, t, 0.3, px=40, color=MUTED)
    label(cv, 'खून का बहाव', 1000, 262, t, 0.8, px=40, color=MUTED)
    label(cv, 'संक्रमण वाली जगह', 1480, 735, t, 1.0, px=40, color=MUTED)
    # infection cluster
    dim = seg(t, 6.3, 7.6)
    for k, (ox, oy, ang) in enumerate([(-30, -20, 30), (25, -30, -40), (10, 25, 80), (-35, 30, 10), (45, 5, -10)]):
        sc = mix(1.0, 0.7, dim)
        col = mix(CORAL, (110, 110, 130), dim)
        place(cv, rod(tuple(int(c) for c in col)), 1480 + ox, 600 + oy, scale=sc, rot=ang, alpha=mix(1, 0.45, dim))
    # drug travels along the vessel
    u = seg(t, 1.0, 6.0, eio)
    for k in range(1, 12):
        uk = u - 0.012 * k
        if uk <= 0: break
        x, y = bezier_path(P, uk)
        place(cv, dot(7, AMBER, int(230 * (1 - k / 12))), x, y)
    px_, py_ = bezier_path(P, u)
    vis = 1 - seg(t, 6.0, 6.5)
    if vis > 0: place(cv, capsule_small(AMBER, 96, 42), px_, py_, rot=0, alpha=vis)
    # release molecules at site
    rel = seg(t, 6.0, 7.6, eout)
    if rel > 0:
        for k in range(14):
            a = k * 2 * math.pi / 14 + 0.3
            r_ = 40 + 110 * rel
            place(cv, dot(9, AMBER, int(230 * (1 - seg(t, 8.0, 9.2)))), 1480 + math.cos(a) * r_, 600 + math.sin(a) * r_ * 0.8)

def s9(cv, t):
    drift(cv, t, 9)
    title(cv, 'इम्यून सिस्टम की सफ़ाई', t)
    cx = mix(1900, 1180, seg(t, 0, 1.3, eout))
    cy = 560
    bulge = 1 + 0.035 * math.sin(t * 3.2)
    targets = [(440, 360, 1.9), (520, 640, 3.6), (690, 470, 5.3), (420, 540, 7.0), (660, 290, 8.5)]
    cleared = 0
    for i, (bx, by, et) in enumerate(targets):
        st = et - 1.4
        if t < st:
            place(cv, rod((150, 110, 125), 110, 46), bx, by, rot=10 * math.sin(t * 2 + i))
            continue
        mv = seg(t, st, et, eio)
        x, y = mix(bx, cx - 120, mv), mix(by, cy, mv)
        shrink = 1 - seg(t, et - 0.3, et + 0.35, ein)
        if t >= et + 0.35: cleared += 1
        if shrink > 0:
            place(cv, rod((150, 110, 125), 110, 46), x, y, scale=shrink, rot=20 * mv)
    # engulfing cell drawn on top of the bacteria
    place(cv, phagocyte(190), cx, cy, scale=bulge)
    place(cv, text_sprite('सफ़ेद रक्त कोशिका', 40, MUTED), cx, 840)
    label(cv, 'साफ़ किए गए:', 300, 230, t, 0.4, px=44, color=MUTED, align='left')
    place(cv, text_sprite(str(cleared), 100, GREEN, True), 300 + text_sprite('साफ़ किए गए:', 44, MUTED).width + 60, 230)

def s10(cv, t):
    drift(cv, t, 10)
    # Part A: advice cards
    cards = [('पूरा कोर्स ज़रूर करें', 'check', GREEN, 0.6),
             ('रेज़िस्टेंस से बचें', 'warn', AMBER, 3.8),
             ('वायरल संक्रमण पर असर नहीं', 'virus', CORAL, 7.0)]
    if t < 12.4:
        title(cv, 'ज़रूरी सलाह', t, y=120)
        for i, (txt, ic, col, t0) in enumerate(cards):
            p = seg(t, t0, t0 + 0.8, eout)
            if p <= 0: continue
            exit_ = seg(t, 11.6, 12.4, eio)
            x = mix(960 + 380, 960, p) - 700 * exit_
            y = 320 + i * 190
            a = p * (1 - exit_)
            place(cv, rrect(1300, 150, 22, PANEL, 0.95), x, y, alpha=a)
            place(cv, rrect(12, 150, 6, col), x - 644, y, alpha=a)
            place(cv, icon(ic, 96), x - 520, y, alpha=a)
            tsp = text_sprite(txt, 56, WHITE, True)
            place(cv, tsp, x - 380 + tsp.width / 2, y + 4, alpha=a)
    # Part B: summary tiles
    if t >= 12.4 and t < 21.6:
        title(cv, 'संक्षेप में', t, y=120)
        tiles = [(520, 'wall', 'कोशिका भित्ति पर वार', 13.5), (960, 'beads', 'प्रोटीन बनना बंद', 15.3), (1400, 'helix', 'DNA की नकल बंद', 17.1)]
        fade = 1 - seg(t, 20.5, 21.4)
        for x, ic, lab, t0 in tiles:
            p = seg(t, t0, t0 + 0.7, eback)
            if p <= 0: continue
            place(cv, rrect(360, 320, 26, PANEL, 0.95), x, 470, scale=p, alpha=fade)
            place(cv, icon(ic, 140), x, 415, scale=p, alpha=fade)
            place(cv, text_sprite(lab, 36, WHITE, True), x, 580, alpha=fade * p)
    if t >= 21.0:
        q = seg(t, 21.0, 21.8, eout)
        place(cv, text_sprite('धन्यवाद', 110, WHITE, True), 960, 440, alpha=q)
        place(cv, text_sprite('सेहतमंद रहें', 50, TEAL, True), 960, 560, alpha=q)
    # global fade to black at the end
    fo = seg(t, 24.4, 25.3)
    if fo > 0:
        cv.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, int(255 * fo))))

# ---------------------------------------------------------------- timeline
SCRIPT = [
 ('s1', s1, 'narr_01.wav', 'fade', 'नमस्ते दोस्तों। आज हम समझेंगे कि एंटीबायोटिक दवा आपके शरीर के अंदर बैक्टीरिया से कैसे लड़ती है।'),
 ('s2', s2, 'narr_02.wav', 'wipe', 'जब हानिकारक बैक्टीरिया शरीर में घुस जाते हैं, तो वे तेज़ी से बढ़ने लगते हैं, और संक्रमण यानी इन्फ़ेक्शन पैदा करते हैं।'),
 ('s3', s3, 'narr_03.wav', 'fade', 'बैक्टीरिया एक कोशिका वाला सूक्ष्म जीव है। इसकी एक मज़बूत कोशिका भित्ति होती है, एक झिल्ली होती है, DNA होता है, और राइबोसोम होते हैं, जो प्रोटीन बनाने की फ़ैक्ट्री हैं।'),
 ('s4', s4, 'narr_04.wav', 'wipe', 'एंटीबायोटिक्स के तीन मुख्य तरीके हैं। पहला तरीका: पेनिसिलिन जैसी दवाएं कोशिका भित्ति बनने से रोकती हैं। बिना मज़बूत दीवार के बैक्टीरिया फूलकर फट जाता है।'),
 ('s5', s5, 'narr_05.wav', 'fade', 'दूसरा तरीका: टेट्रासाइक्लिन जैसी दवाएं राइबोसोम से जुड़ जाती हैं। इससे बैक्टीरिया ज़रूरी प्रोटीन नहीं बना पाता, और उसकी ग्रोथ रुक जाती है।'),
 ('s6', s6, 'narr_06.wav', 'wipe', 'तीसरा तरीका: फ़्लुओरोक्विनोलोन जैसी दवाएं DNA की नकल बनाने वाले एंज़ाइम को रोकती हैं। इससे बैक्टीरिया अपनी संख्या नहीं बढ़ा पाता।'),
 ('s7', s7, 'narr_07.wav', 'fade', 'तो हमारी कोशिकाओं को नुकसान क्यों नहीं होता? क्योंकि हमारी कोशिकाओं में कोशिका भित्ति नहीं होती, और हमारे राइबोसोम बैक्टीरिया से अलग होते हैं। इसलिए एंटीबायोटिक मुख्य रूप से बैक्टीरिया को ही निशाना बनाती है।'),
 ('s8', s8, 'narr_08.wav', 'wipe', 'दवा खाने के बाद वह पेट से खून में पहुंचती है, खून के साथ पूरे शरीर में घूमती है, और संक्रमण वाली जगह पर पहुंचकर असर दिखाती है।'),
 ('s9', s9, 'narr_09.wav', 'fade', 'एंटीबायोटिक बैक्टीरिया को कमज़ोर कर देती है, और आपका इम्यून सिस्टम, यानी सफ़ेद रक्त कोशिकाएं, मरे और कमज़ोर बैक्टीरिया को साफ़ कर देती हैं।'),
 ('s10', s10, 'narr_10.wav', 'wipe', 'ध्यान रखें: डॉक्टर का बताया पूरा कोर्स ज़रूर पूरा करें। बीच में दवा छोड़ने से सबसे मज़बूत बैक्टीरिया बच सकते हैं, जिससे एंटीबायोटिक रेज़िस्टेंस बढ़ता है। सर्दी-जुकाम जैसे वायरल संक्रमण पर एंटीबायोटिक काम नहीं करती। संक्षेप में: एंटीबायोटिक बैक्टीरिया की दीवार, प्रोटीन या DNA पर वार करती है। धन्यवाद, और सेहतमंद रहें।'),
]
SC = []
BACT_TREE = []

def wav_len(path):
    with wave.open(path) as w: return w.getnframes() / w.getframerate()

def build_timeline():
    global BACT_TREE
    rnd = random.Random(7)
    P0 = [(700, 430), (1190, 470), (930, 660)]; B0 = [0.6, 0.9, 1.2]
    nodes = []
    for p, b in zip(P0, B0):
        a0 = math.atan2(p[1] - 520, p[0] - 960)
        nodes.append(dict(src=(960 + math.cos(a0) * 900, 520 + math.sin(a0) * 900), pos=p, born=b, ang=rnd.uniform(0, 180)))
    alive = list(nodes)
    for d_ in [3.2, 5.0, 6.8]:
        new = []
        for n_ in alive:
            a = rnd.uniform(0, 2 * math.pi); dist = rnd.uniform(60, 95)
            new.append(dict(src=n_['pos'], pos=(n_['pos'][0] + math.cos(a) * dist, n_['pos'][1] + math.sin(a) * dist),
                            born=d_, ang=rnd.uniform(0, 180)))
        nodes += new; alive = alive + new
    BACT_TREE = nodes
    start = 0.0
    for key, fn, wav, trans, text in SCRIPT:
        L = wav_len(os.path.join(WORK, wav))
        dur = L + 1.8
        # captions: sentences timed proportionally to character counts
        sents = [s_ for s_ in re.split(r'(?<=[।?!:])\s+', text) if s_.strip()]
        tot = sum(len(s_) for s_ in sents); caps = []; acc = 0.0
        for s_ in sents:
            a = 0.5 + L * acc / tot; acc += len(s_); b = 0.5 + L * acc / tot
            caps.append((a, b, build_caption(s_)))
        SC.append(dict(key=key, fn=fn, start=start, dur=dur, trans=trans, caps=caps, L=L, wav=wav))
        start += dur - TR
    return start + TR

def scene_canvas(sc, t):
    cv = background()
    sc['fn'](cv, t)
    caption(cv, sc['caps'], t)
    return cv

def frame_canvas(T):
    active = [i for i, s_ in enumerate(SC) if s_['start'] <= T < s_['start'] + s_['dur']]
    if not active:
        active = [len(SC) - 1]
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
    # soft wipe from left to right
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
    if T < 0.6:
        arr *= eio(T / 0.6)
    return np.clip(arr, 0, 255).astype(np.uint8).tobytes()

def write_wav(path, samples, rate):
    data = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(data.tobytes())

def build_audio(total, rate=24000):
    n = int(total * rate) + 1
    left = np.zeros(n, np.float32)
    # ambient pad (A minor colour) with slow swell
    t = np.arange(n, dtype=np.float32) / rate
    pad = np.zeros(n, np.float32)
    for f, a in [(110.0, 0.5), (164.81, 0.35), (220.0, 0.4), (261.63, 0.18)]:
        pad += a * np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.07 * t))
    env = 0.55 + 0.45 * np.sin(2 * np.pi * 0.05 * t)
    fade = np.clip(np.minimum(t / 2.0, (total - t) / 3.0), 0, 1)
    left += 0.018 * pad * env * fade
    # transition whooshes (filtered noise sweep)
    rng = np.random.default_rng(3)
    for s_ in SC[1:]:
        t0 = s_['start']; L = int(TR * rate * 1.1); i0 = int(t0 * rate)
        noise = rng.standard_normal(L).astype(np.float32)
        y = np.zeros(L, np.float32); acc = 0.0
        for k in range(L):
            fc = 0.02 + 0.22 * (k / L) ** 1.5
            acc += fc * (noise[k] - acc)
            y[k] = acc
        y *= np.sin(np.pi * np.arange(L) / L) ** 2 * 0.9
        m = max(0, min(L, n - i0))
        left[i0:i0 + m] += y[:m] * 0.22
    # narration
    for s_ in SC:
        w = wave.open(os.path.join(WORK, s_['wav']))
        raw = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32767
        w.close()
        raw = raw / max(1e-6, np.max(np.abs(raw))) * 0.9
        i0 = int((s_['start'] + 0.5) * rate)
        end = min(n, i0 + len(raw))
        left[i0:end] += raw[: end - i0]
    left = np.clip(left, -0.98, 0.98)
    stereo = np.stack([left, left], -1)
    return stereo

def frame_bytes_idx(i):
    return frame_bytes(i / FPS)

def main():
    total = build_timeline()
    nframes = int(round(total * FPS))
    audio_path = os.path.join(WORK, 'mix.wav')
    write_wav(audio_path, build_audio(total), 24000)
    print('timeline total', round(total, 2), 's, frames', nframes, flush=True)
    for s_ in SC: print(s_['key'], round(s_['start'], 2), round(s_['dur'], 2), s_['trans'], flush=True)
    if len(sys.argv) > 1 and sys.argv[1] == 'preview':
        for T in [float(x) for x in sys.argv[2:]]:
            arr = np.frombuffer(frame_bytes(T), np.uint8).reshape(H, W, 3)
            Image.fromarray(arr).save(os.path.join(WORK, 'preview_%05.2f.png' % T))
            print('saved preview', T, flush=True)
        return
    out = os.path.join(BASE, 'antibiotics_hindi_explainer.mp4')
    cmd = [FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', audio_path, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-t', f'{total:.3f}', out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    from multiprocessing import Pool
    with Pool(2) as pool:
        for i, buf in enumerate(pool.imap(frame_bytes_idx, range(nframes), chunksize=12)):
            proc.stdin.write(buf)
            if i % 300 == 0: print('frame', i, '/', nframes, flush=True)
    proc.stdin.close(); proc.wait()
    print('done ->', out, flush=True)

if __name__ == '__main__':
    main()
