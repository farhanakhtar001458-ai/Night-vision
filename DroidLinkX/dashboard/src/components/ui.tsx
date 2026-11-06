import { motion } from 'framer-motion';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/format';

export function GlassCard({
  children,
  className,
  as: Tag = 'div',
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  hover?: boolean;
}) {
  return <Tag className={cn('glass card-pad', hover && 'glass-hover', className)}>{children}</Tag>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="label mb-2 text-brand-300/80">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const QUALITY_TONE: Record<string, string> = {
  excellent: 'text-brand-300 border-brand-400/30 bg-brand-500/10',
  good: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  fair: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
  poor: 'text-orange-300 border-orange-400/30 bg-orange-500/10',
  offline: 'text-slate-400 border-white/10 bg-white/5',
  unknown: 'text-slate-400 border-white/10 bg-white/5',
};

export function StatusPill({ online, quality }: { online: boolean; quality?: string }) {
  const tone = online ? QUALITY_TONE[quality ?? 'good'] ?? QUALITY_TONE.good : QUALITY_TONE.offline;
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide', tone)}>
      <span className={cn('relative flex h-2 w-2')}>
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-70', online ? 'animate-ping bg-current' : 'bg-current')} />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      {online ? quality ?? 'online' : 'offline'}
    </span>
  );
}

export function BatteryIndicator({ level, charging }: { level?: number; charging?: boolean }) {
  const value = typeof level === 'number' ? Math.round(level) : null;
  const tone = value === null ? 'bg-slate-600' : value > 50 ? 'bg-brand-400' : value > 20 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-4 w-8 rounded-[5px] border border-white/25 p-[2px]">
        <div className={cn('h-full rounded-[2px] transition-all', tone)} style={{ width: `${value ?? 0}%` }} />
        <div className="absolute -right-[3px] top-1/2 h-1.5 w-[2px] -translate-y-1/2 rounded-r bg-white/25" />
      </div>
      <span className="text-xs font-medium text-slate-300">
        {value === null ? '—' : `${value}%`}
        {charging ? ' ⚡' : ''}
      </span>
    </div>
  );
}

export function ProgressBar({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'accent' | 'amber' }) {
  const tones = {
    brand: 'from-brand-400 to-brand-600',
    accent: 'from-accent-400 to-accent-600',
    amber: 'from-amber-300 to-amber-500',
  } as const;
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <motion.div
        className={cn('h-full rounded-full bg-gradient-to-r', tones[tone])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'brand' | 'accent' | 'amber' | 'rose';
}) {
  const tones = {
    brand: 'from-brand-400/20 to-transparent text-brand-300',
    accent: 'from-accent-400/20 to-transparent text-accent-400',
    amber: 'from-amber-400/20 to-transparent text-amber-300',
    rose: 'from-rose-400/20 to-transparent text-rose-300',
  } as const;
  return (
    <div className="glass glass-hover relative overflow-hidden p-5">
      <div className={cn('pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br blur-2xl', tones[tone])} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
        </div>
        {icon ? <div className={cn('rounded-xl border border-white/10 bg-white/5 p-2', tones[tone].split(' ').pop())}>{icon}</div> : null}
      </div>
      {hint ? <div className="mt-3 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-100">{label}</p>
        {description ? <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-ring relative h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-brand-400/50 bg-brand-500/80' : 'border-white/15 bg-white/10',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      {icon ? <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-brand-300">{icon}</div> : null}
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-relaxed text-slate-400">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function CardSkeleton() {
  return (
    <div className="glass space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 text-rose-200">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1 text-sm">{message}</div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="focus-ring rounded-lg border border-rose-300/30 px-3 py-1 text-xs font-semibold">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className={cn('glass relative w-full overflow-hidden border-white/10 p-6', wide ? 'max-w-3xl' : 'max-w-md')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="focus-ring rounded-lg p-1.5 text-slate-400 hover:text-white" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children ? <div className="mt-5">{children}</div> : null}
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </motion.div>
    </div>
  );
}
