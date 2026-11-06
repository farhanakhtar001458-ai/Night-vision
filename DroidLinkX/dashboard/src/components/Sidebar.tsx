import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Bell,
  ChevronRight,
  Cpu,
  FolderOpen,
  History,
  LayoutDashboard,
  LogOut,
  MonitorPlay,
  Radio,
  Settings,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useDevices } from '@/hooks/useDevices';
import { useRealtime } from '@/context/RealtimeContext';

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { to: '/devices', label: 'Devices', icon: Smartphone, group: 'Overview' },
  { to: '/files', label: 'File Manager', icon: FolderOpen, group: 'Control' },
  { to: '/transfers', label: 'Transfers', icon: Activity, group: 'Control' },
  { to: '/mirroring', label: 'Screen Mirroring', icon: MonitorPlay, group: 'Control' },
  { to: '/notifications', label: 'Notifications', icon: Bell, group: 'Control' },
  { to: '/device-info', label: 'Device Information', icon: Cpu, group: 'Control' },
  { to: '/security', label: 'Security', icon: ShieldCheck, group: 'Account' },
  { to: '/activity', label: 'Activity History', icon: History, group: 'Account' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'Account' },
] as const;

function RealtimeBadge() {
  const { status } = useRealtime();
  const tone =
    status === 'online'
      ? 'text-brand-300 border-brand-400/30 bg-brand-500/10'
      : status === 'reconnecting' || status === 'connecting'
        ? 'text-amber-300 border-amber-400/30 bg-amber-500/10'
        : 'text-slate-400 border-white/10 bg-white/5';
  const label = status === 'online' ? 'Mesh connected' : status === 'reconnecting' ? 'Reconnecting…' : status === 'connecting' ? 'Connecting…' : 'Mesh offline';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', tone)}>
      <Radio className="h-3 w-3" />
      {label}
    </span>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const { devices } = useDevices();
  const navigate = useNavigate();
  const online = devices.filter((device) => device.online).length;
  const groups = ['Overview', 'Control', 'Account'] as const;

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <div className="flex items-center gap-3">
        <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-300/90 via-brand-500/80 to-accent-500/80 shadow-glow">
          <span className="text-lg font-black text-ink-950">D</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-tight text-white">DroidLink X</p>
          <p className="truncate text-[11px] text-slate-400">Private device mesh</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto no-scrollbar">
        {groups.map((group) => (
          <div key={group}>
            <p className="label mb-2 px-2">{group}</p>
            <ul className="space-y-1">
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                        isActive ? 'text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <motion.span
                            layoutId="nav-active"
                            className="absolute inset-0 rounded-xl border border-brand-400/25 bg-gradient-to-r from-brand-500/15 to-transparent"
                            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                          />
                        ) : null}
                        <item.icon className={cn('relative h-[18px] w-[18px]', isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')} />
                        <span className="relative flex-1 truncate">{item.label}</span>
                        {item.to === '/devices' ? (
                          <span className="relative rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">{devices.length}</span>
                        ) : null}
                        {isActive ? <ChevronRight className="relative h-3.5 w-3.5 text-brand-300" /> : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="glass space-y-3 border-white/[0.06] p-4">
        <div className="flex items-center justify-between">
          <p className="label">Mesh status</p>
          <RealtimeBadge />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-semibold text-white">
              {online}
              <span className="text-base font-normal text-slate-500">/{devices.length}</span>
            </p>
            <p className="text-[11px] text-slate-400">devices online</p>
          </div>
          <button
            type="button"
            onClick={() => {
              navigate('/devices');
              onNavigate?.();
            }}
            className="focus-ring rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10"
          >
            Manage
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-400 to-brand-500 text-xs font-bold text-ink-950">
          {(user?.displayName ?? 'D').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-100">{user?.displayName ?? 'Owner'}</p>
          <p className="truncate text-[11px] text-slate-500">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="focus-ring rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-rose-300"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="relative h-full w-[290px] border-r border-white/[0.07] bg-ink-900/95 backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={onClose}
              className="focus-ring absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent onNavigate={onClose} />
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
