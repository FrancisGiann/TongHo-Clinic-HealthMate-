import { useRef, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Check, Database, Download, Lock, RotateCcw, Save, ShieldCheck, Upload, X, UserCog, Bell, SlidersHorizontal, FileBarChart, Building2, KeyRound } from "lucide-react";
import { downloadCsv, parseCsv, validateStudentImport } from "../utils/csv";
import { api } from "../utils/api";
import {
  getAuditLogs,
  getUsersForAdmin,
  createManagedUser,
  resendInvitation,
  updateUserStatus,
  updateMfaPreference,
  changePassword,
  authenticateUser,
} from "../utils/auth";

const auditEventMeta = {
  LOGIN_SUCCESS: { label: "Signed in", tone: "positive", group: "Access" },
  LOGIN_FAILED: { label: "Failed sign-in", tone: "critical", group: "Access" },
  LOGOUT: { label: "Signed out", tone: "neutral", group: "Access" },
  MFA_SETTING_UPDATED: { label: "MFA preference changed", tone: "security", group: "Security" },
  PASSWORD_RESET_REQUESTED: { label: "Password reset requested", tone: "security", group: "Security" },
  PASSWORD_RESET_COMPLETED: { label: "Password reset completed", tone: "positive", group: "Security" },
  ACCOUNT_APPROVED: { label: "Staff account approved", tone: "positive", group: "People" },
  ACCOUNT_REJECTED: { label: "Staff account rejected", tone: "critical", group: "People" },
  NURSE_ACCOUNT_CREATED: { label: "Staff account created", tone: "security", group: "People" },
  NOTIFICATION_BROADCAST_STARTED: { label: "Clinic notice started", tone: "neutral", group: "Notifications" },
  NOTIFICATION_BROADCAST_COMPLETED: { label: "Clinic notice completed", tone: "positive", group: "Notifications" },
};

const getAuditMeta = (event) => auditEventMeta[event] || { label: event.replaceAll('_', ' '), tone: 'neutral', group: 'System' };

const getAuditSubject = (entry) => {
  const details = entry.details || {};
  return details.username || details.email || details.approvedBy || 'System activity';
};

const broadcastRoleOptions = [
  ['school_nurse', 'Nurses'],
  ['student', 'Students'],
  ['guardian', 'Guardians'],
  ['system_administrator', 'Administrators'],
];
const newBroadcastRequestId = () => {
  const cryptoApi = window.crypto;
  if (cryptoApi.randomUUID) return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export default function Settings({ data, user, reload }) {
  const location = useLocation();
  const [form, setForm] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(user?.mfaEnabled));
  const [reviewMessage, setReviewMessage] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const [broadcastForm, setBroadcastForm] = useState({ type: 'announcement', subject: '', body: '', roles: [] });
  const [broadcastRequestId, setBroadcastRequestId] = useState(newBroadcastRequestId);
  const [broadcastConfirmed, setBroadcastConfirmed] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState(null);
  const [riskRules, setRiskRules] = useState([]);
  const [demonstrationRules, setDemonstrationRules] = useState(null);
  const [riskRuleForm, setRiskRuleForm] = useState({ version: '', name: '', rules: '' });
  const [riskMessage, setRiskMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const isAdmin = user?.role === 'system_administrator';
  const [activeTab, setActiveTab] = useState(isAdmin ? 'account' : 'account');
  const [users, setUsers] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
  const studentFileInput = useRef(null);

  useEffect(() => {
    setMfaEnabled(Boolean(user?.mfaEnabled));
    api.get('/api/risk/rules').then((ruleData) => {
      setRiskRules(ruleData.rules || []);
      setDemonstrationRules(ruleData.demonstrationRules || null);
    }).catch(() => {
      setRiskRules([]);
      setDemonstrationRules(null);
    });
    if (!isAdmin) return;
    Promise.all([getAuditLogs(), getUsersForAdmin()]).then(([logs, accounts]) => {
      setPendingRegistrations(accounts.filter((account) => account.status === 'invited' && account.role === 'school_nurse'));
      setAuditLogs(logs.slice(0, 8));
      setUsers(accounts);
    });
  }, [user, isAdmin]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    const allowedTabs = user?.role === 'system_administrator'
      ? ['account', 'users', 'school', 'data', 'notifications', 'security', 'risk']
      : ['account', 'schedule', 'notifications', 'inventory', 'reports', 'risk'];
    if (requestedTab && allowedTabs.includes(requestedTab)) setActiveTab(requestedTab);
  }, [location.search, user?.role]);

  const handleAuth = (e) => {
    e.preventDefault();
    setAuthError("");

    if (!isAdmin) {
      setAuthError('Administrator access is required for these settings.');
      return;
    }

    authenticateUser(user.username, password).then((result) => {
      if (result.success && result.user.role === 'system_administrator') {
      setIsAuthorized(true);
      setShowAuthModal(false);
      sessionStorage.setItem('settings-auth', JSON.stringify({
        timestamp: Date.now(),
        authorized: true,
        username: user.username
      }));
      } else {
        setAttempts((current) => {
          const nextAttempts = current + 1;
          setAuthError(`${result.error || 'Incorrect password.'} ${nextAttempts >= 3 ? 'Access denied.' : 'Please try again.'}`);
          return nextAttempts;
        });
        setPassword("");

        if (attempts >= 2) {
          setTimeout(() => {
            window.history.back();
          }, 2000);
        }
      }
    }).catch(() => {
      setAuthError('Unable to verify administrator access. Please try again.');
      setPassword('');
    });
  };

  const handleMfaToggle = async () => {
    if (!user?.username) return;

    const nextValue = !mfaEnabled;
    const result = await updateMfaPreference(nextValue);

    if (result.success) {
      setMfaEnabled(nextValue);
      setReviewMessage(result.message);
      setTimeout(() => setReviewMessage(""), 2500);
    }
  };
  const handlePasswordChange = async () => {
    if (newPasswordValue !== confirmPassword) return setReviewMessage('New passwords do not match.');
    const result = await changePassword(user?.username, currentPassword, newPasswordValue);
    setReviewMessage(result.success ? result.message : result.error);
    if (result.success) {
      setCurrentPassword('');
      setNewPasswordValue('');
      setConfirmPassword('');
    }
  };

  const refreshReviewData = async () => {
    const [logs, accounts] = await Promise.all([getAuditLogs(), getUsersForAdmin()]);
    setPendingRegistrations(accounts.filter((account) => account.status === 'invited' && account.role === 'school_nurse'));
    setAuditLogs(logs.slice(0, 8));
    setUsers(accounts);
  };

  const handleApprove = async (username) => {
    const account = users.find((entry) => entry.username === username);
    const result = account ? await updateUserStatus(account.id, 'active') : { success: false, error: 'Invitation not found.' };
    setReviewMessage(result.success ? `${account.name} is now active.` : result.error);
    await refreshReviewData();
  };

  const handleReject = async (username) => {
    const account = users.find((entry) => entry.username === username);
    const result = account ? await updateUserStatus(account.id, 'deactivated') : { success: false, error: 'Invitation not found.' };
    setReviewMessage(result.success ? `${account.name} was deactivated.` : result.error);
    await refreshReviewData();
  };
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = async () => {
    setReviewMessage('');
    try {
      const result = await api.patch('/api/admin/settings/clinic', form);
      setForm(result.settings);
      await reload?.();
      setSaved(true);
    } catch (error) {
      setReviewMessage(error.message);
    }
    setTimeout(() => setSaved(false), 1800);
  };
  const exportOversightSnapshot = () => {
    const snapshot = {
      ...data,
      exportedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `healthmate-oversight-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportData = () => {
    const rows = Object.entries(data).flatMap(([collection, records]) => {
      const values = Array.isArray(records) ? records : [records];
      return values.map((record) => ({ Collection: collection, ...(record || {}) }));
    });
    downloadCsv(`healthmate-records-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };
  const downloadStudentTemplate = () => downloadCsv('healthmate-student-template.csv', [{ 'Student ID': 'PTHI-2026-0001', Name: 'Fictional Student', Grade: 'Grade 4', Section: 'Rizal', Guardian: 'Fictional Guardian', Phone: '' }]);
  const importStudentsCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = validateStudentImport(parseCsv(await file.text()), data.students);
      if (!imported.valid) throw new Error(imported.errors.join(' '));
      const result = await api.post('/api/import/students', { rows: imported.records });
      setReviewMessage(`${result.imported} student records imported.`);
      await reload?.();
    } catch (error) {
      setReviewMessage(error.message || 'Unable to read that CSV file. Check the header row and try again.');
    } finally {
      event.target.value = '';
    }
  };

  const tabs = isAdmin
    ? [
      ['account', 'Account settings', UserCog],
      ['users', 'User management', UserCog],
      ['school', 'School & clinic', Building2],
      ['data', 'Data & reports', FileBarChart],
      ['notifications', 'Notifications', Bell],
      ['security', 'Privacy & security', KeyRound],
      ['risk', 'Risk rules', ShieldCheck],
    ]
    : [
      ['account', 'My account', UserCog],
      ['schedule', 'My schedule', Building2],
      ['notifications', 'My notifications', Bell],
      ['inventory', 'Inventory requests', SlidersHorizontal],
      ['reports', 'My reports', FileBarChart],
      ['risk', 'Risk rules', ShieldCheck],
    ];

  const triggerReminders = async () => {
    setReminderMessage('');
    try {
      const result = await api.post('/api/admin/notifications/reminders', {});
      setReminderMessage(`${result.triggered} due item${result.triggered === 1 ? '' : 's'} processed, including ${result.consents || 0} consent reminder${result.consents === 1 ? '' : 's'}; ${result.notificationFailures || 0} delivery failures. Repeated runs are deduplicated.`);
    } catch (error) {
      setReminderMessage(error.message);
    }
  };
  const updateBroadcastForm = (updates) => {
    setBroadcastForm((current) => ({ ...current, ...updates }));
    setBroadcastRequestId(newBroadcastRequestId());
    setBroadcastConfirmed(false);
    setBroadcastMessage(null);
  };
  const toggleBroadcastRole = (role) => {
    const roles = broadcastForm.roles.includes(role)
      ? broadcastForm.roles.filter((selected) => selected !== role)
      : [...broadcastForm.roles, role];
    updateBroadcastForm({ roles });
  };
  const submitBroadcast = async (event) => {
    event.preventDefault();
    if (broadcastBusy || !broadcastConfirmed || !broadcastForm.subject.trim() || !broadcastForm.body.trim() || !broadcastForm.roles.length) return;
    setBroadcastBusy(true);
    setBroadcastMessage(null);
    try {
      const result = await api.post('/api/admin/notifications/broadcast', { ...broadcastForm, requestId: broadcastRequestId });
      setBroadcastMessage({
        tone: result.emailFailures ? 'error' : 'success',
        text: `Recorded for ${result.recipientCount} active account${result.recipientCount === 1 ? '' : 's'}: ${result.inAppCreated} in-app notices, ${result.emailsSent} emails sent, ${result.emailFailures} email failures, ${result.duplicateEmailNoticesSkipped} duplicate email attempts skipped.${result.emailFailures ? ' No automatic email retry was attempted; check delivery configuration and follow up through the approved clinic channel.' : ''}`,
      });
      setBroadcastForm({ type: 'announcement', subject: '', body: '', roles: [] });
      setBroadcastRequestId(newBroadcastRequestId());
      setBroadcastConfirmed(false);
    } catch (error) {
      setBroadcastMessage({ tone: 'error', text: `${error.message} The same submission key is retained to prevent duplicate delivery; review the result before creating a new notice.` });
    } finally {
      setBroadcastBusy(false);
    }
  };
  const loadRiskRules = async () => {
    const result = await api.get('/api/risk/rules');
    setRiskRules(result.rules || []);
    setDemonstrationRules(result.demonstrationRules || null);
  };
  const createRiskRule = async (event) => {
    event.preventDefault();
    setRiskMessage('');
    try {
      await api.post('/api/risk/rules', { version: Number(riskRuleForm.version), name: riskRuleForm.name, rules: JSON.parse(riskRuleForm.rules) });
      setRiskMessage('Draft risk rules saved. A licensed school nurse must approve the version before use.');
      setRiskRuleForm({ version: '', name: '', rules: '' });
      await loadRiskRules();
    } catch (error) {
      setRiskMessage(error.message.includes('JSON') ? 'Rules must be valid JSON.' : error.message);
    }
  };
  const approveRiskRule = async (rule) => {
    setRiskMessage('');
    try {
      await api.patch(`/api/risk/rules/${encodeURIComponent(rule.id)}/approve`, {});
      setRiskMessage(`Version ${rule.version} approved by your nurse account.`);
      await loadRiskRules();
    } catch (error) {
      setRiskMessage(error.message);
    }
  };
  const handleCreateUser = async (event) => {
    event.preventDefault();
    const result = await createManagedUser(newUser);
    setReviewMessage(result.success ? (result.emailSent === false ? result.message : 'Invitation sent successfully.') : result.error);
    if (result.success) {
      setNewUser({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
      setShowUserForm(false);
      await refreshReviewData();
    }
  };
  const handleUserStatus = async (account) => {
    const result = await updateUserStatus(account.id, account.status === 'active' ? 'deactivated' : 'active');
    setReviewMessage(result.success ? `${account.name} is now ${account.status === 'active' ? 'inactive' : 'active'}.` : result.error);
    await refreshReviewData();
  };
  const handleResendInvitation = async (account) => {
    const result = await resendInvitation(account.id);
    setReviewMessage(result.success ? result.message : result.error);
  };
  
  // If not authorized, show authentication modal
  if (!isAuthorized) {
    return (
      <div className="settings-auth-container">
        {showAuthModal && (
          <div className="modal-backdrop settings-auth-backdrop">
            <form className="auth-modal-card" onSubmit={handleAuth}>
              <div className="auth-modal-header">
                <div className="auth-lock-icon">
                  <Lock size={28} />
                </div>
                <h2>Protected Access</h2>
                <p>Settings contain sensitive information. Please enter your password to continue.</p>
              </div>

              {authError && (
                <div className="auth-error">
                  <span>⚠</span>
                  <p>{authError}</p>
                </div>
              )}

              <div className="auth-input-field">
                <label htmlFor="settings-password">
                  <Lock size={16} />
                  Administrator Password
                </label>
                <input
                  id="settings-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  autoFocus
                  disabled={attempts >= 3}
                />
              </div>

              <div className="auth-actions">
                <button 
                  type="button" 
                  className="secondary-btn" 
                  onClick={() => window.history.back()}
                  disabled={attempts >= 3}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="primary-btn"
                  disabled={attempts >= 3}
                >
                  <Lock size={16} />
                  Authenticate
                </button>
              </div>

              <div className="auth-help">
                <p>Use the password for your administrator account.</p>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Workspace preferences</p>
          <h2>Settings</h2>
          <p>Keep your clinic identity and contact details current.</p>
        </div>
        {isAdmin && activeTab === 'school' && <button className="primary-btn" onClick={save}>
          <Save size={16} /> Save clinic settings
        </button>}
      </div>
      <nav className="settings-tabs" aria-label="Settings sections">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>
      {reviewMessage && <p className="success-message" role="status">{reviewMessage}</p>}

      {activeTab === 'account' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">{isAdmin ? 'Administrator identity' : 'Staff identity'}</p><h3>{isAdmin ? 'Account settings' : 'My account'}</h3></div><span className="settings-badge">{isAdmin ? 'Full access' : 'Clinic staff'}</span></div>
          <div className="profile-settings-grid">
            <div className="profile-photo-placeholder">{(user?.name || 'User').split(' ').map((part) => part[0]).join('').slice(0, 2)}<button type="button" className="secondary-btn" disabled>Profile photo unavailable</button></div>
            <div className="two-fields">
              <label>Full name<input defaultValue={user?.name || ''} disabled /></label>
              <label>Email<input type="email" defaultValue={user?.email || ''} disabled /></label>
              <label>Contact number<input defaultValue={user?.contactNumber || ''} disabled /></label>
              <p className="disabled-note">Profile identity fields are read-only here; use administrator account management for changes.</p>
              <div className="disabled-note"><KeyRound size={14} /> Password changes are protected and require confirmation.</div>
            </div>
          </div>
          <div className="settings-subsection"><h4>Change password</h4><div className="three-fields"><label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input type="password" value={newPasswordValue} onChange={(event) => setNewPasswordValue(event.target.value)} /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></div><button type="button" className="primary-btn" onClick={handlePasswordChange}>Update password</button>{reviewMessage && <p className="success-message">{reviewMessage}</p>}</div>
          <div className="settings-subsection security-row"><div><h4>Two-factor authentication</h4><p>Require a verification code when signing in from a new device.</p></div><button type="button" className={`setting-switch ${mfaEnabled ? 'on' : ''}`} onClick={handleMfaToggle} aria-pressed={mfaEnabled}><span />{mfaEnabled ? 'On' : 'Off'}</button></div>
        </section>
      )}

      {activeTab === 'users' && isAdmin && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">Access control</p><h3>User management</h3></div><button className="primary-btn" onClick={() => setShowUserForm(!showUserForm)}><UserCog size={15} /> Add new user</button></div>
          <p className="tab-description">Manage who can access clinic records. Nurses can be assigned a grade or section after their account is approved.</p>
          {showUserForm && <form className="inline-user-form" onSubmit={handleCreateUser}><label>Name<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} required /></label><label>Email<input type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required /></label><label>Role<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value, patientId: '' })}><option>Admin</option><option>Nurse</option><option>Student</option><option>Guardian</option></select></label>{['Student', 'Guardian'].includes(newUser.role) && <label>Linked patient<select value={newUser.patientId} onChange={(event) => setNewUser({ ...newUser, patientId: event.target.value })} required><option value="">Select patient…</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>}{newUser.role === 'Guardian' && <label>Relationship<input value={newUser.relationship} onChange={(event) => setNewUser({ ...newUser, relationship: event.target.value })} required /></label>}<button type="submit" className="primary-btn">Send invitation</button></form>}
          {reviewMessage && <p className="success-message"><Check size={14} /> {reviewMessage}</p>}
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{users.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small>@{account.username}</small></td><td>{({ system_administrator: 'Admin', school_nurse: 'Nurse', student: 'Student', guardian: 'Guardian' })[account.role] || account.role}</td><td>{account.email}</td><td><span className={`status-chip ${account.status === 'active' ? 'success' : 'warn'}`}>{account.status}</span></td><td>{account.lastLogin ? new Date(account.lastLogin).toLocaleDateString() : 'Never'}</td><td>{account.status === 'invited' ? <button type="button" className="table-action" onClick={() => handleResendInvitation(account)}>Resend invitation</button> : <button type="button" className="table-action" onClick={() => handleUserStatus(account)}>{account.status === 'active' ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {activeTab === 'notifications' && (
        <section className="panel settings-tab-panel narrow-panel">
          <div className="settings-panel-heading">
            <div>
              <h3>{isAdmin ? 'Clinic communications' : 'My notifications'}</h3>
              <p className="field-hint">{isAdmin ? 'Send an announcement or notice to selected active account roles.' : 'Delivery is controlled by saved clinical events and account links.'}</p>
            </div>
          </div>
          <p className="disabled-note">Visit, appointment, follow-up, immunization, recurring-visit, and dated pending-consent reminders are deduplicated by the server. Signed consent forms are not stored here.</p>
          {isAdmin && <>
            <div className="form-actions notification-reminder-action">
              <button type="button" className="secondary-btn" onClick={triggerReminders}><Bell size={15} /> Run due reminders</button>
              <span className="field-hint">Manual trigger for review; automatic reminders use the same rules.</span>
            </div>
            {reminderMessage && <p className="success-message" role="status">{reminderMessage}</p>}
            <form className="inline-entry-form broadcast-form" onSubmit={submitBroadcast}>
              <h4>Compose a clinic notice</h4>
              <div className="two-fields">
                <label>Notice type
                  <select value={broadcastForm.type} onChange={(event) => updateBroadcastForm({ type: event.target.value })}>
                    <option value="announcement">Announcement</option>
                    <option value="emergency">Emergency notice</option>
                    <option value="consent_reminder">Consent reminder</option>
                  </select>
                </label>
                <label>Subject
                  <input value={broadcastForm.subject} maxLength={160} onChange={(event) => updateBroadcastForm({ subject: event.target.value })} required />
                </label>
              </div>
              <label>Message
                <textarea value={broadcastForm.body} maxLength={2000} rows={4} onChange={(event) => updateBroadcastForm({ body: event.target.value })} required />
              </label>
              <fieldset className="broadcast-role-fieldset">
                <legend>Send to active accounts</legend>
                <div className="checkbox-group">
                  {broadcastRoleOptions.map(([role, label]) => (
                    <label className="checkbox-label" key={role}>
                      <input type="checkbox" checked={broadcastForm.roles.includes(role)} onChange={() => toggleBroadcastRole(role)} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="checkbox-label broadcast-confirmation">
                <input type="checkbox" checked={broadcastConfirmed} onChange={(event) => setBroadcastConfirmed(event.target.checked)} />
                I’ve checked the message and selected recipient roles.
              </label>
              <div className="form-actions">
                <button className="primary-btn" type="submit" disabled={broadcastBusy || !broadcastForm.subject.trim() || !broadcastForm.body.trim() || !broadcastForm.roles.length || !broadcastConfirmed}>
                  <Bell size={15} /> {broadcastBusy ? 'Sending…' : 'Send clinic notice'}
                </button>
              </div>
              {broadcastMessage && <p className={broadcastMessage.tone === 'error' ? 'broadcast-error' : 'success-message'} role={broadcastMessage.tone === 'error' ? 'alert' : 'status'}>{broadcastMessage.text}</p>}
            </form>
          </>}
        </section>
      )}

      {activeTab === 'risk' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><h3>Risk rules</h3><p className="field-hint">Versioned decision support only. No rule is a diagnosis or a substitute for nurse judgment.</p></div></div>
          {demonstrationRules && <div className="disabled-note">Demonstration rules are visible for testing and remain unapproved. They are used only when no clinician-approved version exists.</div>}
          {isAdmin && <form className="inline-entry-form" onSubmit={createRiskRule}><div className="two-fields"><label>Version<input type="number" min="1" value={riskRuleForm.version} onChange={(event) => setRiskRuleForm({ ...riskRuleForm, version: event.target.value })} required /></label><label>Rule set name<input value={riskRuleForm.name} maxLength="120" onChange={(event) => setRiskRuleForm({ ...riskRuleForm, name: event.target.value })} required /></label></div><label>Rules JSON<textarea value={riskRuleForm.rules} onChange={(event) => setRiskRuleForm({ ...riskRuleForm, rules: event.target.value })} placeholder='{"requiredFields":["painScore"],"thresholds":{"moderate":3,"high":7},"indicators":[]}' required /></label><button className="primary-btn">Save draft rule set</button></form>}
          {riskMessage && <p className="success-message" role="status">{riskMessage}</p>}
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Version</th><th>Name</th><th>Status</th><th>Approver</th><th>Action</th></tr></thead><tbody>{riskRules.map((rule) => <tr key={rule.id}><td>{rule.version}</td><td>{rule.name}</td><td><span className={`status-chip ${rule.status === 'clinician_approved' ? 'success' : 'warn'}`}>{rule.status === 'clinician_approved' ? 'Clinician approved' : 'Draft — not in use'}</span></td><td>{rule.approved_by || 'None'}</td><td>{user?.role === 'school_nurse' && rule.status === 'draft' ? <button type="button" className="table-action" onClick={() => approveRiskRule(rule)} disabled={!user.prcLicenseNumber}>Approve</button> : '—'}</td></tr>)}</tbody></table></div>
          {user?.role === 'school_nurse' && !user.prcLicenseNumber && <p className="disabled-note">A PRC license number must be recorded on your account before approval is available.</p>}
        </section>
      )}

      {activeTab === 'security' && isAdmin && (
        <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><h3>Privacy & security</h3><p className="field-hint">Security policy is enforced by the server.</p></div></div><p className="disabled-note">Sessions, password policy, MFA, authorization, audit retention, and database backups are managed through server configuration and the administrator account. Local-only switches are intentionally unavailable because they would not persist.</p></section>
      )}

      {activeTab === 'data' && isAdmin && (
        <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><h3>Data & reports</h3><p className="field-hint">Imports are for fictional student rosters and are checked before saving.</p></div></div><div className="data-command-grid"><button className="data-action" onClick={exportData}><Download size={17} /><span><strong>Export oversight data</strong><small>Spreadsheet-safe settings and roster export</small></span></button><button className="data-action" onClick={exportOversightSnapshot}><Database size={17} /><span><strong>Download oversight snapshot</strong><small>JSON of the settings and roster visible to this account</small></span></button><button className="data-action" onClick={downloadStudentTemplate}><FileBarChart size={17} /><span><strong>Download student template</strong><small>Quoted-field-safe CSV headings</small></span></button><button className="data-action" onClick={() => studentFileInput.current?.click()}><Upload size={17} /><span><strong>Import students</strong><small>Validate required IDs and duplicates</small></span></button></div><input ref={studentFileInput} type="file" accept="text/csv,.csv" hidden onChange={importStudentsCsv} /><p className="disabled-note">Clinical visit imports are restricted to school nurses. Schedule encrypted database backups with the hosting provider; local exports are manual.</p><h4 className="preference-title">System activity logs</h4><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Action</th><th>Timestamp</th></tr></thead><tbody>{auditLogs.map((entry, index) => <tr key={`${entry.timestamp}-${index}`}><td>{getAuditSubject(entry)}</td><td>{getAuditMeta(entry.event).label}</td><td>{new Date(entry.timestamp).toLocaleString()}</td></tr>)}</tbody></table></div></section>
      )}

      {activeTab === 'schedule' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Assigned by administrator</p><h3>My schedule</h3></div><span className="settings-badge">View only</span></div><div className="schedule-card"><strong>Monday – Friday</strong><span>08:00 AM – 04:00 PM</span><small>Assigned grade / section: All clinic referrals</small></div></section>}
      {activeTab === 'reports' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><h3>My reports</h3><p className="field-hint">Staff reports are available from the Reports page.</p></div></div><p className="disabled-note">A personal export is not available yet because report access is scoped to authorized clinic-wide aggregates.</p><button className="secondary-btn" onClick={() => window.location.assign('/reports')}><FileBarChart size={15} /> Open reports</button></section>}

      {activeTab === 'school' && isAdmin && <div className="settings-layout">
        <section className="panel form-panel">
          <div className="form-step">
            <div className="step-heading">
              <span>01</span>
              <h3>School information</h3>
            </div>
            <div className="two-fields">
              <label>
                School name
                <input
                  name="schoolName"
                  value={form.schoolName}
                  onChange={update}
                />
              </label>
              <label>
                School year
                <input
                  name="schoolYear"
                  value={form.schoolYear}
                  onChange={update}
                />
              </label>
            </div>
            <label>
              School address
              <input name="address" value={form.address} onChange={update} />
            </label>
          </div>
          <div className="form-step">
            <div className="step-heading">
              <span>02</span>
              <h3>Clinic details</h3>
            </div>
            <div className="two-fields">
              <label>
                Clinic name
                <input
                  name="clinicName"
                  value={form.clinicName}
                  onChange={update}
                />
              </label>
              <label>
                Nurse name
                <input
                  name="nurseName"
                  value={form.nurseName}
                  onChange={update}
                />
              </label>
            </div>
            <label>
              Contact number
              <input
                name="contactNumber"
                value={form.contactNumber}
                onChange={update}
              />
            </label>
            <div className="two-fields">
              <label>Clinic opens<input type="time" name="clinicOpenTime" value={form.clinicOpenTime || '08:00'} onChange={update} /></label>
              <label>Clinic closes<input type="time" name="clinicCloseTime" value={form.clinicCloseTime || '16:00'} onChange={update} /></label>
            </div>
            <label>Appointment slot length<select name="appointmentDurationMinutes" value={form.appointmentDurationMinutes || 30} onChange={update}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label>
          </div>
          {saved && (
            <p className="success-message">
              <Check size={14} /> Settings saved successfully.
            </p>
          )}

          <div className="form-step">
            <div className="step-heading">
              <span>03</span>
              <h3>Security center</h3>
            </div>

            <div className="two-fields">
              <label>
                Multi-factor authentication
                <button type="button" className="primary-btn" onClick={handleMfaToggle} style={{ marginTop: 8 }}>
                  {mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
                </button>
              </label>
            </div>

            {reviewMessage && (
              <p className="success-message">
                <Check size={14} /> {reviewMessage}
              </p>
            )}

            {user?.role === 'system_administrator' && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ margin: '0 0 12px' }}>Pending nurse verifications</h4>
                {pendingRegistrations.length === 0 ? (
                  <p className="muted-copy">No pending nurse registrations at the moment.</p>
                ) : (
                  <div className="auth-help" style={{ padding: 12, display: 'grid', gap: 12 }}>
                    {pendingRegistrations.map((entry) => (
                      <div key={entry.username} style={{ border: '1px solid #d7e8df', borderRadius: 12, padding: 12 }}>
                        <strong>{entry.name}</strong>
                        <p style={{ margin: '4px 0' }}>{entry.email} • {entry.schoolName}</p>
                        <small>School ID: {entry.schoolId} • PRC: {entry.prcLicenseNumber}</small>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button type="button" className="primary-btn" onClick={() => handleApprove(entry.username)}>Approve</button>
                          <button type="button" className="secondary-btn" onClick={() => handleReject(entry.username)}>Reject</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        <aside className="settings-aside">
          <div className="workspace-card">
            <div className="workspace-card-topline">
              <div className="workspace-icon"><Database size={18} /></div>
              <span className="workspace-status"><i /> Central database</span>
            </div>
            <h3>Workspace data</h3>
            <p>Records are stored in the secured PostgreSQL database and shared only with authorized accounts.</p>
            <div className="workspace-stats">
              <div><strong>{data.students.length}</strong><span>{isAdmin ? 'Roster records' : 'Students'}</span></div>
              <div><strong>{isAdmin ? '—' : data.visits.length}</strong><span>{isAdmin ? 'Clinical details hidden' : 'Visits'}</span></div>
              {!isAdmin && <div><strong>{data.inventory.length}</strong><span>Stock items</span></div>}
            </div>
          </div>
          {isAdmin && <>
          <button
            className="data-action"
            onClick={exportData}
          >
            <Download size={17} />
            <span>
              <strong>Export CSV report</strong>
              <small>Download spreadsheet-compatible records</small>
            </span>
          </button>
          <button className="data-action primary-data-action" onClick={exportOversightSnapshot}>
            <Database size={17} />
            <span><strong>Download oversight snapshot</strong><small>Visible settings and roster JSON</small></span>
          </button>
          <button className="data-action" disabled title="Sample reset is disabled for server-backed records">
            <RotateCcw size={17} />
            <span>
              <strong>Reset workspace unavailable</strong>
              <small>Sample data cannot replace server-backed records</small>
            </span>
          </button>
          <div className="audit-card">
            <div className="audit-card-heading">
              <div>
                <p className="section-kicker">Security history</p>
                <h3>Audit activity</h3>
              </div>
              <span className="audit-live-dot" aria-label="Audit log active" />
            </div>
            <p className="audit-description">A private record of access and account changes in this workspace.</p>
            {auditLogs.length === 0 ? (
              <div className="audit-empty">
                <ShieldCheck size={18} />
                <span>No security events captured yet.</span>
              </div>
            ) : (
              <div className="audit-list">
                {auditLogs.map((entry, index) => (
                  <article className="audit-entry" key={`${entry.timestamp}-${index}`}>
                    <div className={`audit-marker ${getAuditMeta(entry.event).tone}`} />
                    <div className="audit-entry-body">
                      <div className="audit-entry-topline">
                        <strong>{getAuditMeta(entry.event).label}</strong>
                        <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                      </div>
                      <p>{getAuditSubject(entry)}</p>
                      <span>{getAuditMeta(entry.event).group} · {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="audit-card-footer"><span>Showing latest {auditLogs.length} events</span><span>Server audit log</span></div>
          </div>
          </>}
        </aside>
      </div>}
    </div>
  );
}
