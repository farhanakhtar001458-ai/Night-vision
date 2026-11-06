import { Check, Clipboard, Copy, Info, LogOut, Palette, Save, Server, User } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { authApi, clipboardApi, securityApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { GlassCard, PageHeader, Spinner, Toggle } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import type { ClipboardEntry, ServerConfig } from '@/lib/types';

const ACCENTS = [
  { id: 'emerald', label: 'Emerald', from: '#6fdfc5', to: '#0b8a75' },
  { id: 'indigo', label: 'Indigo', from: '#a5b4fc', to: '#4652e0' },
  { id: 'amber', label: 'Amber', from: '#fcd34d', to: '#b45309' },
  { id: 'rose', label: 'Rose', from: '#fda4af', to: '#be123c' },
] as const;

export function SettingsPage() {
  const { user, updateUser, logout } = useAuth();
  const { push } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [accent, setAccent] = useState(() => localStorage.getItem('droidlinkx.accent') ?? 'emerald');
  const [clipboardText, setClipboardText] = useState('');
  const [clipboardEntries, setClipboardEntries] = useState<ClipboardEntry[]>([]);
  const [forceSensitive, setForceSensitive] = useState(false);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [desktopNotifications, setDesktopNotifications] = useState(() => localStorage.getItem('droidlinkx.toasts') !== 'off');
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem('droidlinkx.reduceMotion') === 'on');

  useEffect(() => {
    const preset = ACCENTS.find((item) => item.id === accent) ?? ACCENTS[0];
    document.documentElement.style.setProperty('--accent-from', preset.from);
    document.documentElement.style.setProperty('--accent-to', preset.to);
    localStorage.setItem('droidlinkx.accent', accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    localStorage.setItem('droidlinkx.reduceMotion', reduceMotion ? 'on' : 'off');
  }, [reduceMotion]);

  useEffect(() => {
    localStorage.setItem('droidlinkx.toasts', desktopNotifications ? 'on' : 'off');
  }, [desktopNotifications]);

  useEffect(() => {
    void (async () => {
      try {
        const [entries, health] = await Promise.all([clipboardApi.list(), securityApi.health()]);
        setClipboardEntries(entries);
        setConfig(health.webrtc);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const updated = await authApi.updateProfile({ displayName });
      updateUser(updated);
      push({ kind: 'success', title: 'Profile updated' });
    } catch (err) {
      push({ kind: 'error', title: 'Could not save the profile', description: err instanceof Error ? err.message : '' });
    } finally {
      setSavingProfile(false);
    }
  };

  const syncClipboard = async (force = false) => {
    if (!clipboardText.trim()) return;
    try {
      await clipboardApi.sync(clipboardText, force);
      setClipboardText('');
      setForceSensitive(false);
      setClipboardEntries(await clipboardApi.list());
      push({ kind: 'success', title: 'Clipboard synced', description: 'Available to your enrolled devices.' });
    } catch (err) {
      push({
        kind: 'warning',
        title: 'Sync blocked',
        description: err instanceof Error ? err.message : 'The content looks sensitive. Confirm explicitly to override.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account · privacy · connection"
        title="Settings"
        subtitle="Preferences here are stored on this browser; account and device settings are authoritative on the backend."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold text-slate-100">Account</h2>
          </div>
          <form onSubmit={saveProfile} className="mt-4 space-y-3">
            <label className="block">
              <span className="label mb-1.5 block">Display name</span>
              <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} required />
            </label>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px]">
              <span className="text-slate-500">Email</span>
              <span className="font-medium text-slate-200">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px]">
              <span className="text-slate-500">Last sign-in</span>
              <span className="font-medium text-slate-200">{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</span>
            </div>
            <button type="submit" className="btn-primary" disabled={savingProfile}>
              {savingProfile ? <Spinner /> : <Save className="h-4 w-4" />} Save profile
            </button>
          </form>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-accent-400" />
            <h2 className="text-sm font-semibold text-slate-100">Appearance</h2>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Dark mode is the design baseline; accents apply immediately.</p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {ACCENTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setAccent(preset.id)}
                className={`focus-ring relative overflow-hidden rounded-xl border p-2 text-[10px] font-semibold transition ${
                  accent === preset.id ? 'border-white/30 text-white' : 'border-white/10 text-slate-400 hover:border-white/20'
                }`}
              >
                <span
                  className="mb-1.5 block h-6 w-full rounded-md"
                  style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                />
                {preset.label}
                {accent === preset.id ? <Check className="absolute right-1 top-1 h-3 w-3 text-white" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-4 divide-y divide-white/[0.05]">
            <Toggle
              label="Desktop notifications"
              description="Show in-app toasts for transfer and connection events."
              checked={desktopNotifications}
              onChange={setDesktopNotifications}
            />
            <Toggle
              label="Reduce motion"
              description="Minimise transitions and background animations."
              checked={reduceMotion}
              onChange={setReduceMotion}
            />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-2">
            <Clipboard className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold text-slate-100">Clipboard sync</h2>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Manual only. Content that looks like a password, OTP or card number is rejected unless you explicitly override.
          </p>
          <textarea
            className="input mt-3 min-h-[76px] resize-y"
            placeholder="Paste text to make it available on your devices…"
            value={clipboardText}
            onChange={(event) => setClipboardText(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <input type="checkbox" checked={forceSensitive} onChange={(event) => setForceSensitive(event.target.checked)} className="accent-brand-500" />
              Override sensitive-content filter
            </label>
            <button type="button" className="btn-primary" onClick={() => void syncClipboard(forceSensitive)} disabled={!clipboardText.trim()}>
              Sync
            </button>
          </div>
          <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto text-[11px]">
            {clipboardEntries.slice(0, 8).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-slate-300">{entry.content.slice(0, 60)}</span>
                  <button
                    type="button"
                    className="focus-ring rounded p-1 text-slate-500 hover:text-slate-200"
                    aria-label="Copy entry"
                    onClick={() => {
                      void navigator.clipboard.writeText(entry.content);
                      push({ kind: 'info', title: 'Copied to this browser clipboard' });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  {entry.sensitive ? 'sensitive · ' : ''}
                  {relativeTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard>
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-accent-400" />
              <h2 className="text-sm font-semibold text-slate-100">Server configuration</h2>
            </div>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
                <dt className="text-slate-500">API origin</dt>
                <dd className="font-mono text-slate-300">{window.location.origin}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
                <dt className="text-slate-500">WebSocket</dt>
                <dd className="font-mono text-slate-300">{`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
                <dt className="text-slate-500">STUN</dt>
                <dd className="max-w-[55%] break-words text-right font-mono text-slate-300">{config?.stunUrls.join(', ') ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">TURN</dt>
                <dd className="max-w-[55%] break-words text-right font-mono text-slate-300">{config?.turnUrls.join(', ') || 'not configured'}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[10px] leading-relaxed text-slate-500">
              Endpoint overrides are compiled into the deployment via VITE/proxy configuration rather than stored per
              browser, so a compromised dashboard session cannot redirect device traffic.
            </p>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-brand-300" />
              <h2 className="text-sm font-semibold text-slate-100">About</h2>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              DroidLink X dashboard · v1.0.0 · React 19, Vite, Tailwind, Framer Motion, Recharts. Backend Node 22 +
              Express 5 + PostgreSQL 16 + Redis + WebSocket + coturn.
            </p>
            <button type="button" className="btn-danger mt-4" onClick={() => void logout()}>
              <LogOut className="h-4 w-4" /> Sign out of this browser
            </button>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
