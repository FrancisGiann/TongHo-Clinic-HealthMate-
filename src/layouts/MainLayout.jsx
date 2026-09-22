import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  HeartPulse,
  Home,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldAlert,
  Stethoscope,
  Sun,
  Syringe,
  Users,
  X,
} from "lucide-react";
import { api } from "../utils/api";

const staffNav = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/students", label: "Students", icon: Users },
  { to: "/new-visit", label: "New Visit", icon: Stethoscope },
  { to: "/health-screening", label: "Health Screening", icon: ClipboardList },
  { to: "/immunizations", label: "Immunizations", icon: Syringe },
  { to: "/incident-reports", label: "Incident Reports", icon: ShieldAlert },
  { to: "/queue", label: "Queue", icon: Activity },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
];

const portalNav = [
  { to: "/", label: "My Health Portal", icon: Home },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
];

export default function MainLayout({ settings, dark, setDark, user, onLogout, data }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoSource, setLogoSource] = useState("/Logo.jpg");
  const [clock, setClock] = useState(() => new Date());
  const [showNotifications, setShowNotifications] = useState(false);
  const [serverNotifications, setServerNotifications] = useState([]);
  const location = useLocation();
  const navigate = useNavigate();
  const isStaff = ['school_nurse', 'system_administrator'].includes(user?.role);
  const nav = isStaff ? staffNav : portalNav;
  const title = nav.find((item) => item.to === location.pathname)?.label
    || (location.pathname === "/students/new" ? "New Health Record" : null)
    || (location.pathname.startsWith("/students/") ? "Student Profile" : "Settings");
  const userDisplayName = user?.name?.replace(/^Nurse\s+/i, "") || settings.nurseName.replace(/^Nurse\s+/i, "");
  const userRoleLabel = user?.role === "system_administrator" ? "Administrator" : user?.role === "school_nurse" ? "School nurse" : user?.role === "guardian" ? "Guardian" : "Student";
  
  // Generate dynamic clinic alerts
  const clinicAlerts = [];
  
  if (data) {
    // Low stock alerts
    const lowStockItems = (data.inventory || []).filter(item => item.quantity <= item.reorderLevel);
    lowStockItems.slice(0, 2).forEach(item => {
      clinicAlerts.push({
        title: `${item.name} stock is low`,
        text: `${item.quantity} ${item.unit} remaining`
      });
    });
    
    // Upcoming appointments
    const upcomingAppointments = (data.appointments || []).filter(
      apt => apt.status === 'Scheduled'
    ).slice(0, 2);
    upcomingAppointments.forEach(apt => {
      const student = data.students.find(s => s.id === apt.studentId);
      if (student) {
        clinicAlerts.push({
          title: `${student.name} has a follow-up`,
          text: `${apt.reason || 'Appointment'} · ${apt.date}`
        });
      }
    });
    
    // Screening reminder
    const screeningRate = data.students.length > 0 
      ? ((data.screenings || []).length / data.students.length) * 100 
      : 100;
    if (data.students.length > 0 && screeningRate < 80) {
      const unscreened = data.students.length - (data.screenings || []).length;
      clinicAlerts.push({
        title: "Health screenings needed",
        text: `${unscreened} student${unscreened !== 1 ? 's' : ''} pending`
      });
    }
  }
  serverNotifications.filter((item) => item.status !== 'read').slice(0, 5).forEach((item) => {
    clinicAlerts.push({ title: item.subject, text: item.body, id: item.id });
  });
  
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    api.get('/api/notifications').then((result) => setServerNotifications(result.notifications || [])).catch(() => {});
  }, [user?.id]);
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
          <button className="icon-btn sidebar-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
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
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {isStaff && (
            <NavLink to="/settings" className="protected-link" title="Settings - requires authentication">
              <Settings size={18} />
              <span>Settings</span>
              <LockKeyhole className="lock-badge" size={13} aria-label="Protected access" />
            </NavLink>
          )}
          <button className="logout-btn" onClick={onLogout} aria-label="Sign out and close session">
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
          <div className="nurse-mini">
            <div className="avatar small">
              {settings.nurseName?.split(' ').map(n => n[0]).join('').slice(0, 2) || 'NS'}
            </div>
            <div>
              <strong>{userDisplayName}</strong>
              <span>{userRoleLabel}</span>
            </div>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={21} />
          </button>
          <div>
            <p className="eyebrow">
              {settings.schoolName} / {settings.schoolYear}
            </p>
            <h1>{title}</h1>
          </div>
          <div className="top-actions">
            <span className="live-clock">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {isStaff && (
              <button
                className="icon-btn"
                onClick={() => navigate("/students")}
                aria-label="Search or browse students"
              >
                <Search size={19} />
              </button>
            )}
            <button
              className="icon-btn notification"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={`View alerts (${clinicAlerts.length} new)`}
              aria-expanded={showNotifications}
              aria-controls="notification-panel"
            >
              <Bell size={19} />
              <i>{clinicAlerts.length}</i>
            </button>
            {showNotifications && (
              <div 
                id="notification-panel"
                className="notification-panel"
                role="alert"
                aria-live="polite"
              >
                <div className="notification-heading">
                  <strong>Clinic alerts</strong>
                  <button 
                    onClick={() => setShowNotifications(false)}
                    aria-label="Close alerts"
                  >
                    Close
                  </button>
                </div>
                {clinicAlerts.length > 0 ? (
                  clinicAlerts.map((alert, index) => (
                    <div key={index}>
                      <b>{alert.title}</b>
                      <span>{alert.text}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                    No alerts at this time
                  </div>
                )}
                <button 
                  className="notification-footer" 
                  onClick={() => { 
                    setShowNotifications(false); 
                    navigate(isStaff ? '/reports' : '/appointments'); 
                  }}
                  aria-label={isStaff ? "View all reports in detail" : "View appointments"}
                >
                  {isStaff ? 'View all reports' : 'View appointments'}
                </button>
              </div>
            )}
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
