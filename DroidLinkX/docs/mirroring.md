# Screen mirroring (phone → phone)

Do phones, ek hi owner account. Sharing wala phone screen capture karta hai, doosra phone stream dekhta hai.

## Flow

```
Phone A (device, offerer)                          Phone B (viewer, answerer)
  user taps "Start screen share"                     user taps "Watch"
  MediaProjection consent  ─┐                        │
  ScreenShareService (FGS)  │                        │
  insert rtc_signals(kind=request)  ◄────────────────┘  insert rtc_signals(kind=request, sender=viewer)
  poll rtc_signals: request
  createOffer → insert(kind=offer)
                                                     poll rtc_signals: offer → createAnswer → insert(kind=answer)
  poll: answer → setRemoteDescription
  ICE candidates → insert(kind=ice, payload.candidate)
                                                     ICE candidates → insert(kind=ice, ...)
  ── media/DTLS seedha phone-to-phone (STUN ke through) ──
  "Stop" → insert(kind=hangup)
```

- Signaling Supabase `rtc_signals` table se hota hai (PostgREST + RLS), koi extra server nahi chahiye. Node relay (`signaling/`) sirf optional dashboard path ke liye hai.
- Polling interval 1.5s, rows 3 minute baad stale maane jaate hain; `prune_rtc_signals()` cleanup karta hai.
- Peer connection: Unified Plan, 1280×720 @ 30fps, `stun:stun.l.google.com:19302`.

## Code map

| File | Role |
| --- | --- |
| `core/data/.../mirroring/ScreenShareService.kt` | Foreground service, MediaProjection ka malik, notification + projection lifecycle |
| `core/data/.../mirroring/ScreenMirroringController.kt` | WebRTC (PeerConnectionFactory, SDP/ICE), `rtc_signals` insert/poll, `MirroringState` |
| `core/network/.../SupabaseApis.kt` → `SupabaseToolsApi` | `insertSignal`, `signalsFrom`, `shareRequests`, `deleteSignals` |
| `feature/tools/.../ToolsScreen.kt` | UI: device list, Start/Watch, `SurfaceViewRenderer` |
| `supabase/migrations/20261106090500_notification_sharing.sql` | `rtc_signals` table + RLS + prune |

## Rules

- `sender` role: `device` (screen sharing) ya `viewer` (watching). Ek connection me ek hi device row.
- Sirf owner apni rows padh/likh sakta hai (RLS: `owner_id = auth.uid()`).
- Screen capture sirf tab chalu hota hai jab user system dialog par **Allow** kare — app khud se start nahi kar sakta.
- Stop/hangup par `ScreenShareService.stop()` + `PeerConnection.dispose()` + signals delete.

## Known limits

- Public STUN hi configured hai; symmetric NAT / carrier-grade NAT par TURN chahiye (`TURN_URLS` + `TURN_SECRET` Edge Function secrets, coturn recommended).
- Audio share nahi hota (screen only).
- Ek waqt me ek viewer per connection id; multi-viewer ke liye alag `connection_id` per viewer chalega.
