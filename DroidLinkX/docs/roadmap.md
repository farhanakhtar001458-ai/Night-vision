# Roadmap and phase status

| Phase | Deliverable | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 1 | Backend foundation | Schema, auth with rotating refresh tokens, device enroll/token/revoke, presence, REST surface, WebSocket relay, signalling + TURN config, files, chunked transfers, notifications/clipboard, activity; migrations; 43 passing tests | ✅ Done |
| 2 | React dashboard | 12 pages backed by real APIs, realtime WS updates, WebRTC viewer, resumable uploader, security/settings; `npm run build` clean | ✅ Done |
| 3 | Android app foundation | Gradle multi-module project, Hilt + Compose Material 3, Keystore vault, automatic enrollment, startup coordinator, foreground link, Room cache, dashboard/devices/settings screens, WorkManager recovery, 5-tab shell | ✅ Code complete (first Gradle sync happens in Android Studio) |
| 4 | File manager + transfers on Android | SAF picker, chunked resumable upload/download with SHA-256, progress UI, outbox retry, no scoped-storage bypass | ⏳ Next |
| 5 | Screen mirroring | MediaProjection consent + foreground notification, WebRTC capture/encode, viewer controls, hangup, audit | ⏳ |
| 6 | Remote camera, notifications, clipboard, accessibility control | Explicit consent surfaces, visible indicators, sensitivity filtering, accessibility service opt-in with visible actions | ⏳ |
| 7 | Offline / mDNS mode + hardening | Local discovery without cloud, capability negotiation, rate-limit/retry polish, accessibility review, battery profiling | ⏳ |
| 8 | Release engineering | Signed APK, CI, final docs, deployment verification, security review | ⏳ |

## Definition of done for every phase

1. The code compiles in its own toolchain (no broken builds handed forward).
2. Backend suites green; dashboard production build green.
3. New behaviour verified manually end-to-end (device ↔ backend ↔ dashboard).
4. Documentation updated in `docs/` in the same change.
5. No hidden injection, no permission bypass, no plaintext secrets, no fake controls.

## Known environment limitation

The repository was authored in a sandbox without JDK, Gradle, Android SDK, Docker or PostgreSQL. Backend
tests and the dashboard build were executed and verified there; Android compilation and Docker image
builds must be run by the developer (commands in `docs/testing.md`) — the project is structured so that a
Gradle sync surfaces real errors rather than placeholders.
