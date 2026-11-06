import { Cpu, HardDrive, Info, MemoryStick, Smartphone, Thermometer, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { devicesApi } from '@/services/api';
import { useDevices } from '@/hooks/useDevices';
import { EmptyState, GlassCard, PageHeader, ProgressBar, StatusPill } from '@/components/ui';
import { formatBytes, formatDateTime, percent, relativeTime, titleCase } from '@/lib/format';
import type { Device } from '@/lib/types';

export function DeviceInfoPage() {
  const { devices, loading } = useDevices();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('device') ?? devices[0]?.id ?? '';
  const selected = devices.find((device) => device.id === selectedId) ?? devices[0] ?? null;
  const [history, setHistory] = useState<Array<{ id: string; event: string; createdAt: string }>>([]);

  useEffect(() => {
    if (!selected) return;
    if (!params.get('device')) setParams({ device: selected.id }, { replace: true });
    let cancelled = false;
    void devicesApi
      .history(selected.id)
      .then((events) => {
        if (!cancelled) setHistory(events);
      })
      .catch(() => setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [selected, params, setParams]);

  if (!loading && devices.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Reported by the device" title="Device information" />
        <EmptyState
          icon={<Smartphone className="h-6 w-6" />}
          title="No device enrolled"
          description="Device telemetry is reported by the authenticated Android client and stored per device."
        />
      </div>
    );
  }

  const device: Device | null = selected;
  const telemetry = device?.telemetry ?? {};
  const storageTotal = typeof telemetry.storageTotalBytes === 'number' ? telemetry.storageTotalBytes : null;
  const storageFree = typeof telemetry.storageFreeBytes === 'number' ? telemetry.storageFreeBytes : null;
  const storageUsed = storageTotal !== null && storageFree !== null ? storageTotal - storageFree : null;
  const ramTotal = typeof telemetry.ramTotalBytes === 'number' ? telemetry.ramTotalBytes : null;
  const ramUsed = typeof telemetry.ramUsedBytes === 'number' ? telemetry.ramUsedBytes : null;

  const rows: Array<{ label: string; value: string }> = device
    ? [
        { label: 'Manufacturer', value: device.manufacturer ?? 'not reported' },
        { label: 'Model', value: device.model ?? 'not reported' },
        { label: 'Android version', value: device.androidVersion ?? 'not reported' },
        { label: 'SDK / API level', value: device.sdkInt ? String(device.sdkInt) : 'not reported' },
        { label: 'App version', value: device.appVersion ?? 'not reported' },
        { label: 'Platform', value: titleCase(device.platform) },
        { label: 'Network type', value: String(telemetry.network ?? 'not reported') },
        { label: 'IP address', value: String(telemetry.ip ?? 'not reported') },
        { label: 'Screen resolution', value: String(telemetry.screenResolution ?? 'not reported') },
        { label: 'CPU', value: String(telemetry.cpu ?? 'not reported') },
        { label: 'Device uptime', value: typeof telemetry.uptimeSeconds === 'number' ? `${Math.floor(telemetry.uptimeSeconds / 3600)}h ${Math.floor((telemetry.uptimeSeconds % 3600) / 60)}m` : 'not reported' },
        { label: 'Battery temperature', value: typeof telemetry.batteryTemperatureC === 'number' ? `${telemetry.batteryTemperatureC.toFixed(1)} °C` : 'not reported' },
        { label: 'Enrolled', value: formatDateTime(device.createdAt) },
        { label: 'Last seen', value: `${formatDateTime(device.lastSeenAt)} (${relativeTime(device.lastSeenAt)})` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Official Android APIs only"
        title="Device information"
        subtitle="Telemetry comes from BatteryManager, StatFs, ActivityManager, ConnectivityManager and Build — nothing is hardcoded, and missing values are shown as not reported."
        actions={
          <select className="input w-auto" value={device?.id ?? ''} onChange={(event) => setParams({ device: event.target.value })}>
            {devices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        }
      />

      {device ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <GlassCard className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300">
                <Smartphone className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="label">Device</p>
                <p className="truncate text-sm font-semibold text-white">{device.name}</p>
                <StatusPill online={device.online} quality={device.connectionQuality} />
              </div>
            </GlassCard>
            <GlassCard>
              <p className="label flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" /> Storage
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {storageUsed !== null && storageTotal !== null
                  ? `${formatBytes(storageUsed)} / ${formatBytes(storageTotal)}`
                  : 'not reported'}
              </p>
              <ProgressBar className="mt-2" value={storageUsed !== null && storageTotal ? percent(storageUsed, storageTotal) : 0} />
            </GlassCard>
            <GlassCard>
              <p className="label flex items-center gap-1.5">
                <MemoryStick className="h-3 w-3" /> RAM
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {ramUsed !== null && ramTotal !== null ? `${formatBytes(ramUsed)} / ${formatBytes(ramTotal)}` : 'not reported'}
              </p>
              <ProgressBar className="mt-2" value={ramUsed !== null && ramTotal ? percent(ramUsed, ramTotal) : 0} tone="accent" />
            </GlassCard>
            <GlassCard>
              <p className="label flex items-center gap-1.5">
                <Thermometer className="h-3 w-3" /> Battery
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {typeof telemetry.battery === 'number' ? `${telemetry.battery}%` : 'not reported'}
                {telemetry.charging ? ' · charging' : ''}
              </p>
              <p className="text-[11px] text-slate-400">
                {typeof telemetry.batteryTemperatureC === 'number' ? `${telemetry.batteryTemperatureC.toFixed(1)} °C` : 'temperature not reported'}
              </p>
            </GlassCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <GlassCard className="p-0">
              <div className="border-b border-white/[0.06] p-4">
                <h2 className="text-sm font-semibold text-slate-100">Reported values</h2>
              </div>
              <dl className="divide-y divide-white/[0.05]">
                {rows.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs text-slate-500">{row.label}</dt>
                    <dd className="max-w-[55%] break-words text-right text-xs font-medium text-slate-200">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </GlassCard>

            <div className="space-y-4">
              <GlassCard>
                <h2 className="text-sm font-semibold text-slate-100">Capabilities</h2>
                <ul className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  {Object.keys(device.permissions).length === 0 ? (
                    <li className="col-span-2 text-slate-500">No capability granted yet.</li>
                  ) : (
                    Object.entries(device.permissions).map(([key, granted]) => (
                      <li
                        key={key}
                        className={`rounded-lg border px-2.5 py-1.5 ${
                          granted ? 'border-brand-400/25 bg-brand-500/10 text-brand-200' : 'border-white/10 text-slate-500'
                        }`}
                      >
                        {titleCase(key)}
                      </li>
                    ))
                  )}
                </ul>
              </GlassCard>

              <GlassCard>
                <h2 className="text-sm font-semibold text-slate-100">Connection history</h2>
                {history.length === 0 ? (
                  <p className="mt-2 text-[11px] text-slate-500">No events recorded.</p>
                ) : (
                  <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-[11px]">
                    {history.map((event) => (
                      <li key={event.id} className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2">
                        <span className="text-slate-300">{titleCase(event.event)}</span>
                        <span className="text-slate-500">{relativeTime(event.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassCard>

              <GlassCard className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Where Android does not expose a value to third-party apps (for example some network or CPU details),
                  the field stays empty instead of being guessed. Sensor-level values such as battery temperature are
                  reported through BatteryManager broadcasts.
                </p>
              </GlassCard>
            </div>
          </div>
        </>
      ) : (
        <GlassCard>
          <p className="text-xs text-slate-400">Select a device.</p>
        </GlassCard>
      )}

      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
        <span className="chip">
          <Wifi className="h-3 w-3" /> network {String(telemetry.network ?? 'unknown')}
        </span>
        <span className="chip">
          <Cpu className="h-3 w-3" /> {String(telemetry.cpu ?? 'cpu not reported')}
        </span>
      </div>
    </div>
  );
}
