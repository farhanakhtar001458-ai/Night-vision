#!/usr/bin/env python3
"""Hindi narration ko 60s timeline par fit karta hai: trim -> tempo -> mix (music ducking ke saath)."""
import json, os, subprocess, wave
import numpy as np
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 44100
DUR = 60.0
HERE = os.path.dirname(os.path.abspath(__file__))

CLIPS = ["01.mp3", "02b.mp3", "03.mp3", "04.mp3", "05.mp3", "06b.mp3", "07.mp3", "08.mp3"]
START_PAD = 0.35
GAP = 0.18
END_LIMIT = 59.60


def wav_from(src, dst, af=None):
    cmd = [FF, "-y", "-loglevel", "error", "-i", src]
    if af:
        cmd += ["-af", af]
    cmd += ["-ac", "1", "-ar", str(SR), "-acodec", "pcm_s16le", dst]
    subprocess.run(cmd, check=True)


def read_wav(path):
    with wave.open(path, "rb") as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        raw = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        raw = raw.reshape(-1, ch).mean(axis=1)
    return raw, sr


def duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()


TRIM = ("silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,"
        "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse")

trims = []
for i, name in enumerate(CLIPS):
    out = os.path.join(HERE, "vo", "trim_%d.wav" % (i + 1))
    wav_from(os.path.join(HERE, "vo", name), out, TRIM)
    trims.append(out)
    print("clip %d: %.2fs" % (i + 1, duration(out)))

durs = [duration(p) for p in trims]
total = sum(durs)
budget = END_LIMIT - START_PAD - GAP * (len(CLIPS) - 1)
tempo = max(1.0, total / budget)
print("total speech %.2fs, budget %.2fs -> tempo %.3f" % (total, budget, tempo))

starts = []
t = START_PAD
for d in durs:
    starts.append(t)
    t += d / tempo + GAP

n = int(DUR * SR)
voice = np.zeros(n, np.float32)
for i, (path, st) in enumerate(zip(trims, starts)):
    fast = os.path.join(HERE, "vo", "fast_%d.wav" % (i + 1))
    wav_from(path, fast, "highpass=f=85,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=160,atempo=%.4f" % tempo)
    data, _ = read_wav(fast)
    i0 = int(st * SR)
    ln = min(len(data), n - i0)
    voice[i0:i0 + ln] += data[:ln]
    print("  clip %d -> %5.2fs (len %.2fs)" % (i + 1, st, ln / SR))

# music
music, msr = read_wav(os.path.join(HERE, "music.wav"))
if msr != SR:
    raise SystemExit("music sr mismatch")
if len(music) < n:
    music = np.pad(music, (0, n - len(music)))
music = music[:n]

# ducking envelope
win = int(0.05 * SR)
env = np.zeros(n, np.float32)
step = win
for i in range(0, n, step):
    seg = voice[i:i + step]
    env[i:i + step] = float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0
k = 5
env = np.convolve(env, np.ones(k) / k, mode="same")
env_norm = np.clip(env / 0.06, 0, 1)
duck = 1.0 - 0.55 * env_norm

mix = voice * 1.55 + music * 0.235 * duck
mix = np.tanh(mix * 1.05)
peak = float(np.max(np.abs(mix))) or 1.0
mix = mix / peak * 0.92

stereo = np.stack([mix, mix * 0.985], axis=1)
pcm = (stereo * 32767).astype(np.int16)
with wave.open(os.path.join(HERE, "mix.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

bounds = [round(s - 0.28, 3) for s in starts]
bounds[0] = 0.0
bounds.append(DUR)
with open(os.path.join(HERE, "schedule.json"), "w") as fh:
    json.dump({"bounds": bounds, "starts": [round(s, 3) for s in starts],
               "tempo": round(tempo, 3)}, fh, indent=1)
print("bounds:", bounds)
print("mix.wav ready")
