import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import StudentRegistration from './pages/StudentRegistration';
import NewVisit from './pages/NewVisit';
import Immunizations from './pages/Immunizations';
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
  if (!['student', 'guardian', 'school_nurse', 'system_administrator'].includes(user.role)) return <div className="loading-screen"><p role="alert">This account has no supported HealthMate+ role.</p><button className="primary-btn" onClick={handleLogout}>Sign out</button></div>;
  if (!clinic.ready) return (
    <div className="loading-screen">
      {clinic.error ? <><p role="alert">Authorized clinic records could not be loaded. {clinic.error}</p><button className="primary-btn" onClick={clinic.reload}>Try again</button></> : 'Loading authorized clinic records…'}
    </div>
  );

  const isNurse = user.role === 'school_nurse';
  const isAdmin = user.role === 'system_administrator';
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
          {isNurse ? (
            <>
              <Route path="/" element={<Dashboard data={data} user={user} />} />
              <Route path="/students" element={<Students data={data} setData={setData} />} />
              <Route path="/students/new" element={<StudentRegistration data={data} commitData={clinic.commitData} />} />
              <Route path="/students/:studentId" element={<StudentProfile data={data} commitData={clinic.commitData} reload={clinic.reload} />} />
              <Route path="/new-visit" element={<NewVisit data={data} user={user} reload={clinic.reload} />} />
              <Route path="/immunizations" element={<Immunizations data={data} commitData={clinic.commitData} />} />
              <Route path="/queue" element={<Queue data={data} reload={clinic.reload} />} />
              <Route path="/inventory" element={<Inventory data={data} applyServerData={clinic.applyServerData} reload={clinic.reload} saving={clinic.saving} />} />
              <Route path="/reports" element={<Reports user={user} />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
              <Route path="/settings" element={<Settings data={data} user={user} reload={clinic.reload} />} />
            </>
          ) : isAdmin ? (
            <>
              <Route path="/" element={<Dashboard data={data} user={user} />} />
              <Route path="/reports" element={<Reports user={user} />} />
              <Route path="/settings" element={<Settings data={data} user={user} reload={clinic.reload} />} />
            </>
          ) : (
            <>
              <Route path="/" element={<PortalDashboard data={data} user={user} />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
            </>
          )}
          <Route path="/health-screening" element={<Navigate to="/" replace />} />
          <Route path="/incident-reports" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
