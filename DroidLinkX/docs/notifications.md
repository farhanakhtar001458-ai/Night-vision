# Notification sharing (phone → phone / dashboard)

Aapke mobile par jo notification aata hai, wahi aapke doosre phone aur dashboard par dikhta hai. Default **off** — owner jab tak enable na kare, kuch bhi upload/read nahi hota.

## Kaise chalta hai

```
Phone A                                            Phone B / dashboard
NotificationListenerService
  ├─ sharing ON?  (nahi → drop)
  ├─ ignored package / category? (drop)
  ├─ privacy filters (secret visibility, OTP/password regex)
  └─ insert notification_records (external_key unique)
                                                     Realtime subscribe + 15s poll
                                                     posted_at > watermark, device_id ≠ mine
                                                     → local notification / feed item
```

- Table: `notification_records` (RLS: owner-only). Unique `(device_id, external_key)` — same notification dobara insert nahi hota (`Prefer: resolution=ignore-duplicates`).
- Relay: `NotificationRelayService` (foreground) har 15s watermark ke aage ki rows padhta hai; phone par local notification post karta hai, dashboard par `SharedNotification` feed.
- Watermark `NotificationShareStore.lastDeliveredPostedAt` me persist hota hai — force-stop ke baad bhi duplicate nahi.

## Privacy filters (code me enforced)

| Rule | Behaviour |
| --- | --- |
| `VISIBILITY_SECRET` | Sirf app ka naam bhejta hai (`title=null`, `content="Hidden notification"`) |
| OTP / password / PIN pattern | Title aur text `•••` se replace, `is_sensitive=true` |
| Group summaries, ongoing, media, progress categories | Skip |
| Apni hi app, `android`, `com.android.systemui`, downloads, GMS | Skip |
| Text length | 500 chars max per field |

## Code map

| File | Role |
| --- | --- |
| `core/data/.../notification/DroidNotificationListener.kt` | System listener, filters, `share()` |
| `core/data/.../notification/NotificationShareStore.kt` | Opt-in flags + delivery watermark (SharedPreferences) |
| `core/data/.../notification/NotificationRelayService.kt` | 15s poll + local notification |
| `core/data/.../notification/NotificationShareRepositoryImpl.kt` | PostgREST upload/download |
| `feature/tools/.../ToolsScreen.kt` | Grant access, toggles, recent list |
| `supabase/migrations/20261106090500_notification_sharing.sql` | Table, indexes, RLS, realtime |

## Dashboard

Dashboard (React) `notification_records` ko realtime channel se sunta hai aur owner ke saare devices ki notifications ek feed me dikhata hai (device name ke saath). Sirf signed-in owner ko dikhta hai (RLS + anon key).

## Enable karne ke steps

1. Phone A: **Tools → Notifications → Grant notification access** (system settings).
2. Phone A: **Share notifications from this device** ON.
3. Phone B: **Receive from my other devices** ON (foreground service chalu ho jata hai).
4. Test: Phone A par koi WhatsApp/message aaye → Phone B par turant wahi notification.
