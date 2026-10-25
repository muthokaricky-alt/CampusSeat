import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Shell, AdminLayout } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import MyBookings from './pages/MyBookings.jsx';
import { Login, Register, ForgotPassword } from './pages/Auth.jsx';
import Help from './pages/Help.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import AdminEvents from './pages/admin/AdminEvents.jsx';
import AdminBookings from './pages/admin/AdminBookings.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import Reports from './pages/admin/Reports.jsx';
import AuditLogs from './pages/admin/AuditLogs.jsx';

/** Sends visitors to the login page when a route needs an account (or the admin role). */
function Guard({ admin, children }) {
  const { user, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="help" element={<Help />} />
        <Route path="my-bookings" element={<Guard><MyBookings /></Guard>} />
        <Route path="admin" element={<Guard admin><AdminLayout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="events" element={<AdminEvents />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit" element={<AuditLogs />} />
        </Route>
        <Route path="*" element={<div className="container page"><h1>Page not found</h1><p className="muted">Check the address, or go back to the <a href="/">events list</a>.</p></div>} />
      </Route>
    </Routes>
  );
}
