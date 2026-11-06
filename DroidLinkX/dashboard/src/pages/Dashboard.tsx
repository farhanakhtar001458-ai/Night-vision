import { motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  MonitorPlay,
  Radio,
  Smartphone,
  UploadCloud,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { activityApi, filesApi, transfersApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useDevices } from '@/hooks/useDevices';
import { DeviceCard } from '@/components/DeviceCard';
import { CardSkeleton, EmptyState, ErrorBanner, GlassCard, PageHeader, ProgressBar, StatCard } from '@/components/ui';
import { cn, formatBytes, humanAction, relativeTime, titleCase } from '@/lib/format';
import type { ActivityEntry, StorageSummary, Transfer } from '@/lib/types';

const CATEGORY_COLORS: Record<string, string> = {
  images: '#35c8a9',
  videos: '#5b6ef5',
  documents: '#7c8cff',
  music: '#f0b866',
  apk: '#f46d7d',
  other: '#64748b',
};

const QUICK_ACTIONS = [
  { to: '/files', label: 'Relay a file', icon: UploadCloud, description: 'Chunked, resumable uploads' },
  { to: '/mirroring', label: 'Mirror a screen', icon: MonitorPlay, description: 'WebRTC with TURN fallback' },
  { to: '/transfers', label: 'Transfer queue', icon: Radio, description: 'Progress, pause, resume' },
  { to: '/notifications', label: 'Notifications', icon: BellRing, description: 'Consented sync only' },
];

export function DashboardPage() {
  const { user } = useAuth();
  const { devices, loading, error, refresh, lastSyncedAt } = useDevices();
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [auxError, setAuxError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [fileData, transferData, activityData] = await Promise.all([
          filesApi.list(),
          transfersApi.list(),
          activityApi.list(),
        ]);
        if (cancelled) return;
        setStorage(fileData.storage);
        setTransfers(transferData);
        setActivity(activityData);
        setAuxError(null);
      } catch (err) {
        if (!cancelled) setAuxError(err instanceof Error ? err.message : 'Unable to load dashboard data');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastSyncedAt]);

  const online = devices.filter((device) => device.online).length;
  const activeTransfers = transfers.filter((transfer) => ['pending', 'active', 'paused'].includes(transfer.status));
  const completedTransfers = transfers.filter((transfer) => transfer.status === 'completed').length;

  const pieData = useMemo(() => {
    if (!storage) return [];
    return Object.entries(storage.byCategory)
      .map(([category, count]) => ({ name: titleCase(category), value: count, color: CATEGORY_COLORS[category] ?? '#64748b' }))
      .sort((a, b) => b.value - a.value);
  }, [storage]);

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${greeting}, ${user?.displayName ?? 'owner'}`}
        title="Your private device mesh"
        subtitle="Live presence, relay storage and session health for every Android device enrolled under this account."
        actions={
          <>
            <Link to="/devices" className="btn-ghost">
              <Smartphone className="h-4 w-4" /> Devices
            </Link>
            <Link to="/files" className="btn-primary">
              <UploadCloud className="h-4 w-4" /> Upload file
            </Link>
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      {auxError ? <ErrorBanner message={auxError} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Online devices"
          value={
            <span>
              {online}
              <span className="text-base font-normal text-slate-500">/{devices.length}</span>
            </span>
          }
          hint={devices.length ? `${devices.length - online} offline · presence verified by authenticated socket` : 'No devices enrolled yet'}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Relay storage"
          value={formatBytes(storage?.totalBytes ?? 0)}
          hint={`${storage?.fileCount ?? 0} file(s) available for download`}
          icon={<HardDrive className="h-4 w-4" />}
          tone="accent"
        />
        <StatCard
          label="Active transfers"
          value={activeTransfers.length}
          hint={activeTransfers.length ? 'Session-level progress is live below' : 'Queue is idle'}
          icon={<Radio className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard
          label="Completed transfers"
          value={completedTransfers}
          hint={transfers.length ? `${transfers.length} total transfer session(s)` : 'Chunked and checksum-verified'}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Devices</h2>
            <Link to="/devices" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-200">
              Manage all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : devices.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="h-6 w-6" />}
              title="No devices enrolled yet"
              description="Enroll your first Android device from the Devices page. Enrollment requires your owner credentials — QR pairing is optional and never mandatory."
              action={
                <Link to="/devices" className="btn-primary">
                  Enroll a device <ArrowRight className="h-4 w-4" />
                </Link>
              }
            />
          ) : (
            <motion.div layout className="grid gap-4 md:grid-cols-2">
              {devices.slice(0, 4).map((device) => (
                <DeviceCard key={device.id} device={device} />
              ))}
            </motion.div>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="glass glass-hover group flex items-center gap-3 p-4"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300 transition group-hover:border-brand-400/30">
                  <action.icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">{action.label}</span>
                  <span className="block truncate text-[11px] text-slate-400">{action.description}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-slate-500 transition group-hover:text-brand-300" />
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <GlassCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Relay storage</h2>
              <span className="chip">{storage?.fileCount ?? 0} files</span>
            </div>
            {pieData.length === 0 ? (
              <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
                <FolderOpen className="h-6 w-6 text-slate-600" />
                <p className="text-xs text-slate-400">No relayed files yet</p>
                <Link to="/files" className="text-xs font-semibold text-brand-300">
                  Upload the first file
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="h-[180px] w-[150px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={3} stroke="none">
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(8,11,20,0.95)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 12,
                          fontSize: 12,
                          color: '#e2e8f0',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 flex-1 space-y-2 text-xs">
                  {pieData.slice(0, 5).map((entry) => (
                    <li key={entry.name} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-slate-300">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color }} />
                        <span className="truncate">{entry.name}</span>
                      </span>
                      <span className="font-semibold text-slate-200">{entry.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Total relayed</span>
                <span>{formatBytes(storage?.totalBytes ?? 0)}</span>
              </div>
              <ProgressBar className="mt-2" value={Math.min(100, ((storage?.totalBytes ?? 0) / (1024 * 1024 * 1024)) * 100)} />
              <p className="mt-1.5 text-[10px] text-slate-500">Scale reference: 1 GB relay budget per view</p>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Recent activity</h2>
              <Link to="/activity" className="text-xs font-semibold text-brand-300 hover:text-brand-200">
                All
              </Link>
            </div>
            {activity.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">Audit trail will appear here.</p>
            ) : (
              <ul className="space-y-3">
                {activity.slice(0, 6).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3">
                    <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', entry.actorType === 'device' ? 'bg-accent-400' : 'bg-brand-400')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-200">{humanAction(entry.action)}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {entry.deviceName ?? entry.actorType} · {relativeTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </section>
      </div>

      <GlassCard>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Transfer history</h2>
          <Link to="/transfers" className="text-xs font-semibold text-brand-300 hover:text-brand-200">
            Open queue
          </Link>
        </div>
        {transfers.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No transfers yet — upload a file to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="pb-2 font-semibold">Session</th>
                  <th className="pb-2 font-semibold">Direction</th>
                  <th className="pb-2 font-semibold">Progress</th>
                  <th className="pb-2 font-semibold">Status</th>
                  <th className="pb-2 text-right font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {transfers.slice(0, 5).map((transfer) => (
                  <tr key={transfer.id} className="table-row">
                    <td className="py-2.5 font-mono text-[11px] text-slate-400">{transfer.id.slice(0, 8)}</td>
                    <td className="py-2.5 text-slate-300">{titleCase(transfer.direction)}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={transfer.percent} className="w-24" />
                        <span className="text-[11px] text-slate-400">{transfer.percent}%</span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <span className="chip">{transfer.status}</span>
                    </td>
                    <td className="py-2.5 text-right text-slate-500">{relativeTime(transfer.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
