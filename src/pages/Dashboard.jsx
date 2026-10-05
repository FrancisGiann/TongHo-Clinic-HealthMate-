import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Heart,
  LockKeyhole,
  Package,
  Plus,
  Siren,
  ShieldAlert,
  Stethoscope,
  Users,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getUsersForAdmin } from "../utils/auth";
import { formatManilaDateTime } from "../utils/dateTime";

const toDateKey = (date) => {
  const direct = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
  if (direct && !Number.isNaN(Date.parse(`${direct}T00:00:00.000Z`))) return direct;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export default function Dashboard({ data, user }) {
  const navigate = useNavigate();
  const isAdmin = user?.role === "system_administrator";
  const userFirstName = (user?.name || "Administrator").replace(/^Nurse\s+/i, "").split(" ")[0] || "Admin";
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState('');
  const [adminUsersRetry, setAdminUsersRetry] = useState(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let current = true;
    setAdminUsersLoading(true);
    setAdminUsersError('');
    getUsersForAdmin({ throwOnError: true })
      .then((accounts) => {
        if (current) setAdminUsers(accounts);
      })
      .catch((error) => {
        if (current) setAdminUsersError(error.message || 'Unable to load system accounts.');
      })
      .finally(() => {
        if (current) setAdminUsersLoading(false);
      });
    return () => { current = false; };
  }, [isAdmin, adminUsersRetry]);
  const pendingInvites = adminUsers.filter((account) => account.status === 'invited');

  if (user?.role === 'school_nurse') {
    return <NurseDashboard data={data} user={user} />;
  }

  const currentHour = new Date().getHours();
  let greeting = "Good morning";
  if (currentHour >= 12 && currentHour < 18) greeting = "Good afternoon";
  else if (currentHour >= 18) greeting = "Good evening";

  return (
    <div className={`dashboard${isAdmin ? " admin-dashboard" : ""}`}>
      <section className="welcome-band">
        <div>
          <h2>{isAdmin ? "Administration overview" : `${greeting}, ${userFirstName}`}</h2>
          <p className="welcome-copy">
            {isAdmin
              ? "Review account access and open school reports."
              : "Review clinic reports and system activity from one place."}
          </p>
          <p className="dashboard-school-year">School year · {data.settings?.schoolYear || 'School clinic'}</p>
        </div>
        {isAdmin ? (
          <button className="date-pill" onClick={() => navigate('/users')}>
            <Users size={16} aria-hidden="true" /> Manage users <ChevronRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <button className="date-pill" onClick={() => navigate('/reports?period=daily')}>
            <CalendarDays size={16} aria-hidden="true" /> Today <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
        <div className="dashboard-welcome-art" aria-hidden="true">
          <img src="/illustrations/admin-care.webp" alt="" width="600" height="400" />
        </div>
      </section>
      
      {isAdmin && adminUsersLoading && <p className="field-hint" role="status">Loading administrator account counts…</p>}
      {isAdmin && adminUsersError && <div className="error-banner admin-dashboard-error" role="alert">
        <span>Administrator account counts could not be loaded. {adminUsersError}</span>
        <button type="button" className="secondary-btn" onClick={() => setAdminUsersRetry((count) => count + 1)}>Retry</button>
      </div>}
      
      <section className="stats-grid admin-metrics" aria-label="Account summary">
          <Stat to="/users" icon={Users} label="Total users" value={adminUsersLoading ? '…' : adminUsersError ? '—' : adminUsers.length} change="System accounts" tone="teal" primary />
          <Stat to="/users?filter=active" icon={Users} label="Active users" value={adminUsersLoading ? '…' : adminUsersError ? '—' : adminUsers.filter((account) => account.status === 'active').length} change="Active accounts" tone="teal" />
          <Stat to="/users?filter=invited" icon={Users} label="Pending invites" value={adminUsersLoading ? '…' : adminUsersError ? '—' : pendingInvites.length} change="Awaiting approval" tone="amber" />
          <Stat to="/users?filter=nurses" icon={ShieldAlert} label="Nurse accounts" value={adminUsersLoading ? '…' : adminUsersError ? '—' : adminUsers.filter((account) => account.role === 'school_nurse').length} change="Clinical access holders" tone="violet" />
          <Stat to="/users?filter=restricted" icon={LockKeyhole} label="Non-active accounts" value={adminUsersLoading ? '…' : adminUsersError ? '—' : adminUsers.filter((account) => account.status !== 'active').length} change="Invited or inactive" tone="rose" />
      </section>
      <div className="content-grid">
        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <h3>
                User access overview
              </h3>
            </div>
            <button className="text-btn" onClick={() => navigate('/users')}>
              View all <ArrowUpRight size={15} />
            </button>
          </div>
            <div className="admin-table-wrap">
              {adminUsersLoading ? <p className="empty-state" role="status">Loading system accounts…</p>
                : adminUsersError ? <p className="empty-state">The account list is unavailable. Use Retry above to load it again.</p>
                  : adminUsers.length === 0 ? <p className="empty-state">No system accounts are available yet.</p>
                    : <table className="admin-table">
                      <caption className="sr-only">Accounts, assigned roles, and access status</caption>
                      <thead>
                        <tr>
                          <th scope="col">Account</th>
                          <th scope="col">Role</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.slice(0, 5).map(account => (
                          <tr key={account.id}>
                            <td className="admin-account-cell"><strong>{account.name}</strong><small>{account.email}</small></td>
                            <td className="admin-role-cell">{({ school_nurse: 'School nurse', system_administrator: 'Administrator', guardian: 'Guardian', student: 'Student' })[account.role] || account.role}</td>
                            <td className="admin-status-cell"><span className={`status-chip ${account.status === 'active' ? 'success' : 'warn'}`}>{account.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>}
              {!adminUsersLoading && !adminUsersError && adminUsers.length > 0 && <Link className="full-btn admin-table-review" to="/users">Review user access</Link>}
            </div>
        </section>
        <section className="panel actions-panel">
          <div className="panel-heading">
            <div>
              <h3>Admin shortcuts</h3>
            </div>
          </div>
          <div className="action-list admin-action-list">
            <Action
              icon={Siren}
              label="Manage users"
              text="Review accounts and invitations"
              tone="rose"
              onClick={() => navigate('/users')}
            />
            <Action
              icon={CalendarDays}
              label="Generate report"
              text="Open school health analytics"
              tone="amber"
              onClick={() => navigate('/reports')}
            />
            <Action
              icon={LockKeyhole}
              label="Audit history"
              text="Review recent access and admin events"
              tone="violet"
              onClick={() => navigate('/security')}
            />
          </div>
          
          <div className="recent-students admin-pending-block">
            <h4>Pending invitations</h4>
               {adminUsersLoading ? <p role="status" className="field-hint">Loading invitations…</p> : adminUsersError ? <p className="field-hint">Invitation status is unavailable. Retry above to refresh it.</p> : pendingInvites.length > 0 ? (
                   <div className="admin-invite-list">
                   {pendingInvites.slice(0, 3).map(entry => (
                     <div className="admin-invite-row" key={entry.username}>
                       <div>
                         <strong>{entry.name}</strong><br />
                         <small>{entry.email}</small>
                       </div>
                       <button className="text-btn admin-invite-review" onClick={() => navigate('/users?filter=invited')}>Review</button>
                     </div>
                   ))}
                 </div>
               ) : (
                 <p className="admin-invite-empty">No invitations are waiting for review.</p>
               )}
             </div>
        </section>
      </div>
      <footer style={{ textAlign: 'center', fontSize: 'var(--type-compact)', color: 'var(--text-3)', padding: '2rem 0 1rem' }}>
        {data.settings.schoolYear} · <Heart size={12} aria-hidden="true" /> HealthMate+
      </footer>
    </div>
  );
}

function Stat({ to, icon: Icon, label, value, change, tone, primary = false }) {
  return (
    <Link to={to} className={`stat-card ${tone}${primary ? " stat-primary" : ""}`}>
      <div className="stat-icon">
        <Icon size={19} aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>
          <ChevronRight size={12} aria-hidden="true" /> {change}
        </small>
      </div>
    </Link>
  );
}

function Action({ icon: Icon, label, text, tone, onClick }) {
  return (
    <button className="action-item" onClick={onClick}>
      <div className={`action-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <span>
        <strong>{label}</strong>
        <small>{text}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function NurseDashboard({ data, user }) {
  const now = new Date();
  const today = toDateKey(now);
  const patients = data.students || [];
  const getPatient = (id) => patients.find((patient) => String(patient.id) === String(id));
  const getAppointmentTime = (appointment) => {
    const value = appointment.startsAt || (appointment.date
      ? `${appointment.date}T${appointment.time || '00:00'}+08:00`
      : '');
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const appointmentRequests = (data.appointments || []).filter((appointment) =>
    ['Requested', 'Pending'].includes(appointment.status),
  );
  const scheduledAppointments = (data.appointments || [])
    .filter((appointment) => appointment.status === 'Scheduled')
    .map((appointment) => ({ appointment, timestamp: getAppointmentTime(appointment) }))
    .filter(({ timestamp }) => timestamp !== null && timestamp >= now.getTime())
    .sort((first, second) => first.timestamp - second.timestamp);
  const todayAppointments = scheduledAppointments
    .filter(({ timestamp }) => toDateKey(new Date(timestamp)) === today)
    .slice(0, 4);
  const recentVisits = [...(data.visits || [])]
    .sort((first, second) => Date.parse(second.date || second.createdAt || 0) - Date.parse(first.date || first.createdAt || 0))
    .slice(0, 4);

  const inventoryAlerts = (data.inventory || [])
    .filter((item) => !item.archived && Number(item.quantity) <= Number(item.reorderLevel))
    .slice(0, 3);
  const userFirstName = (user?.name || data.settings?.nurseName || 'Nurse')
    .replace(/^Nurse\s+/i, '').trim().split(/\s+/)[0] || 'Nurse';
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric',
  }).format(now);

  const alerts = [
    ...inventoryAlerts.map((item) => ({
      key: `stock-${item.id}`,
      title: `${item.name} is below reorder level`,
      detail: `${item.quantity} ${item.unit} remaining · reorder at ${item.reorderLevel}`,
      to: '/inventory',
    })),
  ];

  return (
    <div className="nurse-dashboard">
      <header className="nurse-dashboard-header">
        <div>
          <p className="nurse-dashboard-date">{todayLabel} · {data.settings?.schoolYear || 'School clinic'}</p>
          <h2>{greeting}, {userFirstName}</h2>
          <p>Here’s what needs your attention at the clinic today.</p>
        </div>
        <div className="role-dashboard-art" aria-hidden="true">
          <img src="/illustrations/nurse-care.webp" alt="" width="600" height="400" />
        </div>
        <div className="nurse-dashboard-actions">
          <Link className="primary-btn" to="/new-visit"><Plus size={17} aria-hidden="true" /> New visit</Link>
        </div>
      </header>

      <section className="nurse-worklinks" aria-label="Clinic work overview">
        <NurseWorkLink
          to="/appointments"
          icon={CalendarDays}
          label="Appointment requests"
          value={`${appointmentRequests.length} to review`}
          detail={appointmentRequests.length ? 'Confirm or reschedule' : 'No requests waiting'}
        />
        <NurseWorkLink
          to="/appointments"
          icon={Clock3}
          label="Upcoming appointments"
          value={`${scheduledAppointments.length} scheduled`}
          detail={todayAppointments.length ? `${todayAppointments.length} scheduled today` : 'View the clinic schedule'}
        />
      </section>

      <div className="nurse-dashboard-columns">
        <section className="panel nurse-dashboard-panel">
          <div className="panel-heading">
            <div><h3>Today’s appointments</h3><p>Scheduled visits for today</p></div>
            <Link className="nurse-section-link" to="/appointments">Open schedule <ChevronRight size={15} aria-hidden="true" /></Link>
          </div>
          {todayAppointments.length ? (
            <div className="nurse-dashboard-list">
              {todayAppointments.map(({ appointment, timestamp }) => {
                const patient = getPatient(appointment.studentId || appointment.patientId);
                return (
                  <div className="nurse-dashboard-row" key={appointment.id}>
                    <time>{formatManilaDateTime(new Date(timestamp))}</time>
                    <div><strong>{patient?.name || 'Patient record unavailable'}</strong><span>{appointment.reason || 'Appointment'}</span></div>
                    <span className="status-chip success">Scheduled</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="nurse-dashboard-empty">
              <CalendarDays size={20} aria-hidden="true" />
              <div><strong>Your schedule is clear for today.</strong><p>Scheduled visits for today will appear here.</p><Link to="/appointments">View appointment schedule</Link></div>
            </div>
          )}
        </section>

        <section className="panel nurse-dashboard-panel">
          <div className="panel-heading">
            <div><h3>Needs attention</h3><p>Items with a clear next step</p></div>
            <span className="nurse-alert-count" aria-label={`${alerts.length} alerts`}>{alerts.length}</span>
          </div>
          {alerts.length ? (
            <div className="nurse-dashboard-alerts">
              {alerts.map((alert) => (
                <Link className="nurse-dashboard-alert" key={alert.key} to={alert.to}>
                  <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="nurse-dashboard-empty">
              <ClipboardCheck size={20} aria-hidden="true" />
              <div><strong>No inventory items need attention.</strong><p>Items at or below reorder level will appear here.</p></div>
            </div>
          )}
        </section>
      </div>

      <section className="panel nurse-dashboard-panel nurse-recent-visits">
        <div className="panel-heading">
          <div><h3>Recent clinic visits</h3><p>Latest records across the clinic</p></div>
          <Link className="nurse-section-link" to="/reports?period=daily">Daily report <ChevronRight size={15} aria-hidden="true" /></Link>
        </div>
        {recentVisits.length ? (
          <div className="nurse-dashboard-list">
            {recentVisits.map((visit) => {
              const patient = getPatient(visit.studentId || visit.patientId);
              const name = patient?.name || 'Patient record unavailable';
              const row = (
                <>
                  <time>{formatManilaDateTime(visit.date || visit.createdAt, visit.time)}</time>
                  <div><strong>{name}</strong><span>{visit.chiefComplaint || visit.type || 'Clinic visit'}</span></div>
                  <span className={`status-chip ${visit.disposition === 'Sent home' ? 'warn' : 'neutral'}`}>{visit.disposition || 'Visit recorded'}</span>
                </>
              );
              return patient
                ? <Link className="nurse-dashboard-row nurse-visit-link" key={visit.id} to={`/students/${encodeURIComponent(patient.id)}`}>{row}</Link>
                : <div className="nurse-dashboard-row" key={visit.id}>{row}</div>;
            })}
          </div>
        ) : (
          <div className="nurse-dashboard-empty">
            <Stethoscope size={20} aria-hidden="true" />
            <div><strong>No clinic visits yet.</strong><p>Saved visit records will appear here.</p><Link to="/new-visit">Start a visit record</Link></div>
          </div>
        )}
      </section>
    </div>
  );
}

function NurseWorkLink({ to, icon: Icon, label, value, detail }) {
  return (
    <Link className="nurse-worklink" to={to}>
      <span className="nurse-worklink-icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="nurse-worklink-copy"><strong>{label}</strong><b>{value}</b><small>{detail}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </Link>
  );
}
