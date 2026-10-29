import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { consultationReportReturn } from './utils/consultationReport.js';
import StartupScreen from './components/StartupScreen';
import { useClinicData } from './hooks/useClinicData';
import { CLINIC_DATA_SLOW_NOTICE_MS } from './utils/api';
import { canShowNurseDashboardBootstrap, isDashboardBootstrapEntryPath } from './utils/dashboardBootstrap.js';
import { getCurrentUser, logoutUser } from './utils/auth';

const MainLayout = lazy(() => import('./layouts/MainLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/Students'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const VisitPrint = lazy(() => import('./pages/VisitPrint'));
const NewVisit = lazy(() => import('./pages/NewVisit'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const GuardianRequests = lazy(() => import('./pages/GuardianRequests'));
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const PortalDashboard = lazy(() => import('./pages/PortalDashboard'));
const PortalAccount = lazy(() => import('./pages/PortalAccount'));
const PortalVisits = lazy(() => import('./pages/PortalVisits'));
const GuardianHealthRecords = lazy(() => import('./pages/GuardianHealthRecords'));
const HealthRecordReview = lazy(() => import('./pages/HealthRecordReview'));
const Appointments = lazy(() => import('./pages/Appointments'));
const Incidents = lazy(() => import('./pages/Incidents.jsx'));
const ContentManagement = lazy(() => import('./pages/ContentManagement.jsx'));

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('schoolcare-theme') === 'dark');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [clinicLoadSlow, setClinicLoadSlow] = useState(false);
  const logoutInFlightRef = useRef(false);
  const location = useLocation();
  const dashboardFirstRef = useRef(isDashboardBootstrapEntryPath(location.pathname));
  const [data, setData, clinic] = useClinicData(user, { dashboardFirst: dashboardFirstRef.current });

  useEffect(() => {
    setClinicLoadSlow(false);
    if (!user || !clinic.loading) {
      return undefined;
    }
    const timer = window.setTimeout(() => setClinicLoadSlow(true), CLINIC_DATA_SLOW_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [clinic.loading, user, user?.id, user?.role]);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((error) => setAuthError(error.message))
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    if (logoutInFlightRef.current) return false;
    logoutInFlightRef.current = true;
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logoutUser();
      setUser(null);
      return true;
    } catch {
      setLogoutError('Could not confirm sign-out. Check your connection and try again.');
      return false;
    } finally {
      logoutInFlightRef.current = false;
      setLoggingOut(false);
    }
  };

  const updateTheme = (value) => {
    setDark(value);
    localStorage.setItem('schoolcare-theme', value ? 'dark' : 'light');
  };

  const legacySchoolSettings = location.pathname === '/school-clinic'
    || (location.pathname === '/settings' && new URLSearchParams(location.search).get('tab') === 'school');
  if (legacySchoolSettings) return <Navigate to="/cms" replace />;

  if (authLoading) return <StartupScreen state="session" dark={dark} />;
  if (location.pathname === '/landing-preview') {
    return <Suspense fallback={<StartupScreen state="session" dark={dark} />}><Home /></Suspense>;
  }
  if (!user) {
    const legacyActivation = location.pathname === '/' && new URLSearchParams(location.search).has('activate');
    if (legacyActivation) {
      return <Navigate to={{ pathname: '/login', search: location.search, hash: location.hash }} replace />;
    }
    if (location.pathname === '/') {
      return <Suspense fallback={<StartupScreen state="session" dark={dark} />}><Home authError={authError} /></Suspense>;
    }
    if (location.pathname === '/login') {
      return <Suspense fallback={<StartupScreen state="session" dark={dark} />}><Login onLogin={setUser} authError={authError} /></Suspense>;
    }

    return (
      <Navigate
        to="/login"
        replace
        state={{ from: { pathname: location.pathname, search: location.search, hash: location.hash } }}
      />
    );
  }
  if (!['guardian', 'school_nurse', 'system_administrator'].includes(user.role)) {
    return <StartupScreen state="unsupported" user={user} dark={dark} logoutError={logoutError} signingOut={loggingOut} onSignOut={handleLogout} />;
  }
  const isNurse = user.role === 'school_nurse';
  const isAdmin = user.role === 'system_administrator';
  const canShowDashboardBootstrap = canShowNurseDashboardBootstrap({
    role: user.role,
    pathname: location.pathname,
    loading: clinic.loading,
    error: clinic.error,
    dashboardData: clinic.dashboardData,
  });
  if (!clinic.ready && !clinic.hasData && !canShowDashboardBootstrap) {
    return (
      <StartupScreen
        state={clinic.error ? 'error' : 'loading'}
        user={user}
        dark={dark}
        slow={clinicLoadSlow && !clinic.error}
        error={clinic.error}
        logoutError={logoutError}
        signingOut={loggingOut}
        onRetry={clinic.reload}
        onSignOut={handleLogout}
      />
    );
  }

  const pageData = clinic.hasData ? data : clinic.dashboardData;
  const documentMatch = isNurse ? (matchPath('/students/:studentId/visits/:visitId/print', location.pathname) || matchPath('/students/:studentId/passes/:passType', location.pathname)) : null;
  let documentBackground = null;
  if (documentMatch) {
    const profilePath = `/students/${encodeURIComponent(documentMatch.params.studentId)}`;
    const provided = location.state?.backgroundLocation;
    if (provided && [profilePath, '/reports'].includes(provided.pathname)) documentBackground = provided;
    else {
      const fromReports = new URLSearchParams(location.search).get('from') === 'reports';
      const backUrl = fromReports ? consultationReportReturn(documentMatch.params.studentId, documentMatch.params.visitId) : profilePath;
      const split = backUrl.indexOf('?');
      documentBackground = { pathname: split < 0 ? backUrl : backUrl.slice(0, split), search: split < 0 ? '' : backUrl.slice(split), hash: '', state: null, key: 'document-background' };
    }
  }
  const layout = (
    <MainLayout
      settings={pageData.settings}
      dark={dark}
      setDark={updateTheme}
      user={user}
      onLogout={handleLogout}
      logoutError={logoutError}
      data={pageData}
    />
  );

  return (
    <>
      {(clinic.error || clinic.saving) && <div className={`connection-banner ${clinic.error ? 'error' : ''}`} role="status">{clinic.error || 'Saving changes…'}</div>}
      <Suspense fallback={<StartupScreen state="loading" user={user} dark={dark} />}>
      <Routes location={documentBackground || location}>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={layout}>
          {isNurse ? (
            <>
              <Route path="/" element={<Dashboard data={pageData} user={user} />} />
              <Route path="/students" element={<Students data={pageData} setData={setData} commitData={clinic.commitData} reload={clinic.reload} />} />
              <Route path="/students/new" element={<Students data={pageData} setData={setData} commitData={clinic.commitData} reload={clinic.reload} registrationType="student" />} />
              <Route path="/faculty/new" element={<Students data={pageData} setData={setData} commitData={clinic.commitData} reload={clinic.reload} registrationType="faculty" />} />
              <Route path="/students/:studentId" element={<StudentProfile data={pageData} commitData={clinic.commitData} reload={clinic.reload} />} />
              <Route path="/health-record-review" element={<HealthRecordReview data={pageData} />} />
              <Route path="/students/:studentId/visits/:visitId/print" element={<VisitPrint data={pageData} user={user} />} />
              <Route path="/students/:studentId/passes/:passType" element={<VisitPrint data={pageData} user={user} />} />
              <Route path="/new-visit" element={<NewVisit data={pageData} user={user} refreshInBackground={clinic.refreshInBackground} />} />
              <Route path="/inventory" element={<Inventory data={pageData} applyServerData={clinic.applyServerData} reload={clinic.reload} saving={clinic.saving} />} />
              <Route path="/reports" element={<Reports data={pageData} user={user} />} />
              <Route path="/appointments" element={<Appointments data={pageData} user={user} reload={clinic.reload} />} />
              <Route path="/incidents" element={<Incidents data={pageData} user={user} />} />
              <Route path="/data-imports" element={<NurseSettingsEntry data={pageData} user={user} reload={clinic.refreshInBackground} section="data" />} />
              <Route path="/risk-rules" element={<NurseSettingsEntry data={pageData} user={user} reload={clinic.reload} section="risk" />} />
              <Route path="/settings" element={<NurseSettingsEntry data={pageData} user={user} reload={clinic.reload} section="account" />} />
            </>
          ) : isAdmin ? (
            <>
              <Route path="/" element={<Dashboard data={pageData} user={user} />} />
              <Route path="/reports" element={<Reports data={pageData} user={user} />} />
              <Route path="/incidents" element={<Navigate to="/" replace />} />
              <Route path="/guardian-requests" element={<GuardianRequests data={pageData} />} />
              <Route path="/users" element={<Settings data={pageData} user={user} reload={clinic.reload} section="users" />} />
              <Route path="/data-imports" element={<Settings data={pageData} user={user} reload={clinic.refreshInBackground} section="data" />} />
              <Route path="/communications" element={<Settings data={pageData} user={user} reload={clinic.reload} section="notifications" />} />
              <Route path="/risk-rules" element={<Settings data={pageData} user={user} reload={clinic.reload} section="risk" />} />
              <Route path="/security" element={<Settings data={pageData} user={user} reload={clinic.reload} section="security" />} />
              <Route path="/cms" element={<ContentManagement />} />
              <Route path="/settings" element={<AdminSettingsEntry data={pageData} user={user} reload={clinic.reload} />} />
            </>
          ) : (
            <>
              <Route path="/" element={<PortalDashboard data={pageData} user={user} />} />
              <Route path="/health-records" element={<GuardianHealthRecords />} />
              <Route path="/health-records/:patientId" element={<GuardianHealthRecords />} />
              <Route path="/profiles" element={<Navigate to="/health-records" replace />} />
              <Route path="/profiles/:patientId" element={<GuardianHealthRecords />} />
              <Route path="/visits" element={<PortalVisits data={pageData} user={user} />} />
              <Route path="/visits/:visitId" element={<PortalVisits data={pageData} user={user} />} />
              <Route path="/appointments" element={<Appointments data={pageData} user={user} reload={clinic.reload} />} />
              <Route path="/incidents" element={<Incidents data={pageData} user={user} />} />
              <Route path="/settings" element={<PortalAccount user={user} onPasswordChanged={() => setUser(null)} />} />
            </>
          )}
          <Route path="/immunizations" element={<Navigate to={isNurse ? '/students' : isAdmin ? '/' : '/health-records'} replace />} />
          <Route path="/queue" element={<Navigate to={isNurse ? '/new-visit' : isAdmin ? '/' : '/appointments'} replace />} />
          <Route path="/health-screening" element={<Navigate to={isNurse ? '/students' : isAdmin ? '/' : '/health-records'} replace />} />
          <Route path="/incident-reports" element={<Navigate to={isAdmin ? '/' : '/incidents'} replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {documentBackground && <Routes location={location}><Route path="/students/:studentId/visits/:visitId/print" element={<VisitPrint data={pageData} user={user} />} /><Route path="/students/:studentId/passes/:passType" element={<VisitPrint data={pageData} user={user} />} /></Routes>}
      </Suspense>
    </>
  );
}


function AdminSettingsEntry({ data, user, reload }) {
  const location = useLocation();
  const legacyTab = new URLSearchParams(location.search).get('tab');
  const legacyDestinations = {
    account: '/settings',
    users: '/users',
    data: '/data-imports',
    notifications: '/communications',
    risk: '/risk-rules',
    security: '/security',
    school: '/cms',
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
