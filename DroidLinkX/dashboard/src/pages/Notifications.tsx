import { BellRing, BellOff, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { notificationsApi } from '@/services/api';
import { useDevices } from '@/hooks/useDevices';
import { useRealtime } from '@/context/RealtimeContext';
import { useToast } from '@/context/ToastContext';
import { EmptyState, ErrorBanner, GlassCard, PageHeader, Skeleton } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import type { NotificationRecord } from '@/lib/types';

export function NotificationsPage() {
  const { devices } = useDevices();
  const { subscribe } = useRealtime();
  const { push } = useToast();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setItems(await notificationsApi.list(deviceId || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    const off = subscribe('notification:sync', () => void load());
    return () => off();
  }, [subscribe]);

  const enabledDevices = devices.filter((device) => device.permissions.notifications);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="NotificationListenerService · consent gated"
        title="Notifications"
        subtitle="Only devices where you explicitly enabled notification sync send records. The server drops anything that looks like an OTP, password or banking code before it is stored."
        actions={
          <>
            <select className="input w-auto" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn-ghost" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                try {
                  const deleted = await notificationsApi.clear();
                  push({ kind: 'success', title: `${deleted} record(s) cleared` });
                  await load();
                } catch (err) {
                  push({ kind: 'error', title: 'Could not clear records', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {enabledDevices.length === 0 ? (
        <GlassCard className="flex items-start gap-3 border-amber-400/25 bg-amber-500/[0.06]">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-xs leading-relaxed text-amber-100/80">
            No device has notification sync enabled. Grant Android’s notification-access permission on the device, then
            enable the capability under <span className="font-semibold">Devices → Manage → Notification sync</span>.
          </p>
        </GlassCard>
      ) : (
        <div className="flex flex-wrap gap-2">
          {enabledDevices.map((device) => (
            <span key={device.id} className="chip border-brand-400/25 text-brand-200">
              <ShieldCheck className="h-3 w-3" /> {device.name} syncing
            </span>
          ))}
        </div>
      )}

      <GlassCard className="p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] p-4">
          <h2 className="text-sm font-semibold text-slate-100">Synced records</h2>
          <span className="chip">{items.length}</span>
        </div>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<BellRing className="h-6 w-6" />}
              title="Nothing synced yet"
              description="Notifications appear here when an enabled device forwards them. Sensitive content is filtered server-side and never stored."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3.5">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-[11px] font-bold uppercase text-brand-300">
                  {item.appName.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs font-semibold text-slate-100">{item.title ?? item.appName}</p>
                    <span className="shrink-0 text-[10px] text-slate-500" title={formatDateTime(item.postedAt)}>
                      {relativeTime(item.postedAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{item.content ?? 'No content'}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {item.appName} · {item.packageName} · {item.deviceName}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
