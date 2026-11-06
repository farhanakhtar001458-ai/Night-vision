import { Menu, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './Sidebar';
import { useRealtime } from '@/context/RealtimeContext';
import { useDevices } from '@/hooks/useDevices';
import { cn, relativeTime } from '@/lib/format';
import { Spinner } from './ui';

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation();
  const { status } = useRealtime();
  const { refresh, loading, devices, lastSyncedAt } = useDevices();
  const current = NAV_ITEMS.find((item) => location.pathname.startsWith(item.to));
  const online = devices.filter((device) => device.online).length;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          className="focus-ring rounded-xl border border-white/10 p-2 text-slate-300 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">DroidLink X</p>
          <h2 className="truncate text-sm font-semibold text-slate-100">{current?.label ?? 'Dashboard'}</h2>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <span className="chip">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            {online} online · {devices.length} enrolled
          </span>
          <span
            className={cn(
              'chip',
              status === 'online' ? 'border-brand-400/30 text-brand-200' : 'border-amber-400/30 text-amber-200',
            )}
          >
            {status === 'online' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {status}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          className="focus-ring rounded-xl border border-white/10 p-2 text-slate-300 transition hover:bg-white/5"
          aria-label="Refresh data"
          title={lastSyncedAt ? `Synced ${relativeTime(lastSyncedAt)}` : 'Refresh'}
        >
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
