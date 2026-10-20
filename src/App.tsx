import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isNative } from './lib/platform';
import { useApplyPrefs } from './lib/prefs';
import { ThemeProvider } from './lib/theme';
import { ConfirmProvider, ToastProvider } from './components/ui';
import DeviceGate from './components/DeviceGate';
import { ForgotPassword, ResetPassword, SignIn, SignUp } from './pages/Auth';
import Library from './pages/Library';
import { DataDeletion, Privacy } from './pages/Legal';
import { AppShellSkeleton } from './components/Skeletons';

// Everything past the library loads on demand; the chunks are warmed up in the background after sign-in.
const pages = {
  detail: () => import('./pages/FileDetail'),
  checkout: () => import('./pages/Checkout'),
  myFiles: () => import('./pages/MyFiles'),
  receipt: () => import('./pages/Receipt'),
  devices: () => import('./pages/Devices'),
  account: () => import('./pages/Account'),
  saved: () => import('./pages/SavedOffline'),
};
const FileDetail = lazy(pages.detail);
const Checkout = lazy(pages.checkout);
const MyFiles = lazy(pages.myFiles);
const ReceiptPage = lazy(pages.receipt);
const Devices = lazy(pages.devices);
const Account = lazy(pages.account);
const SavedOffline = lazy(pages.saved);
let prefetched = false;
function prefetchPages() {
  if (prefetched) return;
  prefetched = true;
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  idle(() => Object.values(pages).forEach((load) => load().catch(() => undefined)));
}

const Reader = lazy(() => import('./pages/Reader'));
const Dashboard = lazy(() => import('./admin/Dashboard'));
const AdminFiles = lazy(() => import('./admin/Files'));
const Payments = lazy(() => import('./admin/Payments'));
const AdminUsers = lazy(() => import('./admin/Users').then((m) => ({ default: m.AdminUsers })));
const AdminUserDetail = lazy(() => import('./admin/Users').then((m) => ({ default: m.AdminUserDetail })));
const AdminRestrictions = lazy(() => import('./admin/Restrictions').then((m) => ({ default: m.AdminRestrictions })));
const AdminSettings = lazy(() => import('./admin/Restrictions').then((m) => ({ default: m.AdminSettings })));
const AdminReceipts = lazy(() => import('./admin/Receipts'));
const AdminAppearance = lazy(() => import('./admin/Appearance'));
const AdminLogs = lazy(() => import('./admin/Logs'));
const AdminStatistics = lazy(() => import('./admin/Statistics'));

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { loading, session, profile, online } = useAuth();
  useEffect(() => { if (session) prefetchPages(); }, [session]);
  const loc = useLocation();
  if (loading) return <AppShellSkeleton />;
  if (!session) return <Navigate to="/sign-in" replace state={{ from: loc.pathname }} />;
  // In the app without internet, only saved files are available.
  if (isNative && !online && !/^\/(saved|read)/.test(loc.pathname)) return <Navigate to="/saved" replace />;
  if (admin && profile?.role !== 'admin') return <Navigate to="/library" replace />;
  return <>{children}<DeviceGate /></>;
}

/** After sign-in: admins land on the dashboard (web), everyone else on the library. */
function Home() {
  const { profile } = useAuth();
  const start = profile?.prefs?.startPage === 'my-files' ? '/my-files' : '/library';
  return <Navigate to={profile?.role === 'admin' && !isNative ? '/admin' : start} replace />;
}

function ApplyPrefs() { useApplyPrefs(); return null; }

function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  if (loading) return <div className="auth" aria-busy="true" />;
  if (session) return <Navigate to={profile?.role === 'admin' && !isNative ? '/admin' : '/library'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
      <AuthProvider>
        <ApplyPrefs />
        <ToastProvider><ConfirmProvider>
          <Suspense fallback={<AppShellSkeleton />}>
            <Routes>
              <Route path="/sign-in" element={<PublicOnly><SignIn /></PublicOnly>} />
              <Route path="/sign-up" element={<PublicOnly><SignUp /></PublicOnly>} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/data-deletion" element={<DataDeletion />} />

              <Route path="/library" element={<RequireAuth><Library /></RequireAuth>} />
              <Route path="/file/:id" element={<RequireAuth><FileDetail /></RequireAuth>} />
              <Route path="/checkout/:id" element={<RequireAuth><Checkout /></RequireAuth>} />
              <Route path="/checkout/slot/:slotKind" element={<RequireAuth><Checkout /></RequireAuth>} />
              <Route path="/my-files" element={<RequireAuth><MyFiles /></RequireAuth>} />
              <Route path="/receipt/:id" element={<RequireAuth><ReceiptPage /></RequireAuth>} />
              <Route path="/receipt/slot/:id" element={<RequireAuth><ReceiptPage /></RequireAuth>} />
              <Route path="/read/:id" element={<RequireAuth><Reader /></RequireAuth>} />
              <Route path="/devices" element={<RequireAuth><Devices /></RequireAuth>} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              <Route path="/saved" element={<RequireAuth><SavedOffline /></RequireAuth>} />

              <Route path="/admin" element={<RequireAuth admin><Dashboard /></RequireAuth>} />
              <Route path="/admin/files" element={<RequireAuth admin><AdminFiles /></RequireAuth>} />
              <Route path="/admin/payments" element={<RequireAuth admin><Payments /></RequireAuth>} />
              <Route path="/admin/users" element={<RequireAuth admin><AdminUsers /></RequireAuth>} />
              <Route path="/admin/users/:id" element={<RequireAuth admin><AdminUserDetail /></RequireAuth>} />
              <Route path="/admin/restrictions" element={<RequireAuth admin><AdminRestrictions /></RequireAuth>} />
              <Route path="/admin/settings" element={<RequireAuth admin><AdminSettings /></RequireAuth>} />
              <Route path="/admin/receipts" element={<RequireAuth admin><AdminReceipts /></RequireAuth>} />
              <Route path="/admin/appearance" element={<RequireAuth admin><AdminAppearance /></RequireAuth>} />
              <Route path="/admin/logs" element={<RequireAuth admin><AdminLogs /></RequireAuth>} />
              <Route path="/admin/statistics" element={<RequireAuth admin><AdminStatistics /></RequireAuth>} />

              <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ConfirmProvider></ToastProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
