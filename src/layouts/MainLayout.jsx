import { useEffect, useRef, useState } from "react";
import { Link, matchPath, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FileBarChart,
  HeartPulse,
  Home,
  LogOut,
  Menu,
  Moon,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Sun,
  Users,
  X,
} from "lucide-react";
import { api } from "../utils/api";
import { formatManilaDateTime } from "../utils/dateTime";

const nurseNavGroups = [
  { label: "Overview", items: [
    { to: "/", label: "Dashboard", icon: Home },
  ] },
  { label: "Patient care", items: [
    { to: "/students", label: "Patients", icon: Users },
    { to: "/health-record-review", label: "Health record review", icon: ClipboardList },
    { to: "/new-visit", label: "New Visit", icon: Stethoscope },
    { to: "/appointments", label: "Appointments", icon: CalendarDays },
  ] },
  { label: "Clinic operations", items: [
    { to: "/inventory", label: "Inventory", icon: Package },
    { to: "/reports", label: "Reports", icon: FileBarChart },
    { to: "/data-imports", label: "Data & Imports", icon: Database },
    { to: "/risk-rules", label: "Risk Rules", icon: ShieldCheck },
  ] },
];

const adminNavGroups = [
  { label: "Overview", items: [
    { to: "/", label: "Dashboard", icon: Home },
  ] },
  { label: "Administration", items: [
    { to: "/users", label: "Users", icon: Users },
    { to: "/school-clinic", label: "School & Clinic", icon: Building2 },
    { to: "/data-imports", label: "Data & Imports", icon: Database },
    { to: "/communications", label: "Communications", icon: Bell },
    { to: "/risk-rules", label: "Risk Rules", icon: ShieldCheck },
    { to: "/security", label: "Audit history", icon: ShieldCheck },
  ] },
  { label: "Insights", items: [
    { to: "/reports", label: "Reports", icon: FileBarChart },
  ] },
];

const portalNavGroups = [
  { label: "My health", items: [
    { to: "/", label: "My Health Portal", icon: Home },
    { to: "/appointments", label: "Appointments", icon: CalendarDays },
    { to: "/visits", label: "Visit History", icon: ClipboardList },
    { to: "/health-records", label: "Student Health Record", icon: HeartPulse },
  ] },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "healthmate-sidebar-collapsed";

function getStoredSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export default function MainLayout({ settings, dark, setDark, user, onLogout, data }) {
  const [collapsed, setCollapsed] = useState(getStoredSidebarCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoSource, setLogoSource] = useState("/Logo.jpg");
  const [clock, setClock] = useState(() => new Date());
  const [showNotifications, setShowNotifications] = useState(false);
  const [serverNotifications, setServerNotifications] = useState([]);
  const notificationButtonRef = useRef(null);
  const pageTitleRef = useRef(null);
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);
  const navigate = useNavigate();
  const isAdmin = user?.role === 'system_administrator';
  const navGroups = isAdmin ? adminNavGroups : user?.role === 'school_nurse' ? nurseNavGroups : portalNavGroups;
  const nav = navGroups.flatMap((group) => group.items);
  const specialTitle = {
    "/students/new": "New Student Record",
    "/faculty/new": "New Faculty Record",
    "/profiles": "Linked Profiles",
    "/health-record-review": "Health Record Review",
    "/health-records": "Student Health Record",
    "/visits": "Visit History",
  }[location.pathname]
    || (matchPath({ path: "/students/:studentId", end: true }, location.pathname) ? "Patient Profile" : null)
    || (matchPath({ path: "/profiles/:patientId", end: true }, location.pathname) ? "Health Profile" : null)
    || (matchPath({ path: "/visits/:visitId", end: true }, location.pathname) ? "Clinic Visit Details" : null);
  const navTitle = nav.find((item) => matchPath({ path: item.to, end: item.to === '/' }, location.pathname))?.label;
  const title = specialTitle || navTitle
    || (location.pathname === "/settings" ? "My Account" : "Settings");
  const userDisplayName = user?.name?.replace(/^Nurse\s+/i, "") || settings.nurseName?.replace(/^Nurse\s+/i, "") || 'User';
  const userRoleLabel = user?.role === "system_administrator" ? "Administrator" : user?.role === "school_nurse" ? "School nurse" : "Guardian";
  
  // Keep local clinic alerts on routes available to the current role.
  const clinicAlerts = [];

  if (data && user?.role === 'school_nurse') {
    const lowStockItems = (data.inventory || []).filter(item => !item.archived && item.quantity <= item.reorderLevel);
    lowStockItems.slice(0, 2).forEach(item => {
      clinicAlerts.push({
        title: `${item.name} stock is low`,
        text: `${item.quantity} ${item.unit} remaining`,
        action: 'Review inventory',
        to: '/inventory',
      });
    });
  }

  if (data && ['school_nurse', 'guardian'].includes(user?.role)) {
    const upcomingAppointments = (data.appointments || []).filter((appointment) => {
      if (appointment.status !== 'Scheduled') return false;
      const startsAt = appointment.startsAt || (appointment.date ? `${appointment.date}T${appointment.time || '00:00'}+08:00` : '');
      const timestamp = Date.parse(startsAt);
      return Number.isFinite(timestamp) && timestamp >= Date.now();
    }).sort((first, second) => Date.parse(first.startsAt || `${first.date}T${first.time || '00:00'}+08:00`) - Date.parse(second.startsAt || `${second.date}T${second.time || '00:00'}+08:00`)).slice(0, 2);
    upcomingAppointments.forEach(apt => {
      const student = (data.students || []).find(s => String(s.id) === String(apt.studentId || apt.patientId));
      if (student) {
        clinicAlerts.push({
          title: `${student.name} has an appointment`,
          text: `${apt.reason || 'Appointment'} · ${formatManilaDateTime(apt.startsAt || apt.date, apt.time)}`,
          action: 'View appointments',
          to: '/appointments',
        });
      }
    });
  }

  serverNotifications.filter((item) => item.status !== 'read').slice(0, 5).forEach((item) => {
    clinicAlerts.push({ title: item.subject, text: item.body, id: item.id });
  });
  
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Keep the sidebar usable when browser storage is unavailable.
    }
  }, [collapsed]);
  useEffect(() => {
    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    window.scrollTo({ top: 0, behavior: 'auto' });
    pageTitleRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  useEffect(() => {
    if (!location.state?.openNotifications) return;
    setShowNotifications(true);
    notificationButtonRef.current?.focus();
  }, [location.state]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    api.get('/api/notifications').then((result) => setServerNotifications(result.notifications || [])).catch(() => {});
  }, [user?.id]);
  const markNotificationRead = async (id) => {
    try {
      await api.patch(`/api/notifications/${encodeURIComponent(id)}/read`, {});
      setServerNotifications((current) => current.map((item) => item.id === id ? { ...item, status: 'read' } : item));
    } catch {
      // Keep the notification visible when the server could not confirm the update.
    }
  };
  const closeNotifications = () => {
    setShowNotifications(false);
    notificationButtonRef.current?.focus();
  };
  useEffect(() => {
    if (!showNotifications) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeNotifications();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showNotifications]);
  return (
    <div className={`app-shell ${dark ? "dark" : ""}`}>
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
      >
        <div className="brand">
          <div className="brand-mark">
            <img
              src={logoSource}
              alt="Tong Ho Institute seal"
              onError={() => setLogoSource("/tong-ho-logo.svg")}
            />
          </div>
          <div className="brand-copy">
            <strong>HealthMate+</strong>
            <span>PRO</span>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-collapse"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="app-navigation"
          >
            {collapsed ? <ChevronRight size={19} aria-hidden="true" /> : <ChevronLeft size={19} aria-hidden="true" />}
          </button>
          <button
            className="icon-btn mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="clinic-card">
          <div className="clinic-icon">
            <HeartPulse size={18} />
          </div>
          <div>
            <strong>{settings.schoolName}</strong>
            <span>{settings.clinicName}</span>
          </div>
        </div>
        <nav id="app-navigation" aria-label={`${userRoleLabel} navigation`}>
          {navGroups.map(({ label: groupLabel, items }) => (
            <div className="sidebar-nav-group" key={groupLabel}>
              <p className="sidebar-nav-label">{groupLabel}</p>
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  title={collapsed ? label : undefined}
                  aria-label={label}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink to="/settings" className={({ isActive }) => `protected-link${isActive ? ' active' : ''}`} title={collapsed ? "My Account" : "My account settings"} aria-label="My Account">
            <Settings size={18} aria-hidden="true" />
            <span>My Account</span>
          </NavLink>
          <button className="logout-btn" onClick={onLogout} aria-label="Sign out and close session" title={collapsed ? "Sign out" : undefined}>
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
          <div className="nurse-mini">
            <div className="avatar small">
              {(user?.name || settings.nurseName || 'User').split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div>
              <strong>{userDisplayName}</strong>
              <span>{userRoleLabel}</span>
            </div>
          </div>
        </div>
      </aside>
      {mobileOpen && <button type="button" className="mobile-nav-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu" />}
      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            aria-controls="app-navigation"
          >
            <Menu size={21} />
          </button>
          <div><h1 ref={pageTitleRef} tabIndex={-1}>{title}</h1></div>
          <div className="top-actions">
            <span className="live-clock">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {user?.role === 'school_nurse' && (
              <button
                className="icon-btn"
                onClick={() => navigate("/students")}
                aria-label="Search or browse students"
              >
                <Search size={19} />
              </button>
            )}
            <button
              ref={notificationButtonRef}
              className="icon-btn notification"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={`Open notifications (${clinicAlerts.length} items)`}
              aria-expanded={showNotifications}
              aria-controls="notification-panel"
            >
              <Bell size={19} />
              {clinicAlerts.length > 0 && <i aria-hidden="true">{clinicAlerts.length > 9 ? '9+' : clinicAlerts.length}</i>}
            </button>
            <div
                id="notification-panel"
                className="notification-panel"
                hidden={!showNotifications}
                role="region"
                aria-labelledby="notification-panel-title"
                aria-live="polite"
              >
                <div className="notification-heading">
                  <strong id="notification-panel-title">Notifications</strong>
                  <button type="button"
                    onClick={closeNotifications}
                    aria-label="Close alerts"
                  >
                    Close
                  </button>
                </div>
                {clinicAlerts.length > 0 ? (
                  clinicAlerts.map((alert, index) => (
                    alert.to ? (
                      <Link
                        className="notification-link"
                        key={`${alert.to}-${index}`}
                        to={alert.to}
                        onClick={closeNotifications}
                      >
                        <b>{alert.title}</b>
                        <span>{alert.text}</span>
                        <small>{alert.action}<ArrowUpRight size={13} aria-hidden="true" /></small>
                      </Link>
                    ) : (
                      <div key={alert.id || `notification-${index}`}>
                        <b>{alert.title}</b>
                        <span>{alert.text}</span>
                        {alert.id && <button type="button" className="table-action" onClick={() => markNotificationRead(alert.id)}>Mark read</button>}
                      </div>
                    )
                  ))
                ) : (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                    No alerts at this time
                  </div>
                )}
              </div>
            <button
              className={`theme-toggle ${dark ? "on" : ""}`}
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
            >
              <Sun size={13} aria-hidden="true" />
              <Moon size={13} aria-hidden="true" />
              <b />
            </button>
          </div>
        </header>
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
