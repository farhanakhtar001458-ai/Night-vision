# Night Vision X PRO — Camera Diagnostic Module

**Package:** `com.nightvision.x`

**Target:** Infinix GT 30 Pro / X6873 · Android 16 · API 36 · ARM64

**Build:** Kotlin · Camera2 · Gradle · Android SDK · no Android Studio required

This repository currently contains **only milestone 1: read-only camera diagnostics**. It does not
contain a preview, Night Vision processing, OpenCV, sensor fusion, photo capture, or video recording.
Those features intentionally wait for a real X6873 report and explicit approval.

## Hardware-result status

> **Not yet measured on an Infinix GT 30 Pro.** No camera specifications are hardcoded in the app or
> documentation. The actual ISO range, exposure range, sensor sizes, FPS ranges, and physical IDs
> exist only after running the APK on the phone and exporting its report.

The generated dashboard reads `CameraManager` / `CameraCharacteristics` at runtime. A missing value
is displayed and exported as **Not reported** / JSON `null`; an unreadable camera includes its actual
exception instead of fallback specifications.

## Deliverables in this milestone

- Military-black/green camera inventory with logical and physical-only camera entries.
- Separate detail dashboard for every readable camera ID.
- Actual pixel/pre-correction active-array dimensions and sensor metadata.
- Minimum/maximum ISO and exposure, retained as integer values and exposure nanoseconds in JSON.
- Manual-sensor, RAW, AF/manual-focus, focus-distance, OIS, and video-stabilization capabilities.
- Target FPS ranges, every reported output format, output resolutions, and minimum frame durations.
- Hardware level, capabilities, focal lengths, apertures, and physical-camera ownership.
- Explicitly estimated optical roles when focal length and sensor size permit a calculation.
- Human-readable TXT and stable JSON reports, export through Android's document picker, and sharing.
- Capability-derived recommendations for a future Night Vision engine.
- JVM tests and repeatable Termux/Gradle scripts.

## Privacy and permissions

The diagnostic module declares **no `CAMERA`, microphone, media, or storage runtime permission**.
`getCameraCharacteristics()` does not require opening a `CameraDevice`. The app never starts a preview,
creates an `ImageReader`, records audio, or captures frames. Android's camera-in-use indicator should
not turn on. Export uses `ACTION_CREATE_DOCUMENT`; sharing uses a read-only provider limited to the
app's generated report cache.

## Debug APK

After a Gradle build, the APK is at:

```
app/build/outputs/apk/debug/app-debug.apk
```

A verified build is also copied to:

```
artifacts/night-vision-x-pro-camera-diagnostics-debug.apk
```

The debug application ID is `com.nightvision.x.debug`, so it can coexist with a future release build.
Install on the phone with a file manager, or with USB/wireless debugging enabled:

```sh
adb install -r artifacts/night-vision-x-pro-camera-diagnostics-debug.apk
```

Open **Night Vision X PRO**. The first hardware scan starts automatically. Tap every camera entry to
inspect all values, then tap **EXPORT JSON** and **EXPORT TXT**. Share both reports for review before
any Night Vision implementation begins.

## Termux setup and build

### 1. Clone and inspect — do not overwrite an existing checkout

```sh
cd ~
git clone https://github.com/farhanakhtar001458-ai/Night-vision.git
cd Night-vision
git checkout arena/0fe2a630-night-vision
sh scripts/check-termux.sh
```

If `~/Night-vision` already exists, do **not** clone over it. Inspect it first and preserve local work.
The check script is read-only and reports Java, Git, Gradle, SDK platforms, build tools, and ADB devices.

### 2. Install compatible tools

JDK 17+, Git, and an SDK with `platforms;android-36` are required. A global Gradle installation is
optional because the project includes the Gradle 8.13 wrapper.

```sh
pkg update
pkg install openjdk-17 git unzip wget
# Optional, for adb installation over USB/wireless debugging:
pkg install android-tools
```

Use an existing SDK by exporting its real path, for example:

```sh
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

If `sdkmanager` is already installed, install the required components with:

```sh
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

If no SDK/`sdkmanager` exists, install the official Android **command-line tools** (not Android Studio)
from the Android developer site, unpack them as `$ANDROID_HOME/cmdline-tools/latest`, and then run the
commands above. Verify the resulting path with `sh scripts/check-termux.sh`; do not assume the example
path matches your Termux installation.

### 3. Compile and test

```sh
sh scripts/build-termux.sh
```

The script checks Java and API 36, runs `assembleDebug` plus JVM tests, and copies the APK into
`artifacts/`. On ARM64 it locates the SDK's native `aapt2` and passes AGP's
`android.aapt2FromMavenOverride` property, avoiding an incompatible downloaded x86-64 binary.
Existing differently built artifacts are not silently replaced: a timestamped filename is used.

Equivalent manual command (without the ARM64 AAPT2 override):

```sh
./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

## Release APK

1. Generate a private signing key in the project root. Back it up securely; losing it prevents normal
   updates to the same application ID.

   ```sh
   keytool -genkeypair -v -keystore release-keystore.jks \
     -alias nightvision -keyalg RSA -keysize 3072 -validity 10000
   ```

2. Copy `keystore.properties.example` to `keystore.properties`, set the actual passwords, and keep both
   files private. Both are Git-ignored.
3. Build release:

   ```sh
   ./gradlew --no-daemon :app:assembleRelease
   ```

   On ARM64 Termux, pass the same AAPT2 override used by `scripts/build-termux.sh`.
4. Signed output: `app/build/outputs/apk/release/app-release.apk`. If `keystore.properties` is absent,
   Gradle produces `app-release-unsigned.apk`; it is not ready for installation/distribution until signed.
5. Verify a signed APK with the SDK build-tools:

   ```sh
   apksigner verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk
   ```

Release mode uses the final `com.nightvision.x` application ID. Do not publish the debug certificate.

## Report and architecture documentation

- [`docs/CAMERA_DIAGNOSTICS.md`](docs/CAMERA_DIAGNOSTICS.md) — data mapping, report semantics, role
  estimation, limitations, and recommendation logic.
- [`TESTING.md`](TESTING.md) — build checks and the X6873 acceptance procedure.
- [`reports/README.md`](reports/README.md) — how to supply the required real hardware report.

## Stop point / approval gate

After installing the APK, provide the actual JSON and TXT reports and confirm whether every expected
rear/front/ultra-wide/physical camera was enumerated. **Night Vision X PRO development must not start
until those results are reviewed and you approve the next phase.**
