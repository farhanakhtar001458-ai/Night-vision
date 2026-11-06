# WebSocket protocol

```
wss://<host>/ws?token=<access-or-device-token>&role=user|device
```

* `role=user` requires an owner access token; `role=device` requires a device token.
* The upgrade is rejected with **HTTP 401** when the token is missing, expired, revoked or belongs to the
  wrong role. Clients must not retry a 401 automatically (treat it as a credential failure).
* Every frame is a JSON object with a `type` field. Unknown types answer
  `{"type":"error","code":"BAD_REQUEST","message":"…"}`.
* Server heartbeat: WebSocket ping every 30 s (dead peers are terminated). Application heartbeat:
  clients may send `{"type":"ping"}` and receive `{"type":"pong","t":<ms>}`.

## Server → client events

| Event | Payload | Meaning |
| --- | --- | --- |
| `hello` | `{role, deviceId?, userId, heartbeatIntervalMs:30000, events:[…]}` | First frame after a successful upgrade. |
| `presence:sync` | `{devices:[{id, name, online}], at}` | Sent to owner sockets after `hello`. |
| `pong` | `{t}` | Reply to `ping`. |
| `device:online` / `device:offline` | `{deviceId, at}` | Verified presence transition (socket-based, not merely TTL). |
| `device:heartbeat` | `{deviceId, battery?, charging?, network?, at}` | Device heartbeat/telemetry summary, fanned out to owner sockets. |
| `connection:request` | `{connectionId, connectionType, sourceDeviceId, targetDeviceId, requestedBy, at}` | Incoming connection request (target device + owner terminals). |
| `connection:accepted` / `connection:rejected` | `{connectionId, reason?}` | Peer decision. |
| `connection:ended` | `{connectionId, reason}` | Terminated by hangup, revoke or timeout. |
| `rtc:offer` / `rtc:answer` / `rtc:ice` | `{connectionId, sdp | candidate, sdpMid?, sdpMLineIndex?, from, fromId}` | Relayed signalling (sender never receives its own frame). |
| `transfer:progress` / `transfer:completed` / `transfer:failed` | `{transferId, bytes?, total?, itemIndex?, error?}` | Transfer state fan-out to the owner's other terminals. |
| `notification:sync` | device-originated notification batch | Real-time notification mirroring. |
| `clipboard:sync` | `{content?, contentType?, sensitive?, at}` | Clipboard update pushed from a device or from `POST /api/clipboard/push`. |
| `file:response` / `command:result` | device-originated payloads | Replies to owner-issued `file:list` / command frames. |
| `error` | `{code, message}` | Protocol-level rejection; the connection stays open unless the error is fatal. |

## Client → server events

| Event | Payload | Notes |
| --- | --- | --- |
| `ping` | `{t?}` | Liveness. |
| `device:heartbeat` | `{battery?, charging?, network?}` | Updates `device_sessions.last_heartbeat_at` and presence TTL. |
| `device:status` | `{telemetry?, battery?, charging?, network?}` | Telemetry snapshot, mirrored to owner sockets. |
| `connection:request` | `{targetDeviceId?, connectionId?, connectionType}` | Device-initiated session (e.g. "push file to owner"). |
| `connection:accepted` / `connection:rejected` | `{connectionId, reason?}` | Participant decision; audited as `connection_accepted`/`connection_rejected`. |
| `rtc:offer` / `rtc:answer` / `rtc:ice` | `{connectionId, sdp | candidate, …}` | Must come from a participant of the connection. |
| `rtc:hangup` | `{connectionId, reason?}` | Ends the connection and emits `connection:ended`. |
| `transfer:progress` / `transfer:completed` / `transfer:failed` | `{transferId, …}` | Only the transfer owner may send. |
| `file:list` | `{requestId, path?, category?}` | Ask a device for a directory listing; device replies `file:response`. |
| `clipboard:sync` / `notification:sync` | payload | Relayed to the owner's other sockets. |
| `command:result` | payload | Result of an owner-issued command. |

## Authorisation rules

* A frame referencing a `connectionId` is accepted only from a socket that is a participant
  (`sub` matches `source_device_id`/`target_device_id` for devices, `uid` matches `user_id` for users).
* Frames referencing a `transferId` must belong to the socket's user.
* Relay excludes the sender's own socket, so a device never receives its own echo.
* Closing a device socket marks the device offline and broadcasts `device:offline`.

## Client expectations (Android)

`RealtimeSocket` reconnects with full jitter, exponential backoff (1 s → 60 s cap), resets the attempt
counter on a successful `hello`, sends `ping` on a 25 s interval and stops permanently on a rejected
upgrade (401/403). Reconnection is never attempted while the device has no validated network.
