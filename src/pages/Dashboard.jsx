import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Heart,
  MoreHorizontal,
  Package,
  Plus,
  Siren,
  ShieldAlert,
  Stethoscope,
  Users,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TodaysSummary from "../components/TodaysSummary";
import RecentPatientsWidget from "../components/RecentPatientsWidget";
import { getPendingRegistrations, getUsersForAdmin } from "../utils/auth";

const day = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date());
const studentColors = ["coral", "teal", "amber", "violet", "blue"];

const toDateKey = (date) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const todayKey = toDateKey(new Date());
const isToday = (visit) => !visit.date || toDateKey(visit.date) === todayKey;

export default function Dashboard({ data, user }) {
  const navigate = useNavigate();
  const [trendRange, setTrendRange] = useState("week");
  const isAdmin = user?.role === "system_administrator";
  const userFirstName = (user?.name || data.settings.nurseName).replace(/^Nurse\s+/i, "").split(" ")[0] || "Admin";
  const [adminUsers, setAdminUsers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);

  useEffect(() => {
    if (isAdmin) {
      getPendingRegistrations().then(setPendingInvites);
      getUsersForAdmin().then(setAdminUsers);
    }
  }, [isAdmin]);

  const getStudent = (id) =>
    data.students.find((student) => student.id === id) || {};
  const todayVisits = data.visits.filter(isToday);
  const todayStudentCount = new Set(todayVisits.map((visit) => visit.studentId)).size;
  const lowStock = data.inventory.filter(
    (item) => item.quantity <= item.reorderLevel,
  ).length;
  
  // Calculate pending follow-ups from appointments
  const pendingFollowUps = (data.appointments || []).filter(
    appointment => appointment.status === 'Scheduled' || appointment.status === 'Pending'
  ).length;
  const incidentCount = (data.incidents || []).length;
  const screenedStudents = new Set((data.screenings || []).map((record) => record.studentId)).size;
  const screeningProgress = data.students.length > 0
    ? `${Math.round((screenedStudents / data.students.length) * 100)}% complete`
    : "No students yet";
  
  const currentHour = new Date().getHours();
  let greeting = "Good morning";
  if (currentHour >= 12 && currentHour < 18) greeting = "Good afternoon";
  else if (currentHour >= 18) greeting = "Good evening";

  // Generate clinic alerts dynamically
  const clinicAlerts = [];
  
  // Low stock alerts
  const lowStockItems = data.inventory.filter(item => item.quantity <= item.reorderLevel);
  lowStockItems.slice(0, 2).forEach(item => {
    clinicAlerts.push({
      icon: Package,
      title: `${item.name} stock is low`,
      text: `${item.quantity} ${item.unit} remaining · reorder at ${item.reorderLevel}`,
      tone: "rose",
      onClick: () => navigate('/inventory'),
    });
  });
  
  // Upcoming appointments/follow-ups
  const upcomingAppointments = (data.appointments || []).filter(
    apt => apt.status === 'Scheduled'
  ).slice(0, 2);
  upcomingAppointments.forEach(apt => {
    const student = getStudent(apt.studentId);
    if (student.name) {
      clinicAlerts.push({
        icon: CalendarDays,
        title: `${student.name} has a follow-up`,
        text: `${apt.reason} · ${apt.date} at ${apt.time}`,
        tone: "amber",
        onClick: () => navigate('/new-visit'),
      });
    }
  });
  
  // Health screening reminders (if students exist but few screenings)
  const screeningRate = data.students.length > 0 
    ? (screenedStudents / data.students.length) * 100 
    : 100;
  if (data.students.length > 0 && screeningRate < 80) {
    const unscreened = Math.max(0, data.students.length - screenedStudents);
    clinicAlerts.push({
      icon: ClipboardCheck,
      title: "Health screenings needed",
      text: `${unscreened} student${unscreened !== 1 ? 's' : ''} pending screening`,
      tone: "teal",
      onClick: () => navigate('/health-screening'),
    });
  }

  const urgentIncidents = (data.incidents || []).filter(
    (incident) => incident.severity === 'Severe' || incident.severity === 'Critical',
  );
  if (urgentIncidents.length > 0) {
    clinicAlerts.unshift({
      icon: ShieldAlert,
      title: `${urgentIncidents.length} urgent incident${urgentIncidents.length === 1 ? '' : 's'} need review`,
      text: "Severe or critical safety record",
      tone: "rose",
      onClick: () => navigate('/reports'),
    });
  }
  
  // Empty state for whole dashboard if no students
  if (data.students.length === 0) {
    return (
      <div className="dashboard">
        <section className="welcome-band">
          <div>
            <p className="eyebrow light">
              {day} · {data.settings.schoolYear}
            </p>
            <h2>{greeting}, {userFirstName}</h2>
            <p className="welcome-copy">
              A clear view of today’s clinic activity.
            </p>
          </div>
        </section>
        <div className="panel" style={{ textAlign: 'center', padding: '50px 20px', marginTop: '20px' }}>
          <div className="empty-state-icon"><Users size={32} /></div>
          <h3 style={{ font: '600 20px Outfit', marginBottom: '8px' }}>Welcome to HealthMate+ PRO</h3>
          <p style={{ color: 'var(--muted)', maxWidth: '400px', margin: '0 auto 20px', lineHeight: '1.5', fontSize: '13px' }}>
            Your school clinic management system is ready. Let's start by adding your first student to the records.
          </p>
          <button className="full-btn" onClick={() => navigate('/students')} style={{ width: 'auto', display: 'inline-flex', padding: '11px 24px' }}>
            <Plus size={17} /> Add a Student
          </button>
        </div>
        <div className="dashboard-footer">
          {data.settings.schoolYear} · <Heart size={12} aria-hidden="true" /> HealthMate+
        </div>
      </div>
    );
  }

  // Generate daily visits for chart
  const chartDays = Array.from({ length: trendRange === "month" ? 4 : 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (trendRange === "month" ? (3 - index) * 7 : 6 - index));
    return date;
  });
  const dailyVisits = chartDays.map((date) => {
    if (trendRange === "month") {
      const weekEnd = new Date(date);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return data.visits.filter((visit) => {
        const visitDate = new Date(visit.date || new Date());
        return visitDate >= date && visitDate < weekEnd;
      }).length;
    }
    const dateKey = toDateKey(date);
    return data.visits.filter((visit) => !visit.date
      ? dateKey === todayKey
      : toDateKey(visit.date) === dateKey).length;
  });
  const todayIndex = dailyVisits.length - 1;

  const maxDailyVisits = Math.max(...dailyVisits, 1);

  // Top complaints
  const complaintsMap = {};
  data.visits.forEach(v => {
    if (v.chiefComplaint) {
      complaintsMap[v.chiefComplaint] = (complaintsMap[v.chiefComplaint] || 0) + 1;
    }
  });
  const topComplaints = Object.entries(complaintsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const maxComplaintCount = topComplaints.length > 0 ? topComplaints[0][1] : 1;

  // Recent students
  const recentStudents = [...data.students].reverse().slice(0, 3);

  return (
    <div className="dashboard">
      <section className="welcome-band">
        <div>
          <p className="eyebrow light">
            {isAdmin ? "Administrator overview" : day} · {data.settings.schoolYear}
          </p>
          <h2>{greeting}, {userFirstName}</h2>
          <p className="welcome-copy">
            {isAdmin ? "Monitor care delivery, records, stock, and staff access from one place." : "A clear view of today’s clinic activity."}
          </p>
        </div>
        <button className="date-pill" onClick={() => navigate('/reports')}>
          <CalendarDays size={16} /> Today <ChevronRight size={15} />
        </button>
      </section>
      
      {!isAdmin && (
        <>
          {/* Today's Summary Widget */}
          <TodaysSummary data={data} />
          
          {/* Recent Patients Widget */}
          <RecentPatientsWidget data={data} />
        </>
      )}
      
      {isAdmin ? (
        <section className="stats-grid">
          <Stat icon={Users} label="Total Users" value={adminUsers.length} change="System accounts" tone="teal" />
          <Stat icon={Users} label="Active Users" value={adminUsers.filter(u => u.status === 'active').length} change="Active accounts" tone="teal" />
          <Stat icon={Users} label="Pending Invites" value={pendingInvites.length} change="Awaiting approval" tone="amber" />
          <Stat icon={Package} label="Low stock alerts" value={lowStock} change={lowStock > 0 ? "Review now" : "All stocked"} tone="rose" />
        </section>
      ) : (
        <section className="stats-grid">
          <Stat
            icon={Users}
            label="Students seen today"
            value={todayStudentCount}
            change={todayStudentCount > 0 ? `+${todayStudentCount} today` : "No visits yet"}
            tone="teal"
          />
          <Stat
            icon={Clock3}
            label="Pending requests"
            value={pendingFollowUps}
            change={pendingFollowUps > 0 ? `${pendingFollowUps} scheduled` : "None pending"}
            tone="amber"
          />
          <Stat
            icon={Package}
            label="Low stock alerts"
            value={lowStock}
            change={lowStock > 0 ? "Review now" : "All stocked"}
            tone="rose"
          />
          <Stat
            icon={Users}
            label="Total students"
            value={data.students.length}
            change="Enrolled"
            tone="violet"
          />
          <Stat
            icon={ShieldAlert}
            label="Incident reports"
            value={incidentCount}
            change={incidentCount > 0 ? "Review records" : "No incidents recorded"}
            tone="rose"
          />
          <Stat
            icon={ClipboardCheck}
            label="Health screenings"
            value={screenedStudents}
            change={screeningProgress}
            tone="teal"
          />
        </section>
      )}
      <div className="content-grid">
        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">{isAdmin ? "Inventory" : "Live activity"}</p>
              <h3>
                {isAdmin ? "Inventory overview" : "Today’s visits"} {!isAdmin && <span className="live-dot" />}
              </h3>
            </div>
            <button className="text-btn" onClick={() => navigate(isAdmin ? '/inventory' : '/new-visit')}>
              View all <ArrowUpRight size={15} />
            </button>
          </div>
          {isAdmin ? (
            <div className="admin-table-wrap">
              <table className="admin-table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 0', color: 'var(--text-2)', fontWeight: 500 }}>Item</th>
                    <th style={{ padding: '8px 0', color: 'var(--text-2)', fontWeight: 500 }}>Category</th>
                    <th style={{ padding: '8px 0', color: 'var(--text-2)', fontWeight: 500 }}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inventory.slice(0, 5).map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '12px 0' }}><strong>{item.name}</strong></td>
                      <td style={{ padding: '12px 0', color: 'var(--text-2)' }}>{item.category}</td>
                      <td style={{ padding: '12px 0' }}>
                        <span className={`status-chip ${item.quantity <= item.reorderLevel ? 'warn' : 'success'}`}>
                          {item.quantity} {item.unit}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="full-btn" onClick={() => navigate('/inventory')} style={{ marginTop: '1rem' }}>
                Review all stock
              </button>
            </div>
          ) : todayVisits.length > 0 ? (
            <>
              <div className="timeline">
                {todayVisits.map((visit, index) => {
                  const student = getStudent(visit.studentId);
                  return (
                    <div className="timeline-item" key={visit.id}>
                      <time>{visit.time}</time>
                      <div className={`timeline-line ${studentColors[index % studentColors.length]}`}>
                        <span />
                      </div>
                      <div className="visit-copy">
                        <div className="visit-top">
                          <strong>{student.name}</strong>
                          <span
                            className={`status-chip ${visit.disposition === "Sent home" ? "warn" : "success"}`}
                          >
                            {visit.disposition}
                          </span>
                        </div>
                        <p>
                          {visit.chiefComplaint} <span>·</span> {visit.type}
                        </p>
                      </div>
                      <button className="more-btn" onClick={() => navigate(`/students/${student.id}`)} aria-label={`Open ${student.name}`}><MoreHorizontal size={17} /></button>
                    </div>
                  );
                })}
              </div>
              <button className="full-btn" onClick={() => navigate('/new-visit')}>
                <Plus size={17} /> Log a new visit
              </button>
            </>
          ) : (
            <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <div className="empty-state-icon"><Stethoscope size={30} /></div>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>No visits yet</h4>
              <p style={{ color: 'var(--text-2)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>It's a quiet day in the clinic.</p>
              <button className="full-btn" onClick={() => navigate('/new-visit')} style={{ width: 'auto', display: 'inline-flex', padding: '0.5rem 1rem', margin: '0 auto' }}>
                <Plus size={17} /> Log a new visit
              </button>
            </div>
          )}
        </section>
        <section className="panel actions-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">{isAdmin ? "Management" : "Shortcuts"}</p>
              <h3>{isAdmin ? "Admin shortcuts" : "Quick actions"}</h3>
            </div>
          </div>
          <div className="action-list">
            <Action
              icon={Plus}
              label={isAdmin ? "Register student" : "New visit"}
              text={isAdmin ? "Add a new health record" : "Log a student visit"}
              tone="teal"
              onClick={() => navigate(isAdmin ? '/students/new' : '/new-visit')}
            />
            <Action
              icon={Siren}
              label={isAdmin ? "Manage access" : "Incident report"}
              text={isAdmin ? "Review staff and permissions" : "Document an incident"}
              tone="rose"
              onClick={() => navigate(isAdmin ? '/settings' : '/incident-reports')}
            />
            <Action
              icon={CalendarDays}
              label={isAdmin ? "Generate report" : "Health screening"}
              text={isAdmin ? "Open school health analytics" : "Record screening results"}
              tone="amber"
              onClick={() => navigate(isAdmin ? '/reports' : '/health-screening')}
            />
            <Action
              icon={Package}
              label={isAdmin ? "Review inventory" : "Check inventory"}
              text={isAdmin ? "Check stock and expiry dates" : "Review clinic supplies"}
              tone="violet"
              onClick={() => navigate('/inventory')}
            />
          </div>
          
          {!isAdmin && recentStudents.length > 0 && (
            <div className="recent-students">
              <h4>Recent students</h4>
              <div className="student-chips">
                {recentStudents.map((s) => {
                  const initials = s.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
                  return (
                    <button 
                      key={s.id} 
                      className="student-chip"
                      onClick={() => navigate(`/students/${s.id}`)}
                    >
                      <div className="chip-avatar">
                        {initials}
                      </div>
                      <span>{s.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {isAdmin && (
             <div className="recent-students">
               <h4>Pending invitations</h4>
               {pendingInvites.length > 0 ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                   {pendingInvites.slice(0, 3).map(entry => (
                     <div key={entry.username} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--surface-2)', borderRadius: '8px' }}>
                       <div>
                         <strong style={{ fontSize: '0.85rem' }}>{entry.name}</strong><br/>
                         <small style={{ color: 'var(--text-2)', fontSize: '0.75rem' }}>{entry.email}</small>
                       </div>
                       <button className="text-btn" onClick={() => navigate('/settings?tab=users')} style={{ fontSize: '0.8rem' }}>Review</button>
                     </div>
                   ))}
                 </div>
               ) : (
                 <p style={{ color: 'var(--text-2)', fontSize: '0.85rem', marginTop: '1rem' }}>No pending invitations.</p>
               )}
             </div>
          )}
        </section>
      </div>
      {!isAdmin && (
        <div className="bottom-grid">
          <section className="panel trend-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">This week</p>
                <h3>Clinic pulse</h3>
              </div>
              <select value={trendRange} onChange={(event) => setTrendRange(event.target.value)}>
                <option value="week">Last 7 days</option>
                <option value="month">Last 4 weeks</option>
              </select>
            </div>
            <div className="chart-area" style={{ marginBottom: topComplaints.length > 0 ? '1.5rem' : '0' }}>
              <div className="chart-y">
                <span>{Math.ceil(maxDailyVisits)}</span>
                <span>{Math.ceil(maxDailyVisits * 0.75)}</span>
                <span>{Math.ceil(maxDailyVisits * 0.5)}</span>
                <span>{Math.ceil(maxDailyVisits * 0.25)}</span>
                <span>0</span>
              </div>
              <div className="bars">
                {dailyVisits.map((count, i) => (
                  <div className="bar-column" key={i}>
                    <div
                      className={`bar ${i === todayIndex ? "highlight" : ""}`}
                      style={{ height: `${(count / maxDailyVisits) * 100}%`, minHeight: count > 0 ? '4px' : '0' }}
                    >
                      <b>{count}</b>
                    </div>
                    <span>
                      {trendRange === "month" ? `Week ${i + 1}` : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(chartDays[i])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            
            {topComplaints.length > 0 && (
              <div style={{ paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <p className="section-kicker" style={{ marginBottom: '1rem' }}>Top complaints</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  {topComplaints.map(([complaint, count]) => (
                    <div key={complaint}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-1)' }}>
                        <span style={{ fontWeight: 500 }}>{complaint}</span>
                        <strong>{count}</strong>
                      </div>
                      <div style={{ background: 'var(--surface-2)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ background: 'var(--brand-teal)', height: '100%', width: `${(count / maxComplaintCount) * 100}%`, borderRadius: '3px', transition: 'width 0.5s ease-out' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="panel alerts-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Needs attention</p>
                <h3>Clinic alerts</h3>
              </div>
              <span className="alert-count">{clinicAlerts.length}</span>
            </div>
            {clinicAlerts.length > 0 ? (
              clinicAlerts.map((alert, index) => (
                <Alert
                  key={index}
                  icon={alert.icon}
                  title={alert.title}
                  text={alert.text}
                  tone={alert.tone}
                  onClick={alert.onClick}
                />
              ))
            ) : (
              <div className="empty-state">
                <p>All clear!</p>
                <small>No alerts at this time. Everything is running smoothly.</small>
              </div>
            )}
          </section>
        </div>
      )}
      <footer style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-3)', padding: '2rem 0 1rem' }}>
        {data.settings.schoolYear} · <Heart size={12} aria-hidden="true" /> HealthMate+
      </footer>
    </div>
  );
}

function Stat({ icon: Icon, label, value, change, tone }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-icon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>
          <ArrowUpRight size={12} /> {change}
        </small>
      </div>
    </div>
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

function Alert({ icon: Icon, title, text, tone, onClick }) {
  return (
    <button type="button" className="alert-item" onClick={onClick}>
      <div className={`alert-icon ${tone}`}><Icon size={16} /></div>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <ChevronRight size={15} />
    </button>
  );
}
