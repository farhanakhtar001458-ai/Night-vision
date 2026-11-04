#!/data/data/com.termux/files/usr/bin/sh
# Read-only environment inspection. This script never installs or overwrites anything.
set -u

printf '%s\n' 'NIGHT VISION X PRO — Termux build environment'
printf '%s\n' '---------------------------------------------'
printf 'Architecture: '; uname -m
printf 'Repository:   '; git rev-parse --show-toplevel 2>/dev/null || printf '%s\n' 'Not inside a Git checkout'

printf '\n%s\n' 'Java:'
if command -v java >/dev/null 2>&1; then java -version 2>&1; else printf '%s\n' 'MISSING — install openjdk-17'; fi
printf '\n%s\n' 'Git:'
if command -v git >/dev/null 2>&1; then git --version; else printf '%s\n' 'MISSING — install git'; fi
printf '\n%s\n' 'Gradle (optional when using ./gradlew):'
if command -v gradle >/dev/null 2>&1; then gradle --version; else printf '%s\n' 'Not installed globally; the Gradle wrapper can be used.'; fi

SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
printf '\nANDROID_HOME / ANDROID_SDK_ROOT: %s\n' "${SDK:-NOT SET}"
if [ -n "$SDK" ] && [ -d "$SDK" ]; then
    printf '%s\n' 'Installed platform directories:'
    find "$SDK/platforms" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort || true
    printf '%s\n' 'Installed build-tools directories:'
    find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort || true
    [ -f "$SDK/platforms/android-36/android.jar" ] || printf '%s\n' 'MISSING: platforms;android-36'
else
    printf '%s\n' 'SDK not found. Set ANDROID_HOME to an existing Android SDK.'
fi

printf '\nADB / connected devices (optional for installation):\n'
if command -v adb >/dev/null 2>&1; then adb devices -l; else printf '%s\n' 'adb is not installed. The APK can still be built and transferred manually.'; fi

printf '\nNo files were changed.\n'
