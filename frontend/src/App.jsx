import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Shell, AdminLayout } from './components/Layout.jsx';
import { PageSkeleton } from './components/ui.jsx';
import SmoothScroll, { scrollToTop } from './motion/SmoothScroll.jsx';
import Events from './pages/Events.jsx';

// The landing page (Events) ships in the main bundle; every other page loads on first visit,
// and the admin pages form their own chunks that students never download.
const EventDetail = lazy(() => import('./pages/EventDetail.jsx'));
const MyBookings = lazy(() => import('./pages/MyBookings.jsx'));
const Help = lazy(() => import('./pages/Help.jsx'));
const Security = lazy(() => import('./pages/Security.jsx'));
const Login = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/Auth.jsx').then((m) => ({ default: m.ResetPassword })));
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const AdminEvents = lazy(() => import('./pages/admin/AdminEvents.jsx'));
const AdminBookings = lazy(() => import('./pages/admin/AdminBookings.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const Reports = lazy(() => import('./pages/admin/Reports.jsx'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs.jsx'));
const CheckIn = lazy(() => import('./pages/admin/CheckIn.jsx'));

/** Sends visitors to the login page when a route needs an account (or the admin role). */
function Guard({ admin, children }) {
  const { user, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

/**
 * On navigation: back to the top, and move keyboard/screen-reader focus to the new page's heading
 * (otherwise focus stays on the link that was clicked, somewhere in the old page).
 */
function RouteFocus() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    scrollToTop();
    const t = setTimeout(() => {
      const h = document.querySelector('main h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }, 60);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}

const NotFound = () => (
  <div className="container page"><h1>Page not found</h1><p className="muted">Check the address, or go back to the <a href="/">events list</a>.</p></div>
);

export default function App() {
  return (
    <>
      <SmoothScroll />
      <RouteFocus />
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Events />} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="help" element={<Help />} />
            <Route path="my-bookings" element={<Guard><MyBookings /></Guard>} />
            <Route path="account" element={<Guard><Security /></Guard>} />
            <Route path="admin" element={<Guard admin><AdminLayout /></Guard>}>
              <Route index element={<Dashboard />} />
              <Route path="check-in" element={<CheckIn />} />
              <Route path="events" element={<AdminEvents />} />
              <Route path="bookings" element={<AdminBookings />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="reports" element={<Reports />} />
              <Route path="audit" element={<AuditLogs />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
