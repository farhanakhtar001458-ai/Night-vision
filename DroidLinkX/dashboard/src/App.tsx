import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { RealtimeProvider } from '@/context/RealtimeContext';
import { DevicesProvider } from '@/hooks/useDevices';
import { ToastProvider } from '@/context/ToastContext';
import { LoginPage } from '@/pages/Login';
import { RegisterPage } from '@/pages/Register';
import { DashboardPage } from '@/pages/Dashboard';
import { DevicesPage } from '@/pages/Devices';
import { FilesPage } from '@/pages/Files';
import { TransfersPage } from '@/pages/Transfers';
import { MirroringPage } from '@/pages/Mirroring';
import { NotificationsPage } from '@/pages/Notifications';
import { DeviceInfoPage } from '@/pages/DeviceInfo';
import { SecurityPage } from '@/pages/Security';
import { SettingsPage } from '@/pages/Settings';
import { ActivityPage } from '@/pages/Activity';
import { Loader2 } from 'lucide-react';

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-300 via-brand-500 to-accent-500 shadow-glow">
          <span className="text-xl font-black text-ink-950">D</span>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-brand-300" />
        <p className="text-xs text-slate-500">Restoring your authenticated session…</p>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function ShellProviders({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <DevicesProvider>{children}</DevicesProvider>
    </RealtimeProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <Protected>
                <ShellProviders>
                  <AppLayout />
                </ShellProviders>
              </Protected>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/transfers" element={<TransfersPage />} />
            <Route path="/mirroring" element={<MirroringPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/device-info" element={<DeviceInfoPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
