import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Armchair, Moon, Sun, LogOut, LayoutDashboard, CalendarDays, Ticket, Users, BarChart3, ScrollText, ScanLine, CircleHelp } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Suspense, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { PageSkeleton } from './ui.jsx';

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('campusseat_theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const dark = theme === 'dark';
  return (
    <button className="btn ghost icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

export function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const out = async () => { await logout(); toast.ok('You are logged out.'); nav('/'); };
  return (
    <header className="topbar">
      <div className="container">
        <Link to="/" className="brand"><span className="brand-mark"><Armchair size={20} aria-hidden /></span>CampusSeat</Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Events</NavLink>
          {user && <NavLink to="/my-bookings">My bookings</NavLink>}
          {isAdmin && <NavLink to="/admin">Admin panel</NavLink>}
          <NavLink to="/help">Help</NavLink>
        </nav>
        <div className="right">
          <ThemeToggle />
          {user ? (
            <>
              <Link className="who" to="/account" title="Account and security">{user.full_name}</Link>
              <button className="btn secondary sm" onClick={out}><LogOut size={16} aria-hidden />Log out</button>
            </>
          ) : (
            <>
              <Link className="btn secondary sm" to="/login">Log in</Link>
              <Link className="btn sm" to="/register">Register</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Shown while the device is offline: saved tickets still open, other pages need a connection. */
function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false); const off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return <div className="offline-banner" role="status"><WifiOff size={16} aria-hidden />You are offline. Your saved tickets in My bookings still open.</div>;
}

export function Shell() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <OfflineBanner />
      <TopBar />
      <main id="main" tabIndex={-1}><Suspense fallback={<PageSkeleton />}><Outlet /></Suspense></main>
      <footer className="footer"><div className="container">CampusSeat. Book your seat at campus events.</div></footer>
    </>
  );
}

// Grouped so the six destinations read as three small sets (easier to scan than one list).
const groups = [
  ['Overview', [['/admin', 'Dashboard', LayoutDashboard, true]]],
  ['Manage', [['/admin/check-in', 'Check-in', ScanLine], ['/admin/events', 'Events', CalendarDays], ['/admin/bookings', 'Bookings', Ticket], ['/admin/users', 'Users', Users]]],
  ['Records', [['/admin/reports', 'Reports', BarChart3], ['/admin/audit', 'Audit logs', ScrollText]]],
];
export function AdminLayout() {
  return (
    <div className="container admin">
      <nav className="side" aria-label="Admin">
        {groups.map(([title, items]) => (
          <div key={title} className="side-group">
            <span className="side-title">{title}</span>
            {items.map(([to, label, Icon, end]) => <NavLink key={to} to={to} end={end}><Icon size={18} aria-hidden />{label}</NavLink>)}
          </div>
        ))}
      </nav>
      <section><Suspense fallback={<PageSkeleton bare />}><Outlet /></Suspense></section>
    </div>
  );
}
