import { TrendingUp, Users, Clock, AlertCircle } from 'lucide-react';

/**
 * Today's Summary Widget - Quick overview of today's clinic activity
 */
export default function TodaysSummary({ data }) {
  const today = new Date().toDateString();
  
  // Today's visits
  const todaysVisits = data.visits.filter(visit => {
    const visitDate = new Date(visit.date).toDateString();
    return visitDate === today;
  });

  // Common complaints today
  const complaintsToday = todaysVisits.reduce((acc, visit) => {
    const complaint = visit.chiefComplaint || 'Other';
    acc[complaint] = (acc[complaint] || 0) + 1;
    return acc;
  }, {});

  const topComplaint = Object.entries(complaintsToday).sort((a, b) => b[1] - a[1])[0];

  // Patients pending follow-up
  const pendingFollowUps = (data.appointments || []).filter(
    apt => apt.status === 'Scheduled' || apt.status === 'Pending'
  ).length;

  // Average visit time (simulated)
  const avgVisitTime = todaysVisits.length > 0 ? '12 min' : '—';

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
            <span>Patients Seen</span>
          </div>
        </div>

        <div className="summary-stat">
          <div className="summary-stat-icon amber">
            <Clock size={16} />
          </div>
          <div className="summary-stat-content">
            <strong>{avgVisitTime}</strong>
            <span>Avg Visit Time</span>
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

        {pendingFollowUps > 0 && (
          <div className="summary-stat alert">
            <div className="summary-stat-icon rose">
              <AlertCircle size={16} />
            </div>
            <div className="summary-stat-content">
              <strong>{pendingFollowUps}</strong>
              <span>Follow-ups Due</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
