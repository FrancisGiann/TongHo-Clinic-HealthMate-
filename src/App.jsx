import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import StudentRegistration from './pages/StudentRegistration';
import NewVisit from './pages/NewVisit';
import HealthScreening from './pages/HealthScreening';
import Immunizations from './pages/Immunizations';
import IncidentReport from './pages/IncidentReport';
import Queue from './pages/Queue';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';
import PortalDashboard from './pages/PortalDashboard';
import Appointments from './pages/Appointments';
import { useClinicData } from './hooks/useClinicData';
import { getCurrentUser, logoutUser } from './utils/auth';

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('schoolcare-theme') === 'dark');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [data, setData, clinic] = useClinicData(user);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((error) => setAuthError(error.message))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    await logoutUser().catch(() => {});
    setUser(null);
  };

  const updateTheme = (value) => {
    setDark(value);
    localStorage.setItem('schoolcare-theme', value ? 'dark' : 'light');
  };

  if (authLoading) return <div className="loading-screen">Checking secure session…</div>;
  if (!user) return <><Login onLogin={setUser} />{authError && <div className="connection-banner" role="alert">{authError}</div>}</>;
  if (clinic.loading) return <div className="loading-screen">Loading clinic records…</div>;

  const staff = ['school_nurse', 'system_administrator'].includes(user.role);
  const layout = (
    <MainLayout
      settings={data.settings}
      dark={dark}
      setDark={updateTheme}
      user={user}
      onLogout={handleLogout}
      data={data}
    />
  );

  return (
    <>
      {(clinic.error || clinic.saving) && <div className={`connection-banner ${clinic.error ? 'error' : ''}`} role="status">{clinic.error || 'Saving changes…'}</div>}
      <Routes>
        <Route element={layout}>
          {staff ? (
            <>
              <Route path="/" element={<Dashboard data={data} user={user} />} />
              <Route path="/students" element={<Students data={data} setData={setData} />} />
              <Route path="/students/new" element={<StudentRegistration data={data} setData={setData} />} />
              <Route path="/students/:studentId" element={<StudentProfile data={data} setData={setData} />} />
              <Route path="/new-visit" element={<NewVisit data={data} setData={setData} />} />
              <Route path="/health-screening" element={<HealthScreening data={data} setData={setData} />} />
              <Route path="/immunizations" element={<Immunizations data={data} setData={setData} />} />
              <Route path="/incident-reports" element={<IncidentReport data={data} setData={setData} />} />
              <Route path="/queue" element={<Queue data={data} setData={setData} />} />
              <Route path="/inventory" element={<Inventory data={data} setData={setData} />} />
              <Route path="/reports" element={<Reports data={data} />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
              <Route path="/settings" element={<Settings data={data} setData={setData} user={user} />} />
            </>
          ) : (
            <>
              <Route path="/" element={<PortalDashboard data={data} user={user} />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
