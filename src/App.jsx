import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import StudentRegistration from './pages/StudentRegistration';
import FacultyRegistration from './pages/FacultyRegistration';
import NewVisit from './pages/NewVisit';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Home from './pages/Home';
import Login from './pages/Login';
import PortalDashboard from './pages/PortalDashboard';
import PortalAccount from './pages/PortalAccount';
import PortalProfiles from './pages/PortalProfiles';
import PortalVisits from './pages/PortalVisits';
import Appointments from './pages/Appointments';
import { useClinicData } from './hooks/useClinicData';
import { getCurrentUser, logoutUser } from './utils/auth';

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('schoolcare-theme') === 'dark');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [data, setData, clinic] = useClinicData(user);
  const location = useLocation();

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
  if (!user) {
    const legacyActivation = location.pathname === '/' && new URLSearchParams(location.search).has('activate');
    if (legacyActivation) {
      return <Navigate to={{ pathname: '/login', search: location.search, hash: location.hash }} replace />;
    }
    if (location.pathname === '/') return <Home authError={authError} />;
    if (location.pathname === '/login') return <Login onLogin={setUser} authError={authError} />;

    return (
      <Navigate
        to="/login"
        replace
        state={{ from: { pathname: location.pathname, search: location.search, hash: location.hash } }}
      />
    );
  }
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
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={layout}>
          {isNurse ? (
            <>
              <Route path="/" element={<Dashboard data={data} user={user} />} />
              <Route path="/students" element={<Students data={data} setData={setData} />} />
              <Route path="/students/new" element={<StudentRegistration data={data} commitData={clinic.commitData} />} />
              <Route path="/faculty/new" element={<FacultyRegistration data={data} reload={clinic.reload} />} />
              <Route path="/students/:studentId" element={<StudentProfile data={data} commitData={clinic.commitData} reload={clinic.reload} />} />
              <Route path="/new-visit" element={<NewVisit data={data} user={user} reload={clinic.reload} refreshInBackground={clinic.refreshInBackground} />} />
              <Route path="/inventory" element={<Inventory data={data} applyServerData={clinic.applyServerData} reload={clinic.reload} saving={clinic.saving} />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
              <Route path="/data-imports" element={<NurseSettingsEntry data={data} user={user} reload={clinic.reload} section="data" />} />
              <Route path="/risk-rules" element={<NurseSettingsEntry data={data} user={user} reload={clinic.reload} section="risk" />} />
              <Route path="/settings" element={<NurseSettingsEntry data={data} user={user} reload={clinic.reload} section="account" />} />
            </>
          ) : isAdmin ? (
            <>
              <Route path="/" element={<Dashboard data={data} user={user} />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/users" element={<Settings data={data} user={user} reload={clinic.reload} section="users" />} />
              <Route path="/school-clinic" element={<Settings data={data} user={user} reload={clinic.reload} section="school" />} />
              <Route path="/data-imports" element={<Settings data={data} user={user} reload={clinic.reload} section="data" />} />
              <Route path="/communications" element={<Settings data={data} user={user} reload={clinic.reload} section="notifications" />} />
              <Route path="/risk-rules" element={<Settings data={data} user={user} reload={clinic.reload} section="risk" />} />
              <Route path="/security" element={<Settings data={data} user={user} reload={clinic.reload} section="security" />} />
              <Route path="/settings" element={<AdminSettingsEntry data={data} user={user} reload={clinic.reload} />} />
            </>
          ) : (
            <>
              <Route path="/" element={<PortalDashboard data={data} user={user} />} />
              <Route path="/profiles" element={<PortalProfiles data={data} user={user} />} />
              <Route path="/profiles/:patientId" element={<PortalProfiles data={data} user={user} />} />
              <Route path="/visits" element={<PortalVisits data={data} user={user} />} />
              <Route path="/visits/:visitId" element={<PortalVisits data={data} user={user} />} />
              <Route path="/appointments" element={<Appointments data={data} user={user} reload={clinic.reload} />} />
              <Route path="/settings" element={<PortalAccount user={user} onPasswordChanged={() => setUser(null)} />} />
            </>
          )}
          <Route path="/immunizations" element={<Navigate to={isNurse ? '/students' : isAdmin ? '/' : '/profiles'} replace />} />
          <Route path="/queue" element={<Navigate to={isNurse ? '/new-visit' : isAdmin ? '/' : '/appointments'} replace />} />
          <Route path="/health-screening" element={<Navigate to={isNurse ? '/students' : isAdmin ? '/' : '/profiles'} replace />} />
          <Route path="/incident-reports" element={<Navigate to={isNurse ? '/students' : isAdmin ? '/' : '/profiles'} replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

function AdminSettingsEntry({ data, user, reload }) {
  const location = useLocation();
  const legacyTab = new URLSearchParams(location.search).get('tab');
  const legacyDestinations = {
    account: '/settings',
    users: '/users',
    school: '/school-clinic',
    data: '/data-imports',
    notifications: '/communications',
    risk: '/risk-rules',
    security: '/security',
  };

  if (legacyTab) {
    return <Navigate to={legacyDestinations[legacyTab] || '/settings'} replace />;
  }

  return <Settings data={data} user={user} reload={reload} section="account" />;
}

function NurseSettingsEntry({ data, user, reload, section }) {
  const location = useLocation();
  const legacyTab = new URLSearchParams(location.search).get('tab');
  const legacyDestinations = {
    account: '/settings',
    data: '/data-imports',
    risk: '/risk-rules',
    notifications: '/',
    reports: '/reports',
    inventory: '/inventory',
    'inventory-requests': '/inventory',
    schedule: '/appointments',
  };

  if (legacyTab) {
    const destination = legacyDestinations[legacyTab] || '/settings';
    return <Navigate to={destination} replace state={legacyTab === 'notifications' ? { openNotifications: true } : undefined} />;
  }

  return <Settings data={data} user={user} reload={reload} section={section} />;
}
