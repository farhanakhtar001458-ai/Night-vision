import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { devicesApi } from '@/services/api';
import { useRealtime } from '@/context/RealtimeContext';
import { useAuth } from '@/context/AuthContext';
import type { Device, DeviceTelemetry } from '@/lib/types';

type DevicesContextValue = {
  devices: Device[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  refresh: (silent?: boolean) => Promise<void>;
  applyTelemetry: (deviceId: string, patch: DeviceTelemetry) => void;
  rename: (deviceId: string, name: string) => Promise<void>;
  setTrusted: (deviceId: string, trusted: boolean) => Promise<void>;
  revoke: (deviceId: string) => Promise<void>;
  setPermission: (deviceId: string, permission: string, granted: boolean) => Promise<void>;
};

const DevicesContext = createContext<DevicesContextValue | null>(null);

export function DevicesProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth();
  const { subscribe } = useRealtime();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (!accessToken) return;
      if (!silent) setLoading(true);
      try {
        const list = await devicesApi.list();
        if (!mounted.current) return;
        setDevices(list);
        setError(null);
        setLastSyncedAt(Date.now());
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : 'Unable to load devices');
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (accessToken) void refresh();
    else {
      setDevices([]);
      setLoading(false);
    }
  }, [accessToken, refresh]);

  useEffect(() => {
    if (!accessToken) return;
    const patch = (deviceId: string, updater: (device: Device) => Device) => {
      setDevices((current) => current.map((device) => (device.id === deviceId ? updater(device) : device)));
    };

    const offOnline = subscribe('device:online', (event) => {
      const deviceId = String(event.deviceId ?? '');
      if (!deviceId) return;
      patch(deviceId, (device) => ({ ...device, online: true, connectionQuality: device.connectionQuality === 'offline' ? 'good' : device.connectionQuality }));
      // A heartbeat carries richer state than the online edge; fetch to stay authoritative.
      void refresh(true);
    });

    const offOffline = subscribe('device:offline', (event) => {
      const deviceId = String(event.deviceId ?? '');
      if (!deviceId) return;
      patch(deviceId, (device) => ({ ...device, online: false, connectionQuality: 'offline', lastSeenAt: new Date().toISOString() }));
    });

    const offHeartbeat = subscribe('device:heartbeat', (event) => {
      const deviceId = String(event.deviceId ?? '');
      if (!deviceId) return;
      patch(deviceId, (device) => {
        const telemetry: DeviceTelemetry = { ...device.telemetry };
        if (typeof event.battery === 'number') telemetry.battery = event.battery;
        if (typeof event.charging === 'boolean') telemetry.charging = event.charging;
        if (typeof event.network === 'string') telemetry.network = event.network;
        return {
          ...device,
          online: true,
          lastSeenAt: new Date().toISOString(),
          telemetry,
          connectionQuality: device.connectionQuality === 'offline' ? 'good' : device.connectionQuality,
        };
      });
    });

    const offPresence = subscribe('presence:sync', (event) => {
      const snapshot = (event.devices ?? []) as Array<{ deviceId: string; online: boolean }>;
      setDevices((current) =>
        current.map((device) => {
          const match = snapshot.find((entry) => entry.deviceId === device.id);
          if (!match) return device;
          return { ...device, online: match.online, connectionQuality: match.online ? device.connectionQuality : 'offline' };
        }),
      );
    });

    return () => {
      offOnline();
      offOffline();
      offHeartbeat();
      offPresence();
    };
  }, [accessToken, subscribe, refresh]);

  const applyTelemetry = useCallback((deviceId: string, patch: DeviceTelemetry) => {
    setDevices((current) =>
      current.map((device) =>
        device.id === deviceId ? { ...device, telemetry: { ...device.telemetry, ...patch } } : device,
      ),
    );
  }, []);

  const rename = useCallback(async (deviceId: string, name: string) => {
    const updated = await devicesApi.rename(deviceId, name);
    setDevices((current) => current.map((device) => (device.id === deviceId ? updated : device)));
  }, []);

  const setTrusted = useCallback(async (deviceId: string, trusted: boolean) => {
    const updated = await devicesApi.setTrusted(deviceId, trusted);
    setDevices((current) => current.map((device) => (device.id === deviceId ? updated : device)));
  }, []);

  const revoke = useCallback(async (deviceId: string) => {
    await devicesApi.revoke(deviceId);
    setDevices((current) => current.filter((device) => device.id !== deviceId));
  }, []);

  const setPermission = useCallback(async (deviceId: string, permission: string, granted: boolean) => {
    const permissions = await devicesApi.setPermission(deviceId, permission, granted);
    setDevices((current) =>
      current.map((device) => (device.id === deviceId ? { ...device, permissions } : device)),
    );
  }, []);

  const value = useMemo<DevicesContextValue>(
    () => ({ devices, loading, error, lastSyncedAt, refresh, applyTelemetry, rename, setTrusted, revoke, setPermission }),
    [devices, loading, error, lastSyncedAt, refresh, applyTelemetry, rename, setTrusted, revoke, setPermission],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevices(): DevicesContextValue {
  const context = useContext(DevicesContext);
  if (!context) throw new Error('useDevices must be used inside DevicesProvider');
  return context;
}
