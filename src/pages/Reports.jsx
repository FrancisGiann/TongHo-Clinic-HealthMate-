import { BarChart3, Download, FileText, PieChart } from "lucide-react";
export default function Reports({ data }) {
  const exportReport = () => window.print();
  const complaintCounts = data.visits.reduce(
    (counts, visit) => ({
      ...counts,
      [visit.chiefComplaint]: (counts[visit.chiefComplaint] || 0) + 1,
    }),
    {},
  );
  const topComplaint =
    Object.entries(complaintCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "None";
  const gradeCounts = data.students.reduce(
    (counts, student) => ({
      ...counts,
      [student.gradeLevel]: (counts[student.gradeLevel] || 0) + 1,
    }),
    {},
  );
  
  // Calculate screening statistics
  const totalStudents = data.students.length;
  const screenedStudents = (data.screenings || []).length;
  const screeningPercentage = totalStudents > 0 
    ? Math.round((screenedStudents / totalStudents) * 100) 
    : 0;
  
  // Calculate immunization statistics
  const immunizedStudents = (data.immunizations || []).filter(
    imm => imm.remarks?.toLowerCase().includes('complete') || imm.remarks?.toLowerCase().includes('up to date')
  ).length;
  const immunizationPercentage = totalStudents > 0 
    ? Math.round((immunizedStudents / totalStudents) * 100) 
    : 0;
  const incidents = data.incidents || [];
  const getStudentName = (studentId) =>
    data.students.find((student) => student.id === studentId)?.name || "Unknown student";
  
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Clinic intelligence</p>
          <h2>Reports & insights</h2>
          <p>Understand the patterns behind your clinic’s daily work.</p>
        </div>
        <button className="secondary-btn" onClick={exportReport}>
          <Download size={16} /> Export report
        </button>
      </div>
      <div className="report-kpis">
        <div>
          <span>Visits this period</span>
          <strong>{data.visits.length}</strong>
          <small>{data.visits.length > 0 ? 'Today' : 'No visits yet'}</small>
        </div>
        <div>
          <span>Top complaint</span>
          <strong className="report-word">{topComplaint}</strong>
          <small>Most recorded concern</small>
        </div>
        <div>
          <span>Students screened</span>
          <strong>{screeningPercentage}%</strong>
          <small>{screenedStudents} of {totalStudents} students</small>
        </div>
        <div>
          <span>Immunization rate</span>
          <strong>{immunizationPercentage}%</strong>
          <small>{immunizedStudents} of {totalStudents} complete</small>
        </div>
      </div>
      <div className="reports-grid">
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Visit volume</p>
              <h3>Visits by day</h3>
            </div>
            <BarChart3 size={19} className="chart-icon" />
          </div>
          <div className="report-bars">
            {[0, 0, 0, 0, 0, 0, 0].map((value, index) => {
              // In a real app, calculate actual daily visits
              // For now, show today's visits in the current day
              const today = new Date().getDay();
              const todayIndex = today === 0 ? 6 : today - 1;
              const barValue = index === todayIndex ? data.visits.length : 0;
              return (
                <div key={index}>
                  <span style={{ height: `${barValue * 4}px` }} />
                  <small>
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}
                  </small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Common concerns</p>
              <h3>Top complaints</h3>
            </div>
            <PieChart size={19} className="chart-icon" />
          </div>
          <div className="complaint-list">
            {Object.entries(complaintCounts).map(
              ([complaint, count], index) => (
                <div key={complaint}>
                  <i className={`legend-dot dot-${index}`} />
                  <span>{complaint}</span>
                  <strong>{count}</strong>
                  <em
                    style={{ width: `${(count / data.visits.length) * 100}%` }}
                  />
                </div>
              ),
            )}
          </div>
        </section>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Student distribution</p>
            <h3>Visits by grade level</h3>
          </div>
          <button className="text-btn" onClick={exportReport}>
            <FileText size={15} /> Print view
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Grade level</th>
              <th>Registered students</th>
              <th>Share of student body</th>
              <th>Visits</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(gradeCounts).map(([grade, count]) => (
              <tr key={grade}>
                <td>
                  <strong>{grade}</strong>
                </td>
                <td>{count}</td>
                <td>{Math.round((count / data.students.length) * 100)}%</td>
                <td>
                  {
                    data.visits.filter(
                      (visit) =>
                        data.students.find((s) => s.id === visit.studentId)
                          ?.gradeLevel === grade,
                    ).length
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel table-panel incident-report-summary">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Safety & documentation</p>
            <h3>Incident reports</h3>
          </div>
          <strong className="report-count">{incidents.length} recorded</strong>
        </div>
        {incidents.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Date</th>
                <th>Type</th>
                <th>Location</th>
                <th>Severity</th>
                <th>Parent notified</th>
              </tr>
            </thead>
            <tbody>
              {[...incidents].reverse().map((incident) => (
                <tr key={incident.id}>
                  <td><strong>{getStudentName(incident.studentId)}</strong></td>
                  <td>{incident.date ? new Date(incident.date).toLocaleString() : "—"}</td>
                  <td>{incident.type || "—"}</td>
                  <td>{incident.location || "—"}</td>
                  <td><span className={`status-chip ${incident.severity === "Critical" || incident.severity === "Severe" ? "danger" : incident.severity === "Moderate" ? "warn" : "neutral"}`}>{incident.severity || "—"}</span></td>
                  <td>{incident.parentNotified ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-state">No incident reports have been recorded yet.</p>
        )}
      </section>
    </div>
  );
}
