#!/usr/bin/env python3
"""60s background bed: pad + soft kick + hats + risers. Pure numpy."""
import numpy as np, wave, struct

SR = 44100
DUR = 60.0
N = int(SR * DUR)
t = np.arange(N) / SR
out = np.zeros((N, 2), np.float32)

def add(sig, at, gain=1.0):
    i = int(at * SR)
    n = min(len(sig), N - i)
    if n <= 0: return
    out[i:i + n] += (sig[:n] * gain)[:, None] * np.array([1.0, 0.98], np.float32)

def env(n, a, d, s, r, sr=SR):
    e = np.zeros(n, np.float32)
    na, nd, nr = int(a * sr), int(d * sr), int(r * sr)
    ns = max(0, n - na - nd - nr)
    idx = 0
    if na: e[idx:idx + na] = np.linspace(0, 1, na); idx += na
    if nd: e[idx:idx + nd] = np.linspace(1, s, nd); idx += nd
    if ns: e[idx:idx + ns] = s; idx += ns
    if nr: e[idx:idx + nr] = np.linspace(s, 0, nr)
    return e

def sine(f, n, ph=0.0):
    return np.sin(2 * np.pi * f * np.arange(n) / SR + ph).astype(np.float32)

NOTE = {"A2": 110.0, "C3": 130.81, "E3": 164.81, "G3": 196.0, "F2": 87.31, "A3": 220.0,
        "B3": 246.94, "D3": 146.83, "G2": 98.0, "E2": 82.41, "C4": 261.63, "B2": 123.47}

CHORDS = [
    ["A2", "C3", "E3", "G3"],     # Am7
    ["F2", "A3", "C3", "E3"],     # Fmaj7
    ["C3", "E3", "G3", "B3"],     # Cmaj7
    ["G2", "B2", "D3", "G3"],     # G
]

bar = 2.0
for k in range(int(DUR / bar)):
    chord = CHORDS[k % 4]
    start = k * bar
    n = int(bar * SR)
    e = env(n, 0.25, 0.35, 0.85, 0.45)
    pad = np.zeros(n, np.float32)
    for j, nm in enumerate(chord):
        f = NOTE[nm]
        vib = 1 + 0.0018 * np.sin(2 * np.pi * (0.22 + 0.07 * j) * np.arange(n) / SR)
        pad += sine(f, n) * (0.55 if j == 0 else 0.32)
        pad += sine(f * 2.0 * vib, n) * 0.09
        pad += sine(f * 1.003, n) * 0.22
    pad *= e / len(chord)
    add(pad, start, 0.30)

    # bass pulse (2 per bar)
    for b in range(2):
        nb = int(0.55 * SR)
        be = env(nb, 0.008, 0.20, 0.0, 0.25)
        add(sine(NOTE[chord[0]] / 2, nb) * be, start + b * 1.0, 0.22)

# kick + hat
beat = 0.6
i = 0
while i * beat < DUR - 0.4:
    at = i * beat
    nk = int(0.30 * SR)
    kt = np.arange(nk) / SR
    freq = 118 * np.exp(-kt * 22) + 42
    kick = np.sin(2 * np.pi * np.cumsum(freq) / SR).astype(np.float32) * np.exp(-kt * 11)
    add(kick, at, 0.20)
    i += 1

j = 0
while j * 0.3 < DUR - 0.3:
    nh = int(0.045 * SR)
    rng = np.random.default_rng(1000 + j)
    hat = rng.standard_normal(nh).astype(np.float32) * np.exp(-np.arange(nh) / (0.010 * SR))
    add(hat, j * 0.3, 0.030)
    j += 1

# risers before scene changes
for at in (4.4, 11.4, 21.4, 32.4, 39.4, 46.4, 55.4):
    nr = int(1.2 * SR)
    rng = np.random.default_rng(int(at * 10))
    noise = rng.standard_normal(nr).astype(np.float32)
    # simple rising filter: mix of smoothed noise
    k = np.linspace(0.02, 0.35, nr).astype(np.float32)
    src = noise
    lp = np.zeros(nr, np.float32)
    acc = 0.0
    step = 64
    for s0 in range(0, nr, step):
        kk = float(k[s0])
        seg = src[s0:s0 + step]
        acc = acc + kk * (seg - acc) if False else acc
        lp[s0:s0 + step] = lp[max(0, s0 - 1)] + kk * (seg - lp[max(0, s0 - 1)]) if s0 else seg * kk
    shape = np.linspace(0, 1, nr) ** 2
    add(lp * shape, at, 0.05)

# master
fade_in = int(0.4 * SR)
fade_out = int(2.0 * SR)
out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
out = np.tanh(out * 1.1) * 0.82
peak = float(np.max(np.abs(out))) or 1.0
out = out / peak * 0.89

pcm = (out * 32767).astype(np.int16)
with wave.open("music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("music.wav", round(len(pcm.tobytes()) / 1024 / 1024, 2), "MB", "peak", round(peak, 3))
