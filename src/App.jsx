import { useState, useEffect } from 'react';
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
import { loadData } from './db/database';
import { validateSession, logSecurityEvent } from './utils/auth';

/**
 * Main App component - School Health Clinic Management System
 * Manages authentication, theme preference, data state, and routing
 */
export default function App() {
  const [data, setData] = useState(loadData);
  const [dark, setDark] = useState(() => localStorage.getItem('schoolcare-theme') === 'dark');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * Initialize app: restore user session and theme preference
   * Validates session expiry and clears expired sessions
   */
  useEffect(() => {
    try {
      const session = localStorage.getItem('schoolcare-session') || sessionStorage.getItem('schoolcare-session');
      if (session) {
        const userData = JSON.parse(session);
        
        // Use the new validation from auth utilities
        const validation = validateSession(userData);
        
        if (validation.valid) {
          setUser(userData);
        } else {
          console.log('Session invalid:', validation.reason);
          localStorage.removeItem('schoolcare-session');
          logSecurityEvent('SESSION_INVALID', { reason: validation.reason });
        }
      }
    } catch (error) {
      console.warn('Failed to restore session:', error);
      localStorage.removeItem('schoolcare-session');
      logSecurityEvent('SESSION_RESTORE_ERROR', { error: error.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogin = (sessionData, rememberMe = true) => {
    setUser(sessionData);
    try {
      const storage = rememberMe ? localStorage : sessionStorage;
      const alternateStorage = rememberMe ? sessionStorage : localStorage;
      storage.setItem('schoolcare-session', JSON.stringify(sessionData));
      alternateStorage.removeItem('schoolcare-session');
      logSecurityEvent('SESSION_CREATED', { username: sessionData.username, rememberMe });
    } catch (error) {
      console.error('Failed to save session:', error);
      logSecurityEvent('SESSION_SAVE_ERROR', { error: error.message });
    }
  };

  const handleLogout = () => {
    logSecurityEvent('LOGOUT', { username: user?.username });
    setUser(null);
    try {
      localStorage.removeItem('schoolcare-session');
      sessionStorage.removeItem('schoolcare-session');
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  };

  const updateTheme = (value) => {
    setDark(value);
    try {
      localStorage.setItem('schoolcare-theme', value ? 'dark' : 'light');
    } catch (error) {
      console.error('Failed to save theme preference:', error);
    }
  };

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Routes>
      <Route
        element={
          <MainLayout
            settings={data.settings}
            dark={dark}
            setDark={updateTheme}
            user={user}
            onLogout={handleLogout}
            data={data}
          />
        }
      >
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
        <Route path="/settings" element={<Settings data={data} setData={setData} user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
