# J-TET 60-second explainer video (Hindi voice)

Full 2D motion-graphics explainer on **Jharkhand TET (J-TET)** — pattern, eligibility, qualifying marks and a 5-step preparation plan.

## Download

| File | What |
|---|---|
| **`jtet-60s-hindi.mp4`** | Final video — **Hindi voiceover** + music, 1080×1920, 30 fps, 60.0 s |
| `jtet-60s.mp4` | Same video, music bed only (no voice) |
| `storyboard.png` | 8-frame contact sheet |
| `thumbnail.jpg` | 1080×1920 poster / thumbnail |

GitHub par file kholo → **Download** button (ya "View raw") se download karo.

## How it is built

```bash
python music.py                       # music.wav  (numpy synth: pad + kick + hats)
python build_audio.py                 # trims Hindi clips, fits them in 60 s, mixes + ducks music
OUT_NAME=jtet-60s-hindi.mp4 python render.py   # renders 1800 frames with PIL, encodes with ffmpeg
```

- `render.py` — background, particles, 8 scenes (intro, what-is, Paper 1, Paper 2, eligibility,
  qualifying donut, 5-step plan, outro), HUD (progress bar, scene dots, counter). Reads
  `schedule.json` so scene boundaries land exactly on the narration.
- `build_audio.py` — silence-trim → `atempo` fit → voice + ducked music → `mix.wav`.
- `vo/*.mp3` — narration lines (Hindi, Devanagari text).
- `storyboard.md` — scene table, Hindi script, fact sheet.

## Facts used (JAC)

150 Q / 150 marks / 2:30 hrs · MCQ, no negative marking · Paper 1 = Class 1–5 (CDP 30, Lang 1 30,
Lang 2 30, Maths 30, EVS 30) · Paper 2 = Class 6–8 (CDP 30, Lang 1 30, Lang 2 30, Maths & Science
60 **or** Social Science 60) · Qualifying: Gen 60% (90/150), BC/EBC/EWS 55%, SC/ST/PwD 50% ·
certificate lifetime · JAC, Ranchi.
