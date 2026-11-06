import { KeyRound, Lock, LogOut, RefreshCw, ShieldCheck, Smartphone, Wifi } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { authApi, securityApi } from '@/services/api';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { EmptyState, ErrorBanner, GlassCard, Modal, PageHeader, Skeleton, Spinner } from '@/components/ui';
import { formatDateTime, relativeTime, titleCase } from '@/lib/format';
import type { BrowserSession, DeviceSession, ServerConfig } from '@/lib/types';

export function SecurityPage() {
  const { logout } = useAuth();
  const { push } = useToast();
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [health, setHealth] = useState<{ database: string; liveSockets: number; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sessionData, healthData] = await Promise.all([securityApi.sessions(), securityApi.health()]);
      setSessions(sessionData.sessions);
      setBrowserSessions(sessionData.browserSessions);
      setConfig(healthData.webrtc);
      setHealth({ database: healthData.database, liveSockets: healthData.liveSockets, status: healthData.status });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load security data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setChanging(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      push({ kind: 'success', title: 'Password updated', description: 'All refresh tokens were revoked. Sign in again on other browsers.' });
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      await load();
    } catch (err) {
      push({ kind: 'error', title: 'Password change failed', description: err instanceof Error ? err.message : '' });
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sessions · credentials · relay"
        title="Security"
        subtitle="Every device session is an independently revocable record. Revoking one closes its WebSocket and invalidates its token on the next request."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPasswordOpen(true)}>
              <Lock className="h-4 w-4" /> Change password
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                try {
                  await securityApi.revokeAll();
                  push({ kind: 'success', title: 'All sessions revoked' });
                  await logout();
                } catch (err) {
                  push({ kind: 'error', title: 'Could not revoke sessions', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              <LogOut className="h-4 w-4" /> Revoke everything
            </button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="label">Backend</p>
            <p className="text-sm font-semibold text-white">{health?.status ?? '—'}</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-accent-400">
            <Wifi className="h-4 w-4" />
          </span>
          <div>
            <p className="label">Live sockets</p>
            <p className="text-sm font-semibold text-white">{health?.liveSockets ?? '—'}</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-amber-300">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <p className="label">TURN relay</p>
            <p className="text-sm font-semibold text-white">{config?.turnConfigured ? 'Configured' : 'Not configured'}</p>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-0">
        <div className="border-b border-white/[0.06] p-4">
          <h2 className="text-sm font-semibold text-slate-100">Device sessions</h2>
          <p className="mt-1 text-[11px] text-slate-500">Tokens are bound to these rows; revoking is immediate.</p>
        </div>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-14 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Smartphone className="h-6 w-6" />} title="No device sessions" description="Sessions appear when an enrolled device exchanges its credential for a token." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-semibold">Device</th>
                  <th className="px-4 py-3 font-semibold">State</th>
                  <th className="px-4 py-3 font-semibold">IP</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Heartbeat</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="table-row">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-100">{session.deviceName}</p>
                      <p className="font-mono text-[10px] text-slate-500">{session.id.slice(0, 8)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`chip ${session.state === 'active' ? 'border-brand-400/30 text-brand-200' : ''}`}>{session.state}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{session.ip ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-400">{relativeTime(session.startedAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{session.lastHeartbeatAt ? relativeTime(session.lastHeartbeatAt) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {session.state === 'active' ? (
                        <button
                          type="button"
                          className="focus-ring rounded-lg border border-rose-400/25 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/10"
                          onClick={async () => {
                            try {
                              await securityApi.revoke(session.id);
                              push({ kind: 'success', title: 'Session revoked' });
                              await load();
                            } catch (err) {
                              push({ kind: 'error', title: 'Revoke failed', description: err instanceof Error ? err.message : '' });
                            }
                          }}
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-600">{titleCase(session.endedReason ?? 'closed')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-0">
          <div className="border-b border-white/[0.06] p-4">
            <h2 className="text-sm font-semibold text-slate-100">Browser sessions</h2>
            <p className="mt-1 text-xs text-slate-500">
              Supabase Auth owns browser refresh tokens. Per-browser enumeration is not exposed to the
              client; &ldquo;Sign out everywhere&rdquo; revokes them globally.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Refresh tokens rotate on use; reuse of a rotated token revokes the whole family.</p>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {browserSessions.length === 0 ? (
              <li className="p-4 text-[11px] text-slate-500">No browser sessions recorded.</li>
            ) : (
              browserSessions.slice(0, 8).map((session) => (
                <li key={session.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-200">{session.userAgent ?? 'Unknown client'}</p>
                    <p className="text-[10px] text-slate-500">
                      {session.ip ?? '—'} · {formatDateTime(session.createdAt)}
                    </p>
                  </div>
                  <span className={`chip ${session.revokedAt ? '' : 'border-brand-400/25 text-brand-200'}`}>
                    {session.revokedAt ? 'revoked' : session.rotated ? 'rotated' : 'active'}
                  </span>
                </li>
              ))
            )}
          </ul>
        </GlassCard>

        <GlassCard>
          <h2 className="text-sm font-semibold text-slate-100">Relay &amp; transport</h2>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2">
              <dt className="text-slate-500">Database</dt>
              <dd className="font-medium text-slate-200">{health?.database ?? '—'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2">
              <dt className="text-slate-500">STUN servers</dt>
              <dd className="max-w-[60%] break-words text-right font-mono text-[10px] text-slate-300">{config?.stunUrls.join(', ') || '—'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.05] pb-2">
              <dt className="text-slate-500">TURN servers</dt>
              <dd className="max-w-[60%] break-words text-right font-mono text-[10px] text-slate-300">{config?.turnUrls.join(', ') || 'not configured'}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
            Transport is HTTPS/WSS only. TURN credentials are short-lived HMAC values derived from the coturn shared secret,
            issued per authenticated owner — the shared secret never leaves the backend.
          </div>
        </GlassCard>
      </div>

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Change password"
        description="Changing the password revokes every refresh token for this account."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setPasswordOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="password-form" className="btn-primary" disabled={changing}>
              {changing ? <Spinner /> : null} Update password
            </button>
          </>
        }
      >
        <form id="password-form" onSubmit={submitPassword} className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Current password</span>
            <input type="password" className="input" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">New password</span>
            <input type="password" className="input" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            <span className="mt-1 block text-[10px] text-slate-500">At least 10 characters, including a number.</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
