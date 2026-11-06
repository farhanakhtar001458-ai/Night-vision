import { Activity as ActivityIcon, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activityApi } from '@/services/api';
import { EmptyState, ErrorBanner, GlassCard, PageHeader, Skeleton } from '@/components/ui';
import { cn, formatDateTime, humanAction, relativeTime } from '@/lib/format';
import type { ActivityEntry } from '@/lib/types';

const FILTERS = [
  { key: '', label: 'Everything' },
  { key: 'auth', label: 'Authentication' },
  { key: 'device', label: 'Devices' },
  { key: 'transfer', label: 'Transfers' },
  { key: 'connection', label: 'Connections' },
  { key: 'file', label: 'Files' },
];

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries(await activityApi.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the audit trail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = filter ? entries.filter((entry) => entry.action.startsWith(filter)) : entries;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Append-only audit trail"
        title="Activity history"
        subtitle="Sign-ins, enrollment, capability changes, transfers and connection events are recorded with actor, device and source address."
        actions={
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              'focus-ring rounded-full border px-3 py-1 text-[11px] font-semibold transition',
              filter === item.key ? 'border-brand-400/40 bg-brand-500/15 text-brand-200' : 'border-white/10 text-slate-400 hover:bg-white/5',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <GlassCard className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<ActivityIcon className="h-6 w-6" />} title="No activity yet" description="Audit entries appear as soon as you enroll a device or start a session." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {filtered.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    entry.actorType === 'device' ? 'bg-accent-400' : entry.actorType === 'system' ? 'bg-amber-400' : 'bg-brand-400',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-100">{humanAction(entry.action)}</p>
                    <span className="text-[10px] text-slate-500" title={formatDateTime(entry.createdAt)}>
                      {relativeTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {entry.actorType}
                    {entry.deviceName ? ` · ${entry.deviceName}` : ''}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                    {entry.targetId ? ` · ${entry.targetId.slice(0, 8)}` : ''}
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
