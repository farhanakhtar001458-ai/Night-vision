import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { realtime, type RealtimeStatus } from '@/services/realtime';
import { sessionStore } from '@/services/api';
import type { RealtimeEvent } from '@/lib/types';
import { useAuth } from './AuthContext';

type RealtimeContextValue = {
  status: RealtimeStatus;
  detail?: string;
  subscribe: (type: string, handler: (event: RealtimeEvent) => void) => () => void;
  send: (event: Record<string, unknown>) => boolean;
  lastEventAt: number | null;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>(realtime.status);
  const [detail, setDetail] = useState<string | undefined>();
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    if (!accessToken) {
      realtime.disconnect();
      return;
    }
    realtime.connect(() => sessionStore.current?.tokens.accessToken ?? null);
    const offStatus = realtime.onStatus((next, nextDetail) => {
      setStatus(next);
      setDetail(nextDetail);
    });
    const offAny = realtime.on('*', () => setLastEventAt(Date.now()));
    return () => {
      offStatus();
      offAny();
      realtime.disconnect();
    };
  }, [accessToken]);

  const subscribe = useCallback((type: string, handler: (event: RealtimeEvent) => void) => realtime.on(type, handler), []);
  const send = useCallback((event: Record<string, unknown>) => realtime.send(event), []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, detail, subscribe, send, lastEventAt }),
    [status, detail, subscribe, send, lastEventAt],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used inside RealtimeProvider');
  return context;
}
