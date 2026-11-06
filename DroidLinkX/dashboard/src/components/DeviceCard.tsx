import { motion } from 'framer-motion';
import { Battery, ChevronRight, HardDrive, Cpu, ShieldCheck, Wifi } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatBytes, percent, relativeTime } from '@/lib/format';
import type { Device } from '@/lib/types';
import { BatteryIndicator, ProgressBar, StatusPill } from './ui';

export function DeviceCard({ device, compact = false }: { device: Device; compact?: boolean }) {
  const storageUsed =
    typeof device.telemetry.storageTotalBytes === 'number' && typeof device.telemetry.storageFreeBytes === 'number'
      ? device.telemetry.storageTotalBytes - device.telemetry.storageFreeBytes
      : null;
  const storagePercent =
    storageUsed !== null && typeof device.telemetry.storageTotalBytes === 'number'
      ? percent(storageUsed, device.telemetry.storageTotalBytes)
      : null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass glass-hover group relative overflow-hidden p-5"
    >
      <div className="pointer-events-none absolute -right-14 -top-16 h-40 w-40 rounded-full bg-brand-500/10 blur-3xl transition group-hover:bg-brand-400/20" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300">
            <Cpu className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">{device.name}</h3>
            <p className="truncate text-xs text-slate-400">
              {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Android device'}
              {device.androidVersion ? ` · Android ${device.androidVersion}` : ''}
            </p>
          </div>
        </div>
        <StatusPill online={device.online} quality={device.connectionQuality} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <Battery className="h-3 w-3" /> Battery
          </dt>
          <dd className="mt-1">
            <BatteryIndicator level={device.telemetry.battery} charging={device.telemetry.charging} />
          </dd>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <Wifi className="h-3 w-3" /> Network
          </dt>
          <dd className="mt-1 truncate font-medium text-slate-200">{String(device.telemetry.network ?? (device.online ? 'connected' : '—'))}</dd>
        </div>
      </dl>

      {!compact ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3 w-3" /> Storage
            </span>
            <span>
              {storageUsed !== null ? `${formatBytes(storageUsed)} / ${formatBytes(device.telemetry.storageTotalBytes as number)}` : 'not reported'}
            </span>
          </div>
          <ProgressBar className="mt-2" value={storagePercent ?? 0} tone={storagePercent && storagePercent > 85 ? 'amber' : 'brand'} />
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className={device.trusted ? 'h-3.5 w-3.5 text-brand-300' : 'h-3.5 w-3.5 text-slate-600'} />
          {device.trusted ? 'Trusted device' : 'Not trusted'}
        </span>
        <span>Seen {relativeTime(device.lastSeenAt)}</span>
      </div>

      <Link
        to={`/device-info?device=${device.id}`}
        className="focus-ring mt-3 flex items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-brand-400/30 hover:text-white"
      >
        Device details
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </motion.article>
  );
}
