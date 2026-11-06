import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  CircleStop,
  Expand,
  Info,
  Loader2,
  MonitorPlay,
  Settings2,
  ShieldAlert,
  Signal,
  Smartphone,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { connectionsApi } from '@/services/api';
import { useRealtime } from '@/context/RealtimeContext';
import { useDevices } from '@/hooks/useDevices';
import { useToast } from '@/context/ToastContext';
import { EmptyState, GlassCard, PageHeader, StatusPill } from '@/components/ui';
import { cn, formatBytes } from '@/lib/format';

type Phase = 'idle' | 'requesting' | 'waiting' | 'negotiating' | 'live' | 'ended' | 'error';

type StreamStats = {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  packetsLost: number;
  jitterMs: number;
};

const QUALITY_PRESETS = [
  { id: 'data-saver', label: 'Data saver', width: 720, bitrateKbps: 900, fps: 15 },
  { id: 'balanced', label: 'Balanced', width: 1080, bitrateKbps: 2500, fps: 30 },
  { id: 'sharp', label: 'Sharp', width: 1440, bitrateKbps: 4500, fps: 30 },
] as const;

export function MirroringPage() {
  const { devices } = useDevices();
  const { subscribe, send, status: realtimeStatus } = useRealtime();
  const { push } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionRef = useRef<string | null>(null);
  const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBytes = useRef<{ bytes: number; at: number } | null>(null);

  const [deviceId, setDeviceId] = useState<string>('');
  const [preset, setPreset] = useState<(typeof QUALITY_PRESETS)[number]['id']>('balanced');
  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState<string>('');
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const onlineDevices = devices.filter((device) => device.online);
  const selected = devices.find((device) => device.id === deviceId) ?? null;

  useEffect(() => {
    if (!deviceId && onlineDevices.length > 0) setDeviceId(onlineDevices[0]!.id);
  }, [onlineDevices, deviceId]);

  const log = useCallback((message: string) => {
    setLogs((current) => [`${new Date().toLocaleTimeString()} · ${message}`, ...current].slice(0, 12));
  }, []);

  const teardown = useCallback(
    async (reason?: string) => {
      if (statsTimer.current) clearInterval(statsTimer.current);
      statsTimer.current = null;
      lastBytes.current = null;
      const connectionId = connectionRef.current;
      if (connectionId) {
        send({ type: 'rtc:hangup', connectionId, reason: reason ?? 'viewer stopped' });
        try {
          await connectionsApi.terminate(connectionId, reason ?? 'viewer stopped');
        } catch {
          /* terminating an already-ended session is fine */
        }
      }
      pcRef.current?.close();
      pcRef.current = null;
      connectionRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setStats(null);
    },
    [send],
  );

  useEffect(() => () => void teardown('viewer left the page'), [teardown]);

  useEffect(() => {
    const unsubscribers = [
      subscribe('rtc:answer', (event) => {
        const pc = pcRef.current;
        if (!pc || event.connectionId !== connectionRef.current) return;
        const description = { type: 'answer' as RTCSdpType, sdp: String(event.sdp ?? '') };
        void pc
          .setRemoteDescription(description)
          .then(() => {
            setPhase('live');
            setDetail('Encrypted media flowing from the device');
            log('Remote answer applied');
          })
          .catch((err: Error) => {
            setPhase('error');
            setDetail(err.message);
            log(`Failed to apply answer: ${err.message}`);
          });
      }),
      subscribe('rtc:ice', (event) => {
        const pc = pcRef.current;
        if (!pc || event.connectionId !== connectionRef.current) return;
        const candidate = new RTCIceCandidate({
          candidate: String(event.candidate ?? ''),
          sdpMid: (event.sdpMid as string | null) ?? null,
          sdpMLineIndex: (event.sdpMLineIndex as number | null) ?? null,
        });
        void pc.addIceCandidate(candidate).catch((err: Error) => log(`ICE candidate rejected: ${err.message}`));
      }),
      subscribe('rtc:hangup', (event) => {
        if (event.connectionId !== connectionRef.current) return;
        void teardown('device hung up');
        setPhase('ended');
        setDetail(String(event.reason ?? 'The device ended the session'));
        log('Device ended the session');
      }),
      subscribe('connection:ended', (event) => {
        if (event.connectionId !== connectionRef.current) return;
        void teardown('connection ended');
        setPhase('ended');
        setDetail(String(event.reason ?? 'Session ended'));
      }),
      subscribe('connection:accepted', (event) => {
        if (event.connectionId !== connectionRef.current) return;
        setPhase('negotiating');
        setDetail('Device accepted — waiting for its answer');
        log('Device accepted the request');
      }),
      subscribe('connection:rejected', (event) => {
        if (event.connectionId !== connectionRef.current) return;
        void teardown('rejected');
        setPhase('error');
        setDetail(String(event.reason ?? 'The device rejected the mirroring request'));
      }),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [subscribe, teardown, log]);

  const startSession = async () => {
    if (!selected) return;
    if (realtimeStatus !== 'online') {
      push({ kind: 'warning', title: 'Realtime channel offline', description: 'The mesh WebSocket is not connected yet. Retry in a moment.' });
      return;
    }
    if (!selected.permissions.screen_capture) {
      push({
        kind: 'warning',
        title: 'Screen capture not enabled',
        description: 'Enable the screen capture capability for this device on the Devices page before mirroring.',
      });
      return;
    }
    setPhase('requesting');
    setDetail('Creating an authenticated signalling session…');
    setLogs([]);
    try {
      const { connection } = await connectionsApi.create({ sourceDeviceId: selected.id, type: 'mirror' });
      connectionRef.current = connection.id;
      log(`Session ${connection.id.slice(0, 8)} created`);

      const ice = await connectionsApi.ice(connection.id);
      log(`ICE servers: ${ice.iceServers.length} (TURN ${ice.iceServers.length > 1 ? 'available' : 'not configured'})`);

      const pc = new RTCPeerConnection({ iceServers: ice.iceServers, bundlePolicy: 'max-bundle' });
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        }
        log(`Received ${event.track.kind} track`);
        setPhase('live');
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && connectionRef.current) {
          send({
            type: 'rtc:ice',
            connectionId: connectionRef.current,
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        log(`Peer connection: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
          setPhase('error');
          setDetail('ICE negotiation failed. A TURN relay is required on restrictive NATs.');
        }
        if (pc.connectionState === 'connected') setPhase('live');
      };

      pc.oniceconnectionstatechange = () => log(`ICE: ${pc.iceConnectionState}`);

      const quality = QUALITY_PRESETS.find((item) => item.id === preset)!;
      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      // Advertise the requested bitrate ceiling through the SDP bandwidth line so the device encoder
      // can adapt; the Android side also caps resolution/frame rate locally.
      const munged = offer.sdp?.replace(
        /(m=video [^\r\n]*\r\n)/,
        `$1b=AS:${quality.bitrateKbps}\r\na=max-framerate:${quality.fps}\r\n`,
      );
      await pc.setLocalDescription({ type: 'offer', sdp: munged ?? offer.sdp });
      const sent = send({
        type: 'rtc:offer',
        connectionId: connection.id,
        sdp: pc.localDescription?.sdp ?? offer.sdp ?? '',
        kind: 'mirror',
      });
      if (!sent) throw new Error('The signalling channel closed before the offer could be sent');

      setPhase('waiting');
      setDetail(`Offer sent to ${selected.name}. Waiting for the device to accept…`);

      statsTimer.current = setInterval(() => {
        void (async () => {
          const activePc = pcRef.current;
          if (!activePc) return;
          const report = await activePc.getStats();
          report.forEach((entry) => {
            if (entry.type === 'inbound-rtp' && 'kind' in entry && entry.kind === 'video') {
              const inbound = entry as RTCInboundRtpStreamStats;
              const now = Date.now();
              const bytes = inbound.bytesReceived ?? 0;
              const previous = lastBytes.current;
              const bitrateKbps =
                previous && now > previous.at ? Math.round(((bytes - previous.bytes) * 8) / (now - previous.at)) : 0;
              lastBytes.current = { bytes, at: now };
              setStats({
                bitrateKbps,
                fps: Math.round(inbound.framesPerSecond ?? 0),
                width: inbound.frameWidth ?? 0,
                height: inbound.frameHeight ?? 0,
                packetsLost: inbound.packetsLost ?? 0,
                jitterMs: Math.round((inbound.jitter ?? 0) * 1000),
              });
            }
          });
        })();
      }, 2000);
    } catch (err) {
      setPhase('error');
      const message = err instanceof Error ? err.message : 'Unable to start the session';
      setDetail(message);
      log(`Error: ${message}`);
      push({ kind: 'error', title: 'Mirroring failed', description: message });
      await teardown('error');
    }
  };

  const stopSession = async () => {
    await teardown('viewer stopped');
    setPhase('ended');
    setDetail('Session ended');
  };

  const phaseTone: Record<Phase, string> = {
    idle: 'text-slate-400',
    requesting: 'text-sky-300',
    waiting: 'text-amber-300',
    negotiating: 'text-accent-400',
    live: 'text-brand-300',
    ended: 'text-slate-400',
    error: 'text-rose-300',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MediaProjection → WebRTC"
        title="Screen mirroring"
        subtitle="The device captures its screen only after the owner approves Android's own consent dialog and shows the mandatory foreground notification. This viewer never records."
        actions={
          phase === 'live' || phase === 'waiting' || phase === 'negotiating' ? (
            <button type="button" className="btn-danger" onClick={() => void stopSession()}>
              <CircleStop className="h-4 w-4" /> Stop session
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void startSession()} disabled={!selected || phase === 'requesting'}>
              <MonitorPlay className="h-4 w-4" /> Start mirroring
            </button>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <GlassCard className="p-0">
          <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-ink-900">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
            {phase !== 'live' ? (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-900 to-ink-950/90">
                <div className="max-w-sm px-6 text-center">
                  {phase === 'requesting' || phase === 'waiting' || phase === 'negotiating' ? (
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-300" />
                  ) : phase === 'error' ? (
                    <ShieldAlert className="mx-auto h-8 w-8 text-rose-300" />
                  ) : (
                    <MonitorPlay className="mx-auto h-8 w-8 text-slate-500" />
                  )}
                  <p className={cn('mt-3 text-sm font-semibold', phaseTone[phase])}>
                    {phase === 'waiting'
                      ? 'Waiting for the device'
                      : phase === 'requesting'
                        ? 'Starting session'
                        : phase === 'negotiating'
                          ? 'Negotiating media'
                          : phase === 'error'
                            ? 'Session failed'
                            : phase === 'ended'
                              ? 'Session ended'
                              : 'No active session'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail || 'Select an online device and start a session.'}</p>
                </div>
              </div>
            ) : (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-rose-400/30 bg-ink-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-200 backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> live view
              </div>
            )}
          </div>

          <div className="grid gap-3 border-t border-white/[0.06] p-4 sm:grid-cols-4">
            {[
              { label: 'Bitrate', value: stats ? `${stats.bitrateKbps} kbps` : '—', icon: Signal },
              { label: 'Frame rate', value: stats ? `${stats.fps} fps` : '—', icon: Activity },
              {
                label: 'Resolution',
                value: stats?.width ? `${stats.width}×${stats.height}` : '—',
                icon: Expand,
              },
              { label: 'Packets lost', value: stats ? String(stats.packetsLost) : '—', icon: Info },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="label flex items-center gap-1.5">
                  <metric.icon className="h-3 w-3" /> {metric.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-100">{metric.value}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-slate-100">Session</h2>
            <label className="mt-3 block">
              <span className="label mb-1.5 block">Source device</span>
              <select className="input" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                <option value="">Select a device</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id} disabled={!device.online}>
                    {device.name} {device.online ? '' : '(offline)'}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <div className="mt-3 flex items-center justify-between">
                <StatusPill online={selected.online} quality={selected.connectionQuality} />
                <span className="chip">
                  <Smartphone className="h-3 w-3" /> Android {selected.androidVersion ?? '?'}
                </span>
              </div>
            ) : null}
            {selected && !selected.permissions.screen_capture ? (
              <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                Screen capture is not enabled for this device. Enable it under Devices → Manage.
              </p>
            ) : null}

            <div className="mt-4">
              <p className="label mb-2 flex items-center gap-1.5">
                <Settings2 className="h-3 w-3" /> Quality request
              </p>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreset(item.id)}
                    className={cn(
                      'focus-ring rounded-lg border px-2 py-2 text-[10px] font-semibold transition',
                      preset === item.id
                        ? 'border-brand-400/40 bg-brand-500/15 text-brand-200'
                        : 'border-white/10 text-slate-400 hover:bg-white/5',
                    )}
                  >
                    {item.label}
                    <span className="mt-1 block text-[9px] font-normal text-slate-500">{item.bitrateKbps} kbps</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                Sent as an SDP bandwidth hint; the Android encoder adapts within its hardware limits.
              </p>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="text-sm font-semibold text-slate-100">Signalling log</h2>
            <AnimatePresence initial={false}>
              {logs.length === 0 ? (
                <p className="mt-3 text-[11px] text-slate-500">No events yet.</p>
              ) : (
                <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto font-mono text-[10px] leading-relaxed text-slate-400">
                  {logs.map((entry, index) => (
                    <motion.li key={`${entry}-${index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {entry}
                    </motion.li>
                  ))}
                </ul>
              )}
            </AnimatePresence>
          </GlassCard>

          {devices.length === 0 ? (
            <EmptyState
              icon={<MonitorPlay className="h-6 w-6" />}
              title="No devices to mirror"
              description="Enroll and connect an Android device first. The device must approve capture consent locally."
            />
          ) : null}
        </div>
      </div>

      <GlassCard>
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
          <div className="space-y-1 text-[11px] leading-relaxed text-slate-400">
            <p>
              <span className="font-semibold text-slate-200">What happens on the device:</span> the app requests
              MediaProjection consent, starts a foreground service with a visible notification and encodes frames with
              MediaCodec. Revoking consent or stopping the notification ends the session immediately.
            </p>
            <p>
              <span className="font-semibold text-slate-200">Media path:</span> encrypted DTLS-SRTP peer-to-peer where NAT
              allows, or relayed through your own coturn server. The backend only relays signalling and short-lived TURN
              credentials ({formatBytes(0)} media stored here).
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
