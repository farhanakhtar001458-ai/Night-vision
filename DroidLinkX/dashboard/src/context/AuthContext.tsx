import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, sessionStore, type StoredSession } from '@/services/api';
import type { PublicUser } from '@/lib/types';

type AuthContextValue = {
  user: PublicUser | null;
  accessToken: string | null;
  ready: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: PublicUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(sessionStore.current);
  const [ready, setReady] = useState(false);

  useEffect(() => sessionStore.subscribe(setSession), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (sessionStore.current) {
        const restored = await authApi.restore();
        if (!cancelled) {
          if (restored) sessionStore.set(restored);
          else sessionStore.set(null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: { email: string; password: string }) => {
    const next = await authApi.login(input);
    sessionStore.set(next);
  }, []);

  const register = useCallback(async (input: { email: string; password: string; displayName: string }) => {
    const next = await authApi.register(input);
    sessionStore.set(next);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    sessionStore.set(null);
  }, []);

  const updateUser = useCallback((user: PublicUser) => {
    const current = sessionStore.current;
    if (current) sessionStore.set({ ...current, user });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.tokens.accessToken ?? null,
      ready,
      login,
      register,
      logout,
      updateUser,
    }),
    [session, ready, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
