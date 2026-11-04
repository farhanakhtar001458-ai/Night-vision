# Camera diagnostic verification

## Automated checks

The project includes JVM tests for optical-role estimation, missing-optics behavior, logical
multi-camera labeling, missing-value formatting, and 64-bit exposure formatting.

```sh
./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The Kotlin sources have additionally been compiled directly against the Android API 36 platform and
the manifest/resources have been linked with AAPT2 during development. These checks do not emulate a
camera and are not a substitute for the hardware test below.

## Required Infinix GT 30 Pro acceptance test

**Device prerequisite:** Infinix GT 30 Pro, model X6873, Android 16 / API 36. Do not use an emulator's
fake camera values as the final report.

1. **Install and launch**
   - Install `artifacts/night-vision-x-pro-camera-diagnostics-debug.apk`.
   - Confirm the dashboard detects manufacturer/model `Infinix` / `X6873` (preserve any vendor casing).
   - Confirm Android 16 and API 36. If the model/API differs, report that instead of editing results.

2. **TEST 1 — camera detection**
   - Let the automatic scan finish without backgrounding the app.
   - Record logical and physical-only counts.
   - Verify no camera entry is unexpectedly unreadable. If one is, retain its exact error in the report.
   - Open every logical and physical entry and verify its parent ID and facing.

3. **Capabilities audit**
   - Record each camera's pixel array and pre-correction active array.
   - Record minimum/maximum ISO and exposure in raw units.
   - Check MANUAL_SENSOR, RAW, AF modes, minimum focus distance, FPS ranges, OIS/EIS, hardware level,
     output formats, sizes, and physical IDs.
   - Treat `Not reported` as a result to investigate, not a value to fill manually.
   - Check that estimated main/ultra-wide roles are marked estimated and include their basis.

4. **Export verification**
   - Tap **EXPORT JSON**, choose a document location, and save.
   - Tap **EXPORT TXT** and save beside it.
   - Confirm both open, contain the same scan timestamp/counts, and include full resolution lists.
   - If `jq` is installed, validate JSON syntax: `jq empty <report>.json`.
   - Tap **SHARE JSON + TXT** and verify a receiving app can read both attachments.

5. **Privacy check**
   - Android should not show a camera permission prompt because this module does not open the camera.
   - The camera privacy indicator should not activate due to this app.
   - App permissions should show no microphone/media access granted by this diagnostic flow.

6. **Lifecycle check**
   - Background and reopen the app, rotate it, and rescan.
   - Confirm there is no camera-resource leak (the app owns no camera resource) and no scan freezes.
   - After process death, run a fresh scan; old results are intentionally not presented as new hardware
     data from an in-memory detail deep link.

7. **Submit results and stop**
   - Supply the actual JSON and TXT reports plus any unreadable-camera warnings.
   - State whether the expected main, ultra-wide, front, and other physical cameras were enumerated.
   - Wait for review and explicit approval before starting Night Vision processing.

## Explicitly deferred tests

Live preview, green processing, ambient-light adaptation, gyroscope/accelerometer integration, manual
ISO/exposure behavior, photo/video recording, sustained performance/thermal behavior, and full Android
16 camera-stream compatibility cannot be validated by this static diagnostic milestone. They remain
deferred and must not be marked tested yet.
