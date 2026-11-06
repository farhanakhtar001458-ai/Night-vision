import { ArrowRight, Lock, Mail, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ApiError } from '@/services/api';
import { Spinner } from '@/components/ui';
import { AuthShell } from './Login';

function strength(password: string): { score: number; label: string; tone: string } {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'][Math.min(score, 5)] ?? 'Weak';
  const tone = score >= 4 ? 'bg-brand-400' : score >= 3 ? 'bg-amber-400' : 'bg-rose-400';
  return { score, label, tone };
}

export function RegisterPage() {
  const { register, user, ready } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && user) return <Navigate to="/dashboard" replace />;

  const meter = strength(password);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await register({ email, password, displayName });
      push({ kind: 'success', title: 'Owner account created', description: 'Enroll your first Android device to begin.' });
      navigate('/devices', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const details = Array.isArray(err.details)
          ? (err.details as Array<{ path: string; message: string }>).map((d) => d.message).join(' ')
          : '';
        setError(details || err.message);
      } else {
        setError('Unable to create the account. Check your connection.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Create the owner account" subtitle="One owner, all of your personal Android devices.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <label className="block">
          <span className="label mb-1.5 block">Display name</span>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              required
              minLength={2}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="input pl-10"
              placeholder="Farhan"
              autoComplete="name"
            />
          </div>
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Email</span>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input pl-10"
              placeholder="owner@example.com"
              autoComplete="email"
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
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input pl-10"
              placeholder="At least 10 characters with a number"
              autoComplete="new-password"
            />
          </div>
          {password ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1">
                {[0, 1, 2, 3, 4].map((index) => (
                  <span
                    key={index}
                    className={`h-full flex-1 rounded-full ${index < meter.score ? meter.tone : 'bg-white/10'}`}
                  />
                ))}
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">{meter.label}</span>
            </div>
          ) : null}
        </label>
        <label className="block">
          <span className="label mb-1.5 block">Confirm password</span>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="input pl-10"
              placeholder="Repeat the password"
              autoComplete="new-password"
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
          {submitting ? 'Creating account…' : 'Create account'}
          {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-400">
        Already enrolled?{' '}
        <Link to="/login" className="font-semibold text-brand-300 hover:text-brand-200">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
