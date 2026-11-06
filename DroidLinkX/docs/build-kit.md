# Build kit — DroidLink X APK

Har cheez jo APK banane ke liye chahiye, ek jagah. Do raste hain: **GitHub Actions** (computer par kuch install nahi karna) ya **local Gradle build**.

---

## 0. Kya pehle se ready hai

| Cheez | Status |
| --- | --- |
| Supabase project | `https://zarxnrkzdwnjiauybghl.supabase.co` — schema, RLS, buckets, realtime, Edge Function `enroll-device` live |
| Supabase URL + anon key | App me **baked** (`core/network/build.gradle.kts` me default) — APK install karke seedha aapke project se baat karega |
| Screen mirroring | `feature/tools` → *Screen mirroring* (WebRTC, signaling `rtc_signals` table se) |
| Notification sharing | `feature/tools` → *Notifications* (opt-in, privacy filters ke saath) |
| APK binary | Is sandbox me JDK/Android SDK nahi hai, is liye yahan compile nahi hota — CI (neeche) 8–12 min me APK bana deta hai |

---

## 1. Sabse aasan rasta — GitHub Actions (recommended)

Workflow: `.github/workflows/droidlinkx-apk.yml`

1. Repo → **Actions** → **DroidLink X debug APK** → job green hone ka wait karo (8–12 min).
2. **Releases** page par `apk-<timestamp>` tag ke saath **`droidlinkx-debug.apk`** mil jayega — seedha download karo.
   (Backup: Actions run page → Artifacts → `droidlinkx-debug-apk`.)
3. Phone me install karo (`adb install -r droidlinkx-debug.apk`, ya file kholke "Install unknown apps" allow karo).

Kuch bhi configure karne ki zarurat nahi — URL/anon key already baked hain. Agar aap **apna alag** project use karna chahein to repo secrets set kar do (workflow inhi ko uthata hai):

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` / publishable key |
| `SIGNALING_URL` | optional, sirf tab jab Node signaling relay deploy kiya ho (`wss://…`) |

`SUPABASE_SERVICE_ROLE_KEY` **kabhi** APK/CI secrets me na daalein — wo sirf Edge Functions ke secrets hain.

---

## 2. Local build (JDK 17 + Android SDK 36)

```bash
cd DroidLinkX/android
export ANDROID_HOME=$HOME/Android/Sdk          # Android Studio ka default path
export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which javac))))   # JDK 17
./gradlew :app:assembleDebug                   # → app/build/outputs/apk/debug/app-debug.apk
```

Pehli baar SDK platform install karna pade to:

```bash
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

### Build properties (optional override)

`gradle.properties` (project root ya `~/.gradle/gradle.properties`) me daalein:

```properties
droidlinkx.supabase.url=https://zarxnrkzdwnjiauybghl.supabase.co
droidlinkx.supabase.anonKey=<anon key>
# droidlinkx.signaling.url=wss://signaling.example.com
```

Env variables bhi chalte hain (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SIGNALING_URL`) — property ko override karte hain. Priority: **gradle property → env var → baked default**.

---

## 3. Release build (signed)

Debug APK testing ke liye theek hai, par doosre phone par share karne ke liye release + apni keystore behtar hai.

```bash
# ek baar: keystore banao
keytool -genkeypair -v -keystore droidlinkx-release.jks \
  -alias droidlinkx -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "CN=DroidLink X, OU=Owner, O=DroidLink, L=Patna, S=Bihar, C=IN"
```

`~/.gradle/gradle.properties` me:

```properties
droidlinkx.release.storeFile=/absolute/path/droidlinkx-release.jks
droidlinkx.release.storePassword=<store pass>
droidlinkx.release.keyAlias=droidlinkx
droidlinkx.release.keyPassword=<key pass>
```

```bash
./gradlew :app:assembleRelease    # → app/build/outputs/apk/release/app-release.apk
```

CI me release banane ke liye keystore ko base64 karke secrets me daalo (`RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`) aur workflow me decode step add karo. **Keystore aur passwords kabhi commit na karein.**

Signing key kho gayi to Play Store style updates nahi ho payenge — backup rakhein.

---

## 4. Install ke baad — 2 minute ka setup

1. App kholo → **Sign up / Sign in** (owner account; yehi account dashboard par bhi chalega).
2. **Devices** tab → *Enrol this device* → device Supabase me register ho jata hai (secret Android Keystore me).
3. **Tools → Screen mirroring**
   * Share karne wale phone par: *Start screen share* → Android ka "Start recording/casting" popup → **Allow**.
   * Dekhne wale phone par (same account): device list me dusra phone chuno → *Watch*.
4. **Tools → Notifications**
   * Step 1: *Grant notification access* → Settings me DroidLink X ko allow karo.
   * Step 2: *Share notifications from this device* ON.
   * Step 3: doosre phone par *Receive from my other devices* ON.
   * Ab kisi bhi app ka notification aane par wahi notification doosre phone par (aur dashboard par) aata hai.

Permissions jo maange jayenge: notification access (special access), post notifications (Android 13+), foreground-service + media projection (casting).

---

## 5. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build fail: `compileSdk 36 not found` | `sdkmanager "platforms;android-36"` |
| Build fail: `Unsupported class file major version` | JDK 17 chahiye, 21/11 nahi |
| App khulta hai par data nahi aata | `https://<ref>.supabase.co/rest/v1/devices` browser me anon key ke saath check karo; key galat ya project paused ho sakta hai |
| Mirroring "connecting" par atak jaye | Dono phone me internet chahiye; STUN public hai, symmetric NAT par TURN set karna padega (`TURN_URLS`, `TURN_SECRET` function secrets) |
| Notifications nahi aa rahe | Notification access granted? Sharing ON? Relay ON doosre phone par? Battery optimisation se app exclude karo |
| `401` / session expired | Sign out → sign in (refresh token rotate) |

---

## 6. Verification (jo sandbox me chala hua hai)

- RLS suite: `21/21` pass (local stub DB par migrations + `tests/rls_test.sql`).
- Edge functions: bundled copies `tsc` clean (0 errors).
- Signaling relay: `vitest` 18/18.
- Dashboard: `tsc -b` + `vite build` green.
- Android: yahan compile nahi hua (no SDK) — CI job `Assemble debug APK` yahi compile karta hai; log `droidlinkx-build-log` artifact me milta hai.
