#!/data/data/com.termux/files/usr/bin/sh
# Build from a Termux checkout. No Android Studio or IDE-generated files are required.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

command -v java >/dev/null 2>&1 || { echo 'Java is missing. Run: pkg install openjdk-17' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'Git is missing. Run: pkg install git' >&2; exit 1; }
JAVA_MAJOR=$(java -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1)
[ "${JAVA_MAJOR:-0}" -ge 17 ] || { echo 'JDK 17 or newer is required.' >&2; exit 1; }

SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
[ -n "$SDK" ] || { echo 'Set ANDROID_HOME to your Android SDK first.' >&2; exit 1; }
[ -f "$SDK/platforms/android-36/android.jar" ] || {
    echo 'API 36 is missing. Run: sdkmanager "platforms;android-36"' >&2
    exit 1
}
[ -x ./gradlew ] || chmod +x ./gradlew

AAPT2=$(find "$SDK/build-tools" -mindepth 2 -maxdepth 2 -type f -name aapt2 2>/dev/null | sort -V | tail -n 1 || true)
if [ -n "$AAPT2" ] && [ -x "$AAPT2" ]; then
    # AGP otherwise downloads an x86-64 AAPT2, which cannot execute on ARM64 Termux.
    set -- -Pandroid.aapt2FromMavenOverride="$AAPT2" "$@"
fi

./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest "$@"

APK=app/build/outputs/apk/debug/app-debug.apk
[ -f "$APK" ] || { echo 'Gradle completed without the expected debug APK.' >&2; exit 1; }
mkdir -p artifacts
DEST=artifacts/night-vision-x-pro-camera-diagnostics-debug.apk
if [ -f "$DEST" ] && ! cmp -s "$APK" "$DEST"; then
    DEST="artifacts/night-vision-x-pro-camera-diagnostics-$(date +%Y%m%d-%H%M%S)-debug.apk"
fi
cp "$APK" "$DEST"
printf '\nDebug APK: %s\nUnit-test reports: app/build/reports/tests/testDebugUnitTest/\n' "$DEST"
