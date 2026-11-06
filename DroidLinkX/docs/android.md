# Android app

Kotlin 2.1.21 · Compose Material 3 · Hilt · Room · DataStore · OkHttp/Retrofit/Moshi · WorkManager ·
Gradle 8.14.3 · AGP 8.11.1 · `compileSdk`/`targetSdk` 36 · `minSdk` 26 · JVM 17 ·
`applicationId com.droidlinkx.app` (debug suffix `.debug`).

## Module graph

```
:app ──┬─► :feature:dashboard ─┐
       ├─► :feature:devices   ─┼─► :core:domain ◄─ :core:data ─► :core:network
       ├─► :feature:settings  ─┘        ▲                │  └──► :core:security
       │                                │                │  └──► :core:database
       └─► :core:{common,designsystem,domain,data,network,security,database}
```

| Module | Contents |
| --- | --- |
| `:app` | `DroidLinkApplication` (`@HiltAndroidApp`, WorkManager `Configuration.Provider`), `MainActivity`, 5-tab Compose shell, sign-in / sign-up screens, manifest, resources |
| `:core:common` | `DroidLog` (token-redacting), `Formatters` |
| `:core:designsystem` | Theme (dark glass palette, typography) and shared components (`DroidCard`, `MetricRow`, `ScreenHeader`, …) |
| `:core:domain` | Models, `Outcome`, repository interfaces (`OwnerAuthRepository`, `DeviceRegistrationRepository`, `DeviceCatalogueRepository`, `TelemetryRepository`, `LinkManager`, `StartupCoordinator`, `ConnectionRepository`, `LinkServiceController`, `DeviceSettingsRepository`) |
| `:core:data` | Repository implementations, `SessionStorage`, settings, telemetry collector, `LinkManagerImpl`, `NetworkMonitor`, `StartupCoordinatorImpl`, `ConnectionService`, `ConnectionRecoveryWorker`, Hilt bindings |
| `:core:network` | Moshi DTOs, `PublicApi`/`OwnerApi`/`DeviceApi`, `RealtimeSocket`, OkHttp/Retrofit providers (owner/device/plain clients, bearer interceptors) |
| `:core:security` | `CredentialVault`, `KeystoreCrypto` (AES-256-GCM), `EncryptedCredentialVault` |
| `:core:database` | Room v1: `cached_devices`, `connection_events`, `telemetry_outbox` + DAOs |

Feature modules never import transport, SQL or Keystore types.

## Startup sequence

`StartupCoordinatorImpl.initialize()` reports progress through `InitializationState`
(`Idle → GeneratingIdentity → SecuringCredentials → PreparingDatabase → PreparingNetwork →
PreparingCloudLink → CheckingConnectivity → RegisteringDevice → OpeningSocket → Ready`), with
`WaitingForOwner` (not signed in), `Failed` and an offline short-circuit when no validated network exists.
The dashboard renders this state verbatim, so the UI never claims to be connected before it is.

After sign-in, `AuthViewModel` calls `registerCurrentDevice()` and then re-runs the coordinator; the
foreground service starts automatically when the owner left **Foreground connection** enabled.

## Connection state machine

`LinkManagerImpl`:

1. Requires stored device credentials; otherwise `Disconnected` ("Device is not enrolled").
2. Refreshes the device token when it is missing or expires within 60 s (`POST /api/devices/token`).
3. Starts the socket event collector, the socket-state collector and the paced telemetry loop.
4. Maps transport states: `Open → Authenticated`, `Connecting`, `Reconnecting` (with last error),
   `Rejected → AuthorizationFailed`, `Closed/Idle → Disconnected`.
5. Telemetry (`device:status` + `device:heartbeat`) is sent at the configured interval (30–900 s) only while
   authenticated, and is also POSTed to `POST /api/devices/:id/status`. Reconnection is delegated to
   `RealtimeSocket` (jittered exponential backoff, 25 s heartbeat, no retry on credential rejection).

Background behaviour is Android-compliant: the live socket runs inside `ConnectionService`
(`foregroundServiceType="dataSync"`, persistent notification, stop action). `ConnectionRecoveryWorker`
runs a bounded 30-minute periodic task (network-constrained) that only refreshes the device token and
flushes telemetry; `BootReceiver` re-arms it after reboot. Nothing spins in a busy loop and Doze is never
bypassed.

## Secure storage

| Key (encrypted vault) | Contents |
| --- | --- |
| `owner.session` | owner profile + access/refresh tokens |
| `device.credentials` | device id, secret, name, ws URL |
| `device.session` | device access token, session id, expiry |
| `installation.id` | stable UUID generated on first launch |

Vault: AES-256-GCM, key in AndroidKeyStore (`droidlinkx.vault.v1`), ciphertext `iv||ct` base64 in
`droidlinkx.secure.v1` SharedPreferences, excluded from backup/device-transfer rules.

Settings: DataStore `droidlinkx.settings` (`api_base_url`, `telemetry_interval_seconds` 30–900,
`keep_alive_enabled`). HTTP base URLs are rejected unless they point at a loopback/private development
address.

## UI

5-tab bottom navigation: **Home** (dashboard: link health, device counts, local telemetry, enrolled
devices), **Devices** (rename, trust, per-capability permissions, revoke, request mirroring session),
**Transfer**, **Tools**, **Profile** (owner account, server URL, telemetry interval, foreground
connection, battery-optimisation shortcut, remove device, privacy statement, sign out).

Tabs for tools that are not implemented yet show a phase status card instead of dead controls — no fake
buttons are shipped.

## Permissions

| Permission | When | Notes |
| --- | --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | always | transport + connectivity monitoring |
| `POST_NOTIFICATIONS` | first launch (Android 13+) | foreground-service notification; the link still works if denied |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | foreground link | persistent notification |
| `RECEIVE_BOOT_COMPLETED` | reboot | re-arms the recovery worker only |
| `WAKE_LOCK` | WorkManager | bounded jobs |

Not requested in this phase: camera, microphone, notifications listener, accessibility, media projection —
those are added by the phase that implements the matching tool, always behind a user-visible consent step.

## Building

```bash
cd android
./gradlew :app:assembleDebug        # requires JDK 17 + Android SDK 36
./gradlew test
```

Set the backend URL in the app (Profile → Server configuration) when testing on a physical device; debug
builds allow cleartext only via `app/src/debug/res/xml/network_security_config.xml`.
