import { motion } from 'framer-motion';
import { ArrowRight, KeyRound, Lock, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ApiError } from '@/services/api';
import { Spinner } from '@/components/ui';

export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex">
        <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-brand-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-accent-500/15 blur-[140px]" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500 shadow-glow">
              <span className="text-lg font-black text-ink-950">D</span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-white">DroidLink X</p>
              <p className="text-[11px] text-slate-400">Your devices. One connection. Anywhere.</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-white">
            Your own devices,
            <br />
            <span className="bg-gradient-to-r from-brand-300 to-accent-400 bg-clip-text text-transparent">
              reachable from anywhere.
            </span>
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-slate-400">
            Enroll each Android device once under your owner account. Every device keeps its own revocable credential,
            connects over authenticated WebSockets and negotiates encrypted WebRTC sessions through your own relay.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {[
              { icon: ShieldCheck, text: 'Owner-scoped enrollment with per-device credentials' },
              { icon: Smartphone, text: 'Global presence: Wi-Fi, mobile data, any network' },
              { icon: KeyRound, text: 'Short-lived tokens, refresh rotation, instant revocation' },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-300">
                  <item.icon className="h-4 w-4" />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-slate-500">
          Self-hosted control plane · PostgreSQL · Redis · WebSocket · WebRTC · TURN
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass w-full max-w-md p-7 sm:p-8"
        >
          <div className="mb-6 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500">
                <span className="font-black text-ink-950">D</span>
              </div>
              <p className="text-sm font-bold text-white">DroidLink X</p>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </motion.div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, user, ready } = useAuth();
  const { push } = useToast();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      push({ kind: 'success', title: 'Signed in', description: 'Your device mesh is syncing.' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to sign in. Check your connection.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your private device mesh.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input pl-10"
              placeholder="owner@example.com"
            />
          </div>
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Password</span>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input pl-10"
              placeholder="••••••••••"
            />
          </div>
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? <Spinner /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
          {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-400">
        New to DroidLink X?{' '}
        <Link to="/register" className="font-semibold text-brand-300 hover:text-brand-200">
          Create the owner account
        </Link>
      </p>
    </AuthShell>
  );
}
