import { useNavigate } from 'react-router-dom';
import { Clock, Stethoscope } from 'lucide-react';

/**
 * Recent Patients Widget - Shows recently seen patients for quick re-access
 */
export default function RecentPatientsWidget({ data }) {
  const navigate = useNavigate();

  const recentPatients = [...data.visits]
    .sort((first, second) => new Date(second.createdAt || second.date || 0).getTime() - new Date(first.createdAt || first.date || 0).getTime())
    .map(visit => {
      const student = data.students.find(s => String(s.id) === String(visit.studentId || visit.patientId));
      if (!student) return null;
      return {
        ...student,
        lastVisit: visit.date,
        lastComplaint: visit.chiefComplaint
      };
    })
    .filter(Boolean)
    .reduce((unique, patient) => {
      if (!unique.find(p => p.id === patient.id)) {
        unique.push(patient);
      }
      return unique;
    }, [])
    .slice(0, 5);

  if (recentPatients.length === 0) return null;

  return (
    <div className="recent-patients-widget">
      <div className="widget-header">
        <Clock size={16} />
        <h4>Recent Patients</h4>
        <span className="widget-badge">{recentPatients.length}</span>
      </div>
      
      <div className="recent-patients-list">
        {recentPatients.map(patient => {
          const initials = patient.name.split(' ').map(n => n[0]).join('').substring(0, 2);
          const colorIndex = Math.abs(patient.name.charCodeAt(0) % 5);
          const colors = ['coral', 'teal', 'amber', 'violet', 'blue'];
          
          return (
            <div key={patient.id} className="recent-patient-item">
              <button className="recent-patient-profile" onClick={() => navigate(`/students/${patient.id}`)}>
                <span className={`avatar small ${colors[colorIndex]}`}>{initials}</span>
                <span className="recent-patient-info">
                  <strong>{patient.name}</strong>
                  <span>{patient.lastComplaint || 'Check-up'}</span>
                </span>
              </button>
              <button
                className="quick-visit-btn"
                onClick={() => navigate('/new-visit', { state: { selectedStudent: patient } })}
                aria-label={`Start quick visit for ${patient.name}`}
                title="Quick visit"
              >
                <Stethoscope size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
