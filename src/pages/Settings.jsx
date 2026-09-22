import { useRef, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Check, Database, Download, Lock, RotateCcw, Save, ShieldCheck, Upload, X, UserCog, Bell, SlidersHorizontal, FileBarChart, Building2, KeyRound } from "lucide-react";
import { resetData, saveData } from "../db/database";
import { downloadCsv } from "../utils/csv";
import {
  approveNurseAccount,
  getAuditLogs,
  getPendingRegistrations,
  getUsersForAdmin,
  createManagedUser,
  rejectNurseAccount,
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
};

const getAuditMeta = (event) => auditEventMeta[event] || { label: event.replaceAll('_', ' '), tone: 'neutral', group: 'System' };

const getAuditSubject = (entry) => {
  const details = entry.details || {};
  return details.username || details.email || details.approvedBy || 'System activity';
};

export default function Settings({ data, setData, user }) {
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const isAdmin = user?.role === 'system_administrator';
  const [activeTab, setActiveTab] = useState(isAdmin ? 'account' : 'account');
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState({ lowStock: true, visits: true, immunizations: true, email: false, sms: false, inApp: true });
  const [securitySettings, setSecuritySettings] = useState({ retention: '5 years', passwordReset: false, sessionTimeout: '30 minutes' });
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
  const fileInput = useRef(null);
  const studentFileInput = useRef(null);

  useEffect(() => {
    setMfaEnabled(Boolean(user?.mfaEnabled));
    Promise.all([getPendingRegistrations(), getAuditLogs(), getUsersForAdmin()]).then(([pending, logs, accounts]) => {
      setPendingRegistrations(pending);
      setAuditLogs(logs.slice(0, 8));
      setUsers(accounts);
    });
  }, [user]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    const allowedTabs = user?.role === 'system_administrator'
      ? ['account', 'users', 'school', 'inventory', 'data', 'notifications', 'security']
      : ['account', 'schedule', 'notifications', 'inventory', 'reports'];
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
    const [pending, logs, accounts] = await Promise.all([getPendingRegistrations(), getAuditLogs(), getUsersForAdmin()]);
    setPendingRegistrations(pending);
    setAuditLogs(logs.slice(0, 8));
    setUsers(accounts);
  };

  const handleApprove = async (username) => {
    const result = await approveNurseAccount(username, user?.username || 'system_administrator');
    setReviewMessage(result.message);
    await refreshReviewData();
  };

  const handleReject = async (username) => {
    const result = await rejectNurseAccount(username, 'Admin rejected the submitted nurse account.', user?.username || 'system_administrator');
    setReviewMessage(result.message);
    await refreshReviewData();
  };
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = () => {
    setData(saveData({ ...data, settings: form }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  const restore = () => {
    if (window.confirm("Restore the sample data?")) setData(resetData());
  };
  const exportWorkspaceBackup = () => {
    const backup = {
      ...data,
      exportedAt: new Date().toISOString(),
      backupVersion: 1,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `healthmate-workspace-${new Date().toISOString().slice(0, 10)}.json`;
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
  const importData = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported.settings || !Array.isArray(imported.students) || !Array.isArray(imported.visits)) throw new Error("Invalid backup");
      setData(saveData(imported));
      setForm(imported.settings);
      window.alert("Backup restored successfully.");
    } catch {
      window.alert("This file is not a valid HealthMate+ backup.");
    } finally {
      event.target.value = "";
    }
  };
  const importStudentsCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(',').map((header) => header.trim().toLowerCase());
      const importedStudents = lines.map((line, index) => {
        const values = line.split(',').map((value) => value.trim());
        const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
        return { id: Date.now() + index, studentId: row['student id'] || row.studentid || `IMPORTED-${Date.now()}-${index}`, name: row.name || row['full name'] || '', gradeLevel: row.grade || row.gradelevel || '', section: row.section || '', guardianName: row.guardian || row.guardianname || '', guardianPhone: row.phone || row.guardianphone || '', allergies: row.allergies || '', conditions: row.conditions || '', medications: row.medications || '' };
      }).filter((student) => student.name);
      setData(saveData({ ...data, students: [...data.students, ...importedStudents] }));
      setReviewMessage(`${importedStudents.length} student records imported.`);
    } catch {
      setReviewMessage('Unable to read that CSV file. Check the header row and try again.');
    } finally {
      event.target.value = '';
    }
  };

  const tabs = isAdmin
    ? [
      ['account', 'Account settings', UserCog],
      ['users', 'User management', UserCog],
      ['school', 'School & clinic', Building2],
      ['inventory', 'Inventory settings', SlidersHorizontal],
      ['data', 'Data & reports', FileBarChart],
      ['notifications', 'Notifications', Bell],
      ['security', 'Privacy & security', KeyRound],
    ]
    : [
      ['account', 'My account', UserCog],
      ['schedule', 'My schedule', Building2],
      ['notifications', 'My notifications', Bell],
      ['inventory', 'Inventory requests', SlidersHorizontal],
      ['reports', 'My reports', FileBarChart],
    ];

  const toggleNotification = (key) => setNotifications((current) => ({ ...current, [key]: !current[key] }));
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

      {activeTab === 'account' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">{isAdmin ? 'Administrator identity' : 'Staff identity'}</p><h3>{isAdmin ? 'Account settings' : 'My account'}</h3></div><span className="settings-badge">{isAdmin ? 'Full access' : 'Clinic staff'}</span></div>
          <div className="profile-settings-grid">
            <div className="profile-photo-placeholder">{(user?.name || 'User').split(' ').map((part) => part[0]).join('').slice(0, 2)}<button type="button" className="secondary-btn">Upload photo</button></div>
            <div className="two-fields">
              <label>Full name<input defaultValue={user?.name || ''} disabled={!isAdmin} /></label>
              <label>Email<input type="email" defaultValue={user?.email || ''} disabled={!isAdmin} /></label>
              <label>{isAdmin ? 'Contact number' : 'Email / contact number'}<input defaultValue={user?.contactNumber || ''} /></label>
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
        <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Preferences</p><h3>{isAdmin ? 'Notifications' : 'My notifications'}</h3></div></div><div className="preference-list">{(isAdmin ? [['lowStock','Low stock alerts','Notify when supplies reach their reorder threshold'],['visits','New visit logged alerts','Keep administrators aware of clinic activity'],['immunizations','Immunization due reminders','Surface upcoming and overdue doses']] : [['lowStock','Assigned student allergy flags','Highlight allergy alerts for your assigned students'],['visits','Follow-up reminders','Remind me about scheduled follow-ups']]).map(([key,label,description]) => <div className="preference-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><button type="button" className={`setting-switch ${notifications[key] ? 'on' : ''}`} onClick={() => toggleNotification(key)}><span />{notifications[key] ? 'On' : 'Off'}</button></div>)}</div><h4 className="preference-title">Notification methods</h4><div className="method-grid">{[['email','Email'],['inApp','In-app']].map(([key,label]) => <label key={key}><input type="checkbox" checked={notifications[key]} onChange={() => toggleNotification(key)} /> {label}</label>)}</div></section>
      )}

      {activeTab === 'security' && isAdmin && (
        <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Governance</p><h3>Privacy & security</h3></div></div><div className="preference-list"><label>Data retention period<select value={securitySettings.retention} onChange={(event) => setSecuritySettings({ ...securitySettings, retention: event.target.value })}><option>1 year</option><option>3 years</option><option>5 years</option><option>Indefinite</option></select></label><div className="preference-row"><div><strong>Require password reset</strong><span>Ask users to change passwords on a regular schedule.</span></div><button type="button" className={`setting-switch ${securitySettings.passwordReset ? 'on' : ''}`} onClick={() => setSecuritySettings({ ...securitySettings, passwordReset: !securitySettings.passwordReset })}><span />{securitySettings.passwordReset ? 'On' : 'Off'}</button></div><label>Session timeout<select value={securitySettings.sessionTimeout} onChange={(event) => setSecuritySettings({ ...securitySettings, sessionTimeout: event.target.value })}><option>15 minutes</option><option>30 minutes</option><option>1 hour</option><option>4 hours</option></select></label></div></section>
      )}

      {activeTab === 'inventory' && isAdmin && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">Stock governance</p><h3>Inventory settings</h3></div><button className="primary-btn"><SlidersHorizontal size={15} /> Add category</button></div>
          <p className="tab-description">Set reorder points and review stock requests before they affect clinic readiness.</p>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Item</th><th>Category</th><th>Current stock</th><th>Low-stock threshold</th><th>Action</th></tr></thead><tbody>{data.inventory.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>Expires {item.expiryDate || 'not recorded'}</small></td><td>{item.category}</td><td>{item.quantity} {item.unit}</td><td><input className="table-number-input" type="number" min="0" defaultValue={item.reorderLevel} onBlur={(event) => { const next = data.inventory.map((entry) => entry.id === item.id ? { ...entry, reorderLevel: Number(event.target.value) } : entry); setData(saveData({ ...data, inventory: next })); }} /></td><td><button type="button" className="table-action" onClick={() => window.alert('Restock request workflow is ready for staff submissions.')}>Review request</button></td></tr>)}</tbody></table></div>
        </section>
      )}

      {activeTab === 'data' && isAdmin && (
        <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Records & continuity</p><h3>Data & reports</h3></div></div><div className="data-command-grid"><button className="data-action" onClick={exportData}><Download size={17} /><span><strong>Export all data</strong><small>Spreadsheet-safe CSV record export</small></span></button><button className="data-action" onClick={exportWorkspaceBackup}><Database size={17} /><span><strong>Backup now</strong><small>Download a complete JSON workspace backup</small></span></button><button className="data-action" onClick={() => studentFileInput.current?.click()}><Upload size={17} /><span><strong>Import students</strong><small>Upload a CSV roster</small></span></button></div><input ref={studentFileInput} type="file" accept="text/csv,.csv" hidden onChange={importStudentsCsv} /><p className="disabled-note">Schedule encrypted database backups with the hosting provider; local exports are manual.</p><h4 className="preference-title">System activity logs</h4><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Action</th><th>Timestamp</th></tr></thead><tbody>{auditLogs.map((entry, index) => <tr key={`${entry.timestamp}-${index}`}><td>{getAuditSubject(entry)}</td><td>{getAuditMeta(entry.event).label}</td><td>{new Date(entry.timestamp).toLocaleString()}</td></tr>)}</tbody></table></div></section>
      )}

      {activeTab === 'schedule' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Assigned by administrator</p><h3>My schedule</h3></div><span className="settings-badge">View only</span></div><div className="schedule-card"><strong>Monday – Friday</strong><span>08:00 AM – 04:00 PM</span><small>Assigned grade / section: All clinic referrals</small></div></section>}
      {activeTab === 'reports' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Personal reporting</p><h3>My reports</h3></div></div><div className="two-fields"><label>From<input type="date" /></label><label>To<input type="date" /></label></div><button className="primary-btn"><FileBarChart size={15} /> Export my logged visits</button><p className="disabled-note">Your report includes only visits logged by your account.</p></section>}

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
              <div><strong>{data.students.length}</strong><span>Students</span></div>
              <div><strong>{data.visits.length}</strong><span>Visits</span></div>
              <div><strong>{data.inventory.length}</strong><span>Stock items</span></div>
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
          <button className="data-action primary-data-action" onClick={exportWorkspaceBackup}>
            <Database size={17} />
            <span><strong>Download workspace backup</strong><small>Full restore file in JSON format</small></span>
          </button>
          <button className="data-action" onClick={restore}>
            <RotateCcw size={17} />
            <span>
              <strong>Reset workspace</strong>
              <small>Replace records with sample data</small>
            </span>
          </button>
          <button className="data-action" onClick={() => fileInput.current?.click()}>
            <Upload size={17} />
            <span><strong>Restore workspace backup</strong><small>Import a HealthMate+ JSON file</small></span>
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importData} />

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
