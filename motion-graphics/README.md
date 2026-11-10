# 30 दिन: विज्ञान से समझें — motion graphics draft

An editable, 180-second Remotion composition, based on the workflow and countdown/typography motion principles of [Video Shotcraft](https://github.com/Vincentwei1021/video-shotcraft) (Apache-2.0). This is an original adaptation, not a copy of the template. Open the live Remotion Studio preview and select **Science30**. The composition is configured at 3840 × 2160, 60 fps, exactly 10,800 frames.

The six scenes use the selected Hindi narration, an original synthesized ambient music bed, Hindi caption text, and stylized scientific motion graphics. The human figure and cell illustrations are **2D/vector representations with perspective**, not detailed 3D anatomical models. Captions use estimated timing, not word-level alignment, and should be checked by listening before publication. The voice was generated with the Arena voice selected during audition, **not** Voicebox. It is not an imitation of an identifiable character. A clinical review is recommended before publishing.

## Local preview and export

Requires Node.js and a Remotion-compatible browser with its Linux system libraries installed. From this directory:

```sh
npm ci
npm run dev
npm run render
```

`npm run render` writes `out/science-30.mp4`. Rendering 4K/60 for three minutes is resource-intensive. For a smaller review render:

```sh
npx remotion render src/index.ts Science30 out/review.mp4 --scale=0.5
```

The Remotion composition compiled and passed TypeScript checking in the current environment. A 1280 × 720, 15 fps draft has been rendered as `science-final.mp4`. It is exactly 180 seconds long and includes the narration and music. The full 4K/60 version has not been rendered or quality-checked. The rendering environment required building NSPR/NSS from source; on a supported local Linux system install the corresponding NSPR/NSS system packages.

Hindi font: Noto Sans Devanagari, SIL Open Font License; see `public/FONT-LICENSE.txt`.
