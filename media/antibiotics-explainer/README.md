# Antibiotics explainer (Hindi, 2D motion graphics)

- `antibiotics_hindi_explainer.mp4` — 1920x1080, 30 fps, ~2m07s, Hindi narration, captions, ambient score.
- `make_video.py` — renderer (Pillow + numpy + HarfBuzz/FreeType for Devanagari). Expects narration WAVs
  (`narr_01.wav` … `narr_10.wav`) and Noto Sans Devanagari TTFs in the paths set at the top of the script.

Scenes: infection, bacterial anatomy, three mechanisms (cell wall, ribosome, DNA gyrase),
selective toxicity, drug journey, immune clearance, and course-completion advice + summary.
