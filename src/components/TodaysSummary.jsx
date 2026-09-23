import { TrendingUp, Users, ClipboardCheck, AlertCircle } from 'lucide-react';

/**
 * Today's Summary Widget - Quick overview of today's clinic activity
 */
export default function TodaysSummary({ data }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const todaysVisits = data.visits.filter((visit) => String(visit.date || visit.createdAt || '').slice(0, 10) === today);
  const studentsSeen = new Set(todaysVisits.map((visit) => String(visit.studentId || visit.patientId || ''))).size;

  // Common complaints today
  const complaintsToday = todaysVisits.reduce((acc, visit) => {
    const complaint = visit.chiefComplaint || 'Other';
    acc[complaint] = (acc[complaint] || 0) + 1;
    return acc;
  }, {});

  const topComplaint = Object.entries(complaintsToday).sort((a, b) => b[1] - a[1])[0];

  const openAppointments = (data.appointments || []).filter((appointment) => {
    if (!['Requested', 'Pending', 'Scheduled'].includes(appointment.status)) return false;
    const startsAt = appointment.startsAt || (appointment.date ? `${appointment.date}T${appointment.time || '00:00'}+08:00` : '');
    const timestamp = Date.parse(startsAt);
    return Number.isFinite(timestamp) && timestamp >= Date.now();
  }).length;

  return (
    <div className="todays-summary-widget">
      <h4 className="widget-title">Today's Summary</h4>
      
      <div className="summary-stats">
        <div className="summary-stat">
          <div className="summary-stat-icon teal">
            <Users size={16} />
          </div>
          <div className="summary-stat-content">
            <strong>{todaysVisits.length}</strong>
            <span>Clinic Visits</span>
          </div>
        </div>

        <div className="summary-stat">
            <div className="summary-stat-icon amber">
            <Users size={16} />
          </div>
          <div className="summary-stat-content">
            <strong>{studentsSeen}</strong>
            <span>Students Seen</span>
          </div>
        </div>

        <div className="summary-stat">
          <div className="summary-stat-icon violet">
            <TrendingUp size={16} />
          </div>
          <div className="summary-stat-content">
            <strong>{topComplaint ? topComplaint[0] : 'None'}</strong>
            <span>Top Complaint</span>
          </div>
        </div>

        {openAppointments > 0 && (
          <div className="summary-stat alert">
            <div className="summary-stat-icon rose">
              <ClipboardCheck size={16} />
            </div>
            <div className="summary-stat-content">
              <strong>{openAppointments}</strong>
              <span>Upcoming Appointments</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
