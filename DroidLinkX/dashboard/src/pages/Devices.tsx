import { motion } from 'framer-motion';
import {
  Check,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { devicesApi } from '@/services/api';
import { useDevices } from '@/hooks/useDevices';
import { useToast } from '@/context/ToastContext';
import { DeviceCard } from '@/components/DeviceCard';
import { CardSkeleton, EmptyState, ErrorBanner, GlassCard, Modal, PageHeader, StatusPill, Toggle } from '@/components/ui';
import { formatDateTime, relativeTime, titleCase } from '@/lib/format';
import type { Device } from '@/lib/types';

const PERMISSIONS: Array<{ key: string; label: string; description: string }> = [
  { key: 'screen_capture', label: 'Screen capture', description: 'Allow this device to start a MediaProjection mirroring session after the on-device consent prompt.' },
  { key: 'camera', label: 'Remote camera', description: 'Allow explicit, visible camera streaming sessions from the camera tool.' },
  { key: 'notifications', label: 'Notification sync', description: 'Allow NotificationListenerService records to be forwarded to this account.' },
  { key: 'clipboard', label: 'Clipboard sync', description: 'Allow manual clipboard sync. Sensitive content is always filtered by the server.' },
  { key: 'files', label: 'File access', description: 'Allow browsing the folders the owner granted through the Storage Access Framework.' },
  { key: 'remote_control', label: 'Remote interaction', description: 'Allow supported AccessibilityService navigation actions, only when enabled on the device.' },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-brand-300" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function DevicesPage() {
  const { devices, loading, error, refresh, rename, setTrusted, revoke, setPermission } = useDevices();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('device');
  const selected = devices.find((device) => device.id === selectedId) ?? null;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollName, setEnrollName] = useState('');
  const [enrollModel, setEnrollModel] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState<{ deviceId: string; deviceSecret: string; wsUrl: string } | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; event: string; createdAt: string; detail: Record<string, unknown> }>>([]);

  useEffect(() => {
    if (!selected) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const events = await devicesApi.history(selected.id);
        if (!cancelled) setHistory(events);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const submitEnroll = async () => {
    if (!enrollName.trim()) return;
    setEnrolling(true);
    try {
      const result = await devicesApi.enroll({
        name: enrollName.trim(),
        model: enrollModel.trim() || undefined,
        manufacturer: enrollModel.trim() ? enrollModel.trim().split(' ')[0] : undefined,
        androidVersion: undefined,
      });
      setEnrolled({ deviceId: result.deviceId, deviceSecret: result.deviceSecret, wsUrl: result.wsUrl });
      await refresh(true);
      push({
        kind: 'success',
        title: 'Device enrolled',
        description: 'Copy the device secret now — it is shown only once.',
      });
    } catch (err) {
      push({ kind: 'error', title: 'Enrollment failed', description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setEnrolling(false);
    }
  };

  const onTogglePermission = async (device: Device, permission: string, granted: boolean) => {
    // Enabling a sensitive capability on a device the owner has not yet trusted is refused locally.
    if (granted && !device.trusted && permission !== 'files') {
      push({
        kind: 'warning',
        title: 'Trust the device first',
        description: 'Mark this device as trusted before enabling sensitive remote capabilities.',
      });
      return;
    }
    try {
      await setPermission(device.id, permission, granted);
      push({ kind: 'success', title: `${titleCase(permission)} ${granted ? 'enabled' : 'disabled'}` });
    } catch (err) {
      push({ kind: 'error', title: 'Permission update failed', description: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner-scoped enrollment"
        title="Devices"
        subtitle="Every device holds its own revocable credential. Enrollment always requires your authenticated owner account — QR pairing is only ever an optional shortcut."
        actions={
          <>
            <button type="button" onClick={() => void refresh()} className="btn-ghost">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                setEnrolled(null);
                setEnrollName('');
                setEnrollModel('');
                setEnrollOpen(true);
              }}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" /> Enroll device
            </button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={<Smartphone className="h-6 w-6" />}
          title="No devices enrolled"
          description="Install DroidLink X on the Android device, sign in as this owner and complete the automatic registration flow — or enroll manually here and enter the one-time secret on the device."
          action={
            <button type="button" className="btn-primary" onClick={() => setEnrollOpen(true)}>
              <Plus className="h-4 w-4" /> Enroll the first device
            </button>
          }
        />
      ) : (
        <motion.div layout className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <div key={device.id} className="space-y-2">
              <DeviceCard device={device} />
              <div className="flex flex-wrap gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setParams({ device: device.id })}
                  className="focus-ring rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/5"
                >
                  Manage
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(device.name);
                    setParams({ device: device.id });
                    setRenameOpen(true);
                  }}
                  className="focus-ring inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/5"
                >
                  <Pencil className="h-3 w-3" /> Rename
                </button>
                <button
                  type="button"
                  onClick={() => void setTrusted(device.id, !device.trusted)}
                  className="focus-ring inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/5"
                >
                  {device.trusted ? <ShieldOff className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                  {device.trusted ? 'Untrust' : 'Trust'}
                </button>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title={enrolled ? 'Device enrolled' : 'Enroll a device manually'}
        description={
          enrolled
            ? 'Store the device secret on the Android device. It is hashed on the server and cannot be shown again.'
            : 'Creates a device record with its own credential. The Android app exchanges this secret for a revocable device session.'
        }
        footer={
          enrolled ? (
            <button type="button" className="btn-primary" onClick={() => setEnrollOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={() => setEnrollOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={enrolling || !enrollName.trim()} onClick={() => void submitEnroll()}>
                {enrolling ? 'Enrolling…' : 'Enroll device'}
              </button>
            </>
          )
        }
      >
        {enrolled ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-200">
              This secret is displayed exactly once. Revoke and re-enroll the device if it is lost.
            </div>
            <div className="space-y-2">
              <p className="label">Device ID</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 font-mono text-[11px] text-slate-300">
                  {enrolled.deviceId}
                </code>
                <CopyButton value={enrolled.deviceId} label="Copy device id" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="label">Device secret</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-brand-400/25 bg-brand-500/10 px-3 py-2 font-mono text-[11px] text-brand-200">
                  {enrolled.deviceSecret}
                </code>
                <CopyButton value={enrolled.deviceSecret} label="Copy device secret" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="label">WebSocket endpoint</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-ink-900/80 px-3 py-2 font-mono text-[11px] text-slate-300">
                  {enrolled.wsUrl}
                </code>
                <CopyButton value={enrolled.wsUrl} label="Copy websocket URL" />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="label mb-1.5 block">Device name</span>
              <input
                className="input"
                value={enrollName}
                onChange={(event) => setEnrollName(event.target.value)}
                placeholder="Pixel 9 Pro"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Model (optional)</span>
              <input
                className="input"
                value={enrollModel}
                onChange={(event) => setEnrollModel(event.target.value)}
                placeholder="Google Pixel 9 Pro"
              />
            </label>
            <p className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              The Android app can also self-enroll silently after you sign in with this owner account. Either path creates a
              device-specific credential stored in the Android Keystore.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(selected) && !renameOpen && !revokeOpen}
        onClose={() => setParams({})}
        wide
        title={selected?.name ?? 'Device'}
        description={selected ? `${selected.manufacturer ?? ''} ${selected.model ?? ''} · Android ${selected.androidVersion ?? 'unknown'}` : undefined}
        footer={
          selected ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  try {
                    const count = await devicesApi.revokeSessions(selected.id);
                    push({ kind: 'success', title: `${count} session(s) revoked` });
                  } catch (err) {
                    push({ kind: 'error', title: 'Could not revoke sessions', description: err instanceof Error ? err.message : '' });
                  }
                }}
              >
                <KeyRound className="h-4 w-4" /> Revoke sessions
              </button>
              <button type="button" className="btn-danger" onClick={() => setRevokeOpen(true)}>
                <Trash2 className="h-4 w-4" /> Remove device
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <StatusPill online={selected.online} quality={selected.connectionQuality} />
                <span className="text-[11px] text-slate-500">Seen {relativeTime(selected.lastSeenAt)}</span>
              </div>
              <dl className="space-y-2 text-xs">
                {[
                  ['Device ID', selected.id],
                  ['Platform', titleCase(selected.platform)],
                  ['SDK', selected.sdkInt ? String(selected.sdkInt) : 'unknown'],
                  ['App version', selected.appVersion ?? 'unknown'],
                  ['IP address', String(selected.telemetry.ip ?? 'not reported')],
                  ['Network', String(selected.telemetry.network ?? 'unknown')],
                  ['Enrolled', formatDateTime(selected.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="max-w-[60%] truncate text-right font-medium text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="label mb-2">Connection history</p>
                {history.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No events recorded yet.</p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto text-[11px]">
                    {history.map((event) => (
                      <li key={event.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-300">{titleCase(event.event)}</span>
                        <span className="text-slate-500">{relativeTime(event.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <p className="label mb-1">Capabilities</p>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                Capabilities are enforced server-side. A device that has not enabled a capability locally cannot start that session.
              </p>
              <div className="divide-y divide-white/[0.05]">
                {PERMISSIONS.map((permission) => (
                  <Toggle
                    key={permission.key}
                    label={permission.label}
                    description={permission.description}
                    checked={Boolean(selected.permissions[permission.key])}
                    onChange={(next) => void onTogglePermission(selected, permission.key, next)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename device"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                if (!selected) return;
                try {
                  await rename(selected.id, renameValue);
                  setRenameOpen(false);
                  push({ kind: 'success', title: 'Device renamed' });
                } catch (err) {
                  push({ kind: 'error', title: 'Rename failed', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              Save
            </button>
          </>
        }
      >
        <input className="input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
      </Modal>

      <Modal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Remove this device?"
        description="Its credential and every active session are revoked immediately. The device must be re-enrolled to reconnect."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRevokeOpen(false)}>
              Keep device
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                if (!selected) return;
                try {
                  await revoke(selected.id);
                  setRevokeOpen(false);
                  setParams({});
                  push({ kind: 'success', title: 'Device removed', description: 'All credentials and sessions were revoked.' });
                } catch (err) {
                  push({ kind: 'error', title: 'Removal failed', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Revoke access
            </button>
          </>
        }
      >
        <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-xs text-rose-200">
          Any live WebSocket for this device is closed immediately and its device token stops working.
        </div>
      </Modal>

      {!loading && devices.length > 0 ? (
        <GlassCard>
          <p className="text-xs leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-200">How enrollment stays secure:</span> the owner account issues a
            device-specific secret, hashed with scrypt on the server. The device exchanges it for a token bound to a
            revocable session. Rotating the secret, revoking the session or removing the device takes effect on the next
            request and closes any live socket.
          </p>
        </GlassCard>
      ) : null}
    </div>
  );
}
