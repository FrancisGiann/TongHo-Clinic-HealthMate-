import { useRef, useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Check, Database, Download, Lock, RotateCcw, Save, ShieldCheck, Upload, X, UserCog, Bell, FileBarChart, Building2, KeyRound } from "lucide-react";
import { downloadCsv } from "../utils/csv";
import { api } from "../utils/api";
import ImportPanel from "../components/ImportPanel";
import {
  getAuditLogs,
  getUsersForAdmin,
  createManagedUser,
  resendInvitation,
  updateUserStatus,
  changePassword,
  authenticateUser,
} from "../utils/auth";

const auditEventMeta = {
  LOGIN_SUCCESS: { label: "Signed in", tone: "positive", group: "Access" },
  LOGIN_OTP_SENT: { label: "Verification code sent", tone: "security", group: "Access" },
  LOGIN_FAILED: { label: "Failed sign-in", tone: "critical", group: "Access" },
  LOGOUT: { label: "Signed out", tone: "neutral", group: "Access" },
  SESSION_REVOKED: { label: "Session revoked", tone: "security", group: "Security" },
  SESSIONS_REVOKED_ALL: { label: "All sessions signed out", tone: "security", group: "Security" },
  PASSWORD_RESET_REQUESTED: { label: "Password reset requested", tone: "security", group: "Security" },
  PASSWORD_RESET_COMPLETED: { label: "Password reset completed", tone: "positive", group: "Security" },
  PASSWORD_CHANGED: { label: "Password changed", tone: "positive", group: "Security" },
  USER_INVITED: { label: "Account invitation sent", tone: "security", group: "People" },
  INVITATION_RESENT: { label: "Invitation resent", tone: "security", group: "People" },
  INVITATION_EMAIL_FAILED: { label: "Invitation email failed", tone: "critical", group: "People" },
  ACCOUNT_STATUS_CHANGED: { label: "Account status changed", tone: "security", group: "People" },
  NURSE_PRC_LICENSE_VERIFICATION_UPDATED: { label: "Nurse PRC license verification updated", tone: "security", group: "People" },
  ACCOUNT_APPROVED: { label: "Staff account approved", tone: "positive", group: "People" },
  ACCOUNT_REJECTED: { label: "Staff account rejected", tone: "critical", group: "People" },
  NURSE_ACCOUNT_CREATED: { label: "Staff account created", tone: "security", group: "People" },
  NOTIFICATION_BROADCAST_STARTED: { label: "Clinic notice started", tone: "neutral", group: "Notifications" },
  NOTIFICATION_BROADCAST_COMPLETED: { label: "Clinic notice completed", tone: "positive", group: "Notifications" },
};

const titleCaseWords = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split('_').filter(Boolean).join(' ').split(' ').filter(Boolean).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
const getAuditMeta = (event) => auditEventMeta[event] || {
  label: titleCaseWords(event) || 'Unknown activity',
  tone: 'neutral',
  group: /^(LOGIN|LOGOUT|SESSION|PASSWORD|MFA)/.test(event) ? 'Access'
    : /^(USER|ACCOUNT|INVITATION|NURSE)/.test(event) ? 'People'
      : /^(NOTIFICATION)/.test(event) ? 'Communications'
        : /^(RISK)/.test(event) ? 'Clinical support'
          : /^(CLINIC|PATIENT|VISIT|QUEUE|INVENTORY|APPOINTMENT|FACULTY|STUDENT|HISTORICAL)/.test(event) ? 'Clinic operations'
            : /^(REPORT)/.test(event) ? 'Reports' : 'System',
};

const getAuditSubject = (entry, accounts = []) => {
  const details = entry.details || {};
  const actor = accounts.find((account) => String(account.id) === String(entry.actor_user_id));
  return actor?.name || actor?.email || details.username || details.email || details.approvedBy || (entry.actor_user_id ? 'Account unavailable' : 'System');
};

const formatAuditDetails = (details = {}) => Object.entries(details).map(([key, value]) => {
  const renderedValue = Array.isArray(value) ? value.join(', ')
    : value && typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `${titleCaseWords(key)}: ${renderedValue}`;
}).join(' · ') || 'No additional details';

const broadcastRoleOptions = [
  ['school_nurse', 'Nurses'],
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

export default function Settings({ data, user, reload, section }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(data.settings);
  const [saved, setSaved] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(section === 'security');
  const [auditError, setAuditError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const [logoutAllPassword, setLogoutAllPassword] = useState('');
  const [reviewMessage, setReviewMessage] = useState("");
  const [userActionFeedback, setUserActionFeedback] = useState(null);
  const userActionFeedbackTimerRef = useRef(null);
  const [reminderMessage, setReminderMessage] = useState("");
  const [broadcastForm, setBroadcastForm] = useState({ type: 'announcement', subject: '', body: '', roles: [] });
  const [broadcastRequestId, setBroadcastRequestId] = useState(newBroadcastRequestId);
  const [broadcastConfirmed, setBroadcastConfirmed] = useState(false);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState(null);
  const [riskRules, setRiskRules] = useState([]);
  const [demonstrationRules, setDemonstrationRules] = useState(null);
  const [candidateRuleDraft, setCandidateRuleDraft] = useState(null);
  const [testActivationAvailable, setTestActivationAvailable] = useState(false);
  const [testActivation, setTestActivation] = useState(null);
  const [currentUserLicenseVerified, setCurrentUserLicenseVerified] = useState(false);
  const [riskRuleForm, setRiskRuleForm] = useState({ version: '', name: '', rules: '' });
  const [riskMessage, setRiskMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const isAdmin = user?.role === 'system_administrator';
  const savedCandidateRule = riskRules.find((rule) => rule.rules?.mode === 'conservative_triage_v1');
  const [users, setUsers] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
  const [guardianLinkTarget, setGuardianLinkTarget] = useState(null);
  const [guardianLinkForm, setGuardianLinkForm] = useState({ patientId: '', relationship: 'Parent' });
  const [guardianLinkSaving, setGuardianLinkSaving] = useState(false);
  const [nurseLicenseTarget, setNurseLicenseTarget] = useState(null);
  const [nurseLicenseNumber, setNurseLicenseNumber] = useState('');
  const [licenseVerificationConfirmed, setLicenseVerificationConfirmed] = useState(false);
  const [licenseSaving, setLicenseSaving] = useState(false);
  const activeSection = section || 'account';
  const feedbackScope = `${location.pathname}:${activeSection}`;
  const feedbackScopeRef = useRef(feedbackScope);
  const setScopedFeedback = (scope, setter, value) => {
    if (feedbackScopeRef.current === scope) setter(value);
  };
  const clearUserActionFeedback = () => {
    if (userActionFeedbackTimerRef.current) window.clearTimeout(userActionFeedbackTimerRef.current);
    userActionFeedbackTimerRef.current = null;
    setUserActionFeedback(null);
  };
  const showScopedUserActionFeedback = (scope, tone, message) => {
    if (feedbackScopeRef.current !== scope) return;
    if (userActionFeedbackTimerRef.current) window.clearTimeout(userActionFeedbackTimerRef.current);
    userActionFeedbackTimerRef.current = null;
    setUserActionFeedback({ tone, message });
    if (tone === 'success') {
      userActionFeedbackTimerRef.current = window.setTimeout(() => {
        setUserActionFeedback(null);
        userActionFeedbackTimerRef.current = null;
      }, 6000);
    }
  };
  const userFilter = searchParams.get('filter') || 'all';
  const visibleUsers = users.filter((account) => {
    if (userFilter === 'active') return account.status === 'active';
    if (userFilter === 'invited') return account.status === 'invited';
    if (userFilter === 'nurses') return account.role === 'school_nurse';
    if (userFilter === 'restricted') return account.status !== 'active';
    return true;
  });

  const refreshSessions = async () => {
    try {
      const result = await api.get('/api/auth/sessions');
      setSessions(result.sessions || []);
      setSessionsError('');
    } catch (error) {
      setSessionsError(error.message);
    }
  };

  const refreshAuditLogs = async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const logs = await getAuditLogs({ throwOnError: true });
      setAuditLogs(logs);
    } catch (error) {
      setAuditError(error.message || 'Audit history could not be loaded. Try refreshing.');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    feedbackScopeRef.current = feedbackScope;
    clearUserActionFeedback();
    setReviewMessage('');
    setReminderMessage('');
    setSessionMessage('');
    setSessionsError('');
    setBroadcastMessage(null);
    setRiskMessage('');
    setSaved(false);
    return () => {
      if (userActionFeedbackTimerRef.current) window.clearTimeout(userActionFeedbackTimerRef.current);
      userActionFeedbackTimerRef.current = null;
    };
  }, [feedbackScope]);

  useEffect(() => {
    if (activeSection === 'account') refreshSessions();
    api.get('/api/risk/rules').then((ruleData) => {
      setRiskRules(ruleData.rules || []);
      setDemonstrationRules(ruleData.demonstrationRules || null);
      setCandidateRuleDraft(ruleData.candidateRuleDraft || null);
      setTestActivationAvailable(Boolean(ruleData.testActivationAvailable));
      setTestActivation(ruleData.testActivation || null);
      setCurrentUserLicenseVerified(Boolean(ruleData.currentUserLicenseVerified));
    }).catch(() => {
      setRiskRules([]);
      setDemonstrationRules(null);
      setCandidateRuleDraft(null);
      setTestActivationAvailable(false);
      setTestActivation(null);
      setCurrentUserLicenseVerified(false);
    });
    if (!isAdmin) return;
    if (activeSection === 'security') {
      refreshAuditLogs();
      getUsersForAdmin().then(setUsers);
    }
    if (activeSection === 'users') {
      getUsersForAdmin().then((accounts) => {
        setPendingRegistrations(accounts.filter((account) => account.status === 'invited' && account.role === 'school_nurse'));
        setUsers(accounts);
      });
    }
  }, [user, isAdmin, activeSection]);

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

  const handlePasswordChange = async () => {
    const scope = feedbackScopeRef.current;
    if (newPasswordValue !== confirmPassword) return setScopedFeedback(scope, setReviewMessage, 'New passwords do not match.');
    const result = await changePassword(user?.username, currentPassword, newPasswordValue);
    setScopedFeedback(scope, setReviewMessage, result.success ? result.message : result.error);
    if (result.success) {
      setCurrentPassword('');
      setNewPasswordValue('');
      setConfirmPassword('');
    }
  };

  const revokeSession = async (session) => {
    if (!window.confirm(session.current ? 'Sign out this browser now?' : 'Sign out this session?')) return;
    setSessionMessage('');
    const scope = feedbackScopeRef.current;
    try {
      const result = await api.delete(`/api/auth/sessions/${encodeURIComponent(session.sessionId)}`);
      if (result.current) {
        window.location.reload();
        return;
      }
      setScopedFeedback(scope, setSessionMessage, 'Session signed out.');
      await refreshSessions();
    } catch (error) {
      setScopedFeedback(scope, setSessionMessage, error.message);
    }
  };

  const logoutAllSessions = async (event) => {
    event.preventDefault();
    setSessionMessage('');
    const scope = feedbackScopeRef.current;
    try {
      await api.post('/api/auth/sessions/logout-all', { currentPassword: logoutAllPassword });
      setLogoutAllPassword('');
      window.location.reload();
    } catch (error) {
      setScopedFeedback(scope, setSessionMessage, error.message);
    }
  };

  const refreshReviewData = async () => {
    const accounts = await getUsersForAdmin();
    setPendingRegistrations(accounts.filter((account) => account.status === 'invited' && account.role === 'school_nurse'));
    setUsers(accounts);
  };

  const handleApprove = async (username) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const account = users.find((entry) => entry.username === username);
    const result = account ? await updateUserStatus(account.id, 'active') : { success: false, error: 'Invitation not found.' };
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? `${account.name} is now active.` : result.error);
    await refreshReviewData();
  };

  const handleReject = async (username) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const account = users.find((entry) => entry.username === username);
    const result = account ? await updateUserStatus(account.id, 'deactivated') : { success: false, error: 'Invitation not found.' };
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? `${account.name} was deactivated.` : result.error);
    await refreshReviewData();
  };
  const openNurseLicenseEditor = (account) => {
    setNurseLicenseTarget(account);
    setNurseLicenseNumber('');
    setLicenseVerificationConfirmed(false);
  };
  const updateNurseLicense = async (event) => {
    event.preventDefault();
    if (!nurseLicenseTarget) return;
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    setLicenseSaving(true);
    try {
      const result = await api.patch(`/api/admin/users/${encodeURIComponent(nurseLicenseTarget.id)}/prc-license`, {
        prcLicenseNumber: nurseLicenseNumber,
        verificationConfirmed: licenseVerificationConfirmed,
      });
      setNurseLicenseTarget(null);
      setNurseLicenseNumber('');
      setLicenseVerificationConfirmed(false);
      showScopedUserActionFeedback(scope, 'success', result.user.prcLicenseVerified
        ? `A verified PRC license is now recorded by an administrator for ${nurseLicenseTarget.name}.`
        : `The PRC license record was cleared for ${nurseLicenseTarget.name}.`);
      await refreshReviewData();
    } catch (error) {
      showScopedUserActionFeedback(scope, 'error', error.message);
    } finally {
      setLicenseSaving(false);
    }
  };
  const update = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });
  const save = async () => {
    const scope = feedbackScopeRef.current;
    setReviewMessage('');
    try {
      const result = await api.patch('/api/admin/settings/clinic', form);
      setForm(result.settings);
      await reload?.();
      setScopedFeedback(scope, setSaved, true);
    } catch (error) {
      setScopedFeedback(scope, setReviewMessage, error.message);
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
  const adminPageDetails = {
    account: ['My Account', 'Manage your password and sign-in preferences.'],
    users: ['Users', 'Manage account access and invitations.'],
    school: ['School & Clinic', 'Keep school identity and clinic contact details current.'],
    data: ['Data & Imports', 'Review oversight exports and roster imports.'],
    notifications: ['Communications', 'Send a clinic notice or process due reminders.'],
    risk: ['Risk Rules', 'Manage versioned decision support rules for nurse review.'],
    security: ['Audit history', 'Review recent access, account, clinic, and system activity.'],
  };
  const [adminPageTitle, adminPageDescription] = adminPageDetails[activeSection] || adminPageDetails.account;
  const nursePageDetails = {
    account: ['My account', 'Manage your password and sign-in preferences.'],
    data: ['Data & Imports', 'Import authorized historical clinic records and review roster workflows.'],
    risk: ['Risk Rules', 'Review versioned decision support rules for nurse review.'],
  };
  const [nursePageTitle, nursePageDescription] = nursePageDetails[activeSection] || nursePageDetails.account;
  const updateUserFilter = (value) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value === 'all') nextParams.delete('filter');
    else nextParams.set('filter', value);
    setSearchParams(nextParams);
  };

  const triggerReminders = async () => {
    const scope = feedbackScopeRef.current;
    setReminderMessage('');
    try {
      const result = await api.post('/api/admin/notifications/reminders', {});
      setScopedFeedback(scope, setReminderMessage, `${result.triggered} due item${result.triggered === 1 ? '' : 's'} processed, including ${result.consents || 0} consent reminder${result.consents === 1 ? '' : 's'}; ${result.notificationFailures || 0} delivery failures. Repeated runs are deduplicated.`);
    } catch (error) {
      setScopedFeedback(scope, setReminderMessage, error.message);
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
    const scope = feedbackScopeRef.current;
    setBroadcastBusy(true);
    setBroadcastMessage(null);
    try {
      const result = await api.post('/api/admin/notifications/broadcast', { ...broadcastForm, requestId: broadcastRequestId });
      setScopedFeedback(scope, setBroadcastMessage, {
        tone: result.emailFailures ? 'error' : 'success',
        text: `Recorded for ${result.recipientCount} active account${result.recipientCount === 1 ? '' : 's'}: ${result.inAppCreated} in-app notices, ${result.emailsSent} emails sent, ${result.emailFailures} email failures, ${result.duplicateEmailNoticesSkipped} duplicate email attempts skipped.${result.emailFailures ? ' No automatic email retry was attempted; check delivery configuration and follow up through the approved clinic channel.' : ''}`,
      });
      setBroadcastForm({ type: 'announcement', subject: '', body: '', roles: [] });
      setBroadcastRequestId(newBroadcastRequestId());
      setBroadcastConfirmed(false);
    } catch (error) {
      setScopedFeedback(scope, setBroadcastMessage, { tone: 'error', text: `${error.message} The same submission key is retained to prevent duplicate delivery; review the result before creating a new notice.` });
    } finally {
      setBroadcastBusy(false);
    }
  };
  const loadRiskRules = async () => {
    const result = await api.get('/api/risk/rules');
    setRiskRules(result.rules || []);
    setDemonstrationRules(result.demonstrationRules || null);
    setCandidateRuleDraft(result.candidateRuleDraft || null);
    setTestActivationAvailable(Boolean(result.testActivationAvailable));
    setTestActivation(result.testActivation || null);
    setCurrentUserLicenseVerified(Boolean(result.currentUserLicenseVerified));
  };
  const loadCandidateIntoDraft = () => {
    if (!candidateRuleDraft) return;
    const nextVersion = Math.max(0, ...riskRules.map((rule) => Number(rule.version) || 0)) + 1;
    setRiskRuleForm({
      version: String(nextVersion),
      name: candidateRuleDraft.name,
      rules: JSON.stringify(candidateRuleDraft.rules, null, 2),
    });
    setScopedFeedback(feedbackScopeRef.current, setRiskMessage, 'Candidate loaded for review. Save it to create an inactive draft; a licensed school nurse must approve it before use.');
  };
  const createCandidateRuleDraft = async () => {
    const scope = feedbackScopeRef.current;
    setRiskMessage('');
    try {
      const result = await api.post('/api/risk/rules/conservative-candidate', {});
      setScopedFeedback(scope, setRiskMessage, result.created
        ? `Inactive candidate draft version ${result.version} created. A licensed school nurse must approve it before use.`
        : `Candidate already exists as version ${result.version} (${result.status}); no duplicate was created.`);
      await loadRiskRules();
    } catch (error) {
      setScopedFeedback(scope, setRiskMessage, error.message);
    }
  };
  const createRiskRule = async (event) => {
    event.preventDefault();
    const scope = feedbackScopeRef.current;
    setRiskMessage('');
    try {
      await api.post('/api/risk/rules', { version: Number(riskRuleForm.version), name: riskRuleForm.name, rules: JSON.parse(riskRuleForm.rules) });
      setScopedFeedback(scope, setRiskMessage, 'Draft risk rules saved. A licensed school nurse must approve the version before use.');
      setRiskRuleForm({ version: '', name: '', rules: '' });
      await loadRiskRules();
    } catch (error) {
      setScopedFeedback(scope, setRiskMessage, error.message.includes('JSON') ? 'Rules must be valid JSON.' : error.message);
    }
  };
  const approveRiskRule = async (rule) => {
    const scope = feedbackScopeRef.current;
    setRiskMessage('');
    try {
      await api.patch(`/api/risk/rules/${encodeURIComponent(rule.id)}/approve`, {});
      setScopedFeedback(scope, setRiskMessage, `Version ${rule.version} approved by your nurse account.`);
      await loadRiskRules();
    } catch (error) {
      setScopedFeedback(scope, setRiskMessage, error.message);
    }
  };
  const enableRiskRuleForTesting = async (rule) => {
    const scope = feedbackScopeRef.current;
    setRiskMessage('');
    try {
      const result = await api.put(`/api/risk/rules/${encodeURIComponent(rule.id)}/test-activation`, {});
      setScopedFeedback(scope, setRiskMessage, result.changed
        ? `Version ${rule.version} is enabled for testing in this development environment. Assessments are marked test_active; this does not approve the rule.`
        : `Version ${rule.version} was already enabled for testing. Its draft status and clinician approval fields are unchanged.`);
      await Promise.all([loadRiskRules(), reload()]);
    } catch (error) {
      setScopedFeedback(scope, setRiskMessage, error.message);
    }
  };
  const disableRiskRuleTesting = async () => {
    const scope = feedbackScopeRef.current;
    setRiskMessage('');
    try {
      const result = await api.delete('/api/risk/rules/test-activation');
      setScopedFeedback(scope, setRiskMessage, result.changed
        ? 'Test activation disabled. New assessments now use the clinician-approved rule or the legacy demonstration rules.'
        : 'No test activation was active.');
      await Promise.all([loadRiskRules(), reload()]);
    } catch (error) {
      setScopedFeedback(scope, setRiskMessage, error.message);
    }
  };
  const handleCreateUser = async (event) => {
    event.preventDefault();
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const result = await createManagedUser(newUser);
    const invitationSent = result.success && result.emailSent !== false;
    showScopedUserActionFeedback(scope, invitationSent ? 'success' : 'error', result.success ? (result.emailSent === false ? result.message : 'Invitation sent successfully.') : result.error);
    if (result.success) {
      setNewUser({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
      setShowUserForm(false);
      await refreshReviewData();
    }
  };
  const handleUserStatus = async (account) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const result = await updateUserStatus(account.id, account.status === 'active' ? 'deactivated' : 'active');
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? `${account.name} is now ${account.status === 'active' ? 'inactive' : 'active'}.` : result.error);
    await refreshReviewData();
  };
  const handleResendInvitation = async (account) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const result = await resendInvitation(account.id);
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? result.message : result.error);
  };
  const saveGuardianLink = async (event) => {
    event.preventDefault();
    if (!guardianLinkTarget || !guardianLinkForm.patientId || !guardianLinkForm.relationship.trim()) return;
    const scope = feedbackScopeRef.current;
    setGuardianLinkSaving(true);
    clearUserActionFeedback();
    try {
      await api.patch(`/api/admin/users/${encodeURIComponent(guardianLinkTarget.id)}/patient-link`, guardianLinkForm);
      showScopedUserActionFeedback(scope, 'success', `${guardianLinkTarget.name} is linked to the selected student. Activate the account separately if it is suspended.`);
      setGuardianLinkTarget(null);
      await refreshReviewData();
    } catch (error) {
      showScopedUserActionFeedback(scope, 'error', error.message || 'The guardian link could not be saved.');
    } finally { setGuardianLinkSaving(false); }
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
          {activeSection !== 'data' && <p className="section-kicker">{isAdmin ? 'Administration' : activeSection === 'account' ? 'Workspace preferences' : 'Clinic operations'}</p>}
          {activeSection !== 'data' && <h2>{isAdmin ? adminPageTitle : nursePageTitle}</h2>}
          <p>{isAdmin ? adminPageDescription : nursePageDescription}</p>
        </div>
        {isAdmin && activeSection === 'school' && <button className="primary-btn" onClick={save}>
          <Save size={16} /> Save clinic settings
        </button>}
      </div>
      {activeSection === 'school' && reviewMessage && <div className="error-banner" role="alert">{reviewMessage}</div>}

      {activeSection === 'account' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">{isAdmin ? 'Administrator identity' : 'Staff identity'}</p><h3>{isAdmin ? 'Account settings' : 'My account'}</h3></div><span className="settings-badge">{isAdmin ? 'Full access' : 'Clinic staff'}</span></div>
          <div className="profile-settings-grid">
            <div className="profile-photo-placeholder"><span>{(user?.name || 'User').split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><small>Profile photos aren't available in account settings.</small></div>
            <div className="two-fields">
              <label>Full name<input defaultValue={user?.name || ''} disabled /></label>
              <label>Email<input type="email" defaultValue={user?.email || ''} disabled /></label>
              <label>Contact number<input defaultValue={user?.contactNumber || ''} disabled /></label>
              <p className="disabled-note">Profile identity fields are read-only here; use administrator account management for changes.</p>
              <div className="disabled-note"><KeyRound size={14} /> Password changes are protected and require confirmation.</div>
            </div>
          </div>
          <div className="settings-subsection"><h4>Change password</h4><div className="three-fields"><label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input type="password" value={newPasswordValue} onChange={(event) => setNewPasswordValue(event.target.value)} /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></div><button type="button" className="primary-btn" onClick={handlePasswordChange}>Update password</button>{reviewMessage && <p className="success-message" role="status">{reviewMessage}</p>}</div>
          <div className="settings-subsection security-row"><div><h4>Sign-in verification</h4><p>Production sign-ins always require an email verification code. Local development can disable this through server configuration. This policy cannot be changed per account.</p></div><span className="settings-badge">Server policy</span></div>
          <div className="settings-subsection">
            <div className="settings-panel-heading"><div><h4>Active sessions</h4><p>Sessions expire after 15 minutes without activity and no later than 12 hours after sign-in.</p></div><button type="button" className="secondary-btn" onClick={refreshSessions}>Refresh</button></div>
            {sessionsError && <div className="error-banner" role="alert">{sessionsError}</div>}
            {sessionMessage && <p className="success-message" role="status">{sessionMessage}</p>}
            {!sessionsError && sessions.length === 0 && <p className="muted-copy">No active sessions were found.</p>}
            {sessions.length > 0 && <div className="nurse-verification-list">{sessions.map((session) => <article className="nurse-verification-row" key={session.sessionId}>
              <div><strong>{session.current ? 'This browser' : 'Other browser'}</strong><p>{session.userAgent || 'Browser details unavailable'}</p><small>Last active {new Date(session.lastSeenAt).toLocaleString()} · Expires {new Date(session.expiresAt).toLocaleString()}</small></div>
              <button type="button" className="secondary-btn" onClick={() => revokeSession(session)}>Sign out</button>
            </article>)}</div>}
            <form className="settings-subsection settings-logout-all-form" onSubmit={logoutAllSessions}>
              <h4>Sign out of all devices</h4>
              <p className="field-hint">Enter your current password to revoke every session, including this browser.</p>
              <label className="settings-logout-all-password">Current password<input type="password" autoComplete="current-password" value={logoutAllPassword} onChange={(event) => setLogoutAllPassword(event.target.value)} required /></label>
              <div className="settings-logout-all-actions"><button type="submit" className="secondary-btn">Sign out everywhere</button></div>
            </form>
          </div>
        </section>
      )}

      {activeSection === 'users' && isAdmin && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">Access control</p><h3>User management</h3></div><button className="primary-btn" onClick={() => setShowUserForm(!showUserForm)}><UserCog size={15} /> Add new user</button></div>
          <div className="settings-users-toolbar">
            <p className="tab-description">Manage who can access clinic records. Nurses can be assigned a grade or section after their account is approved.</p>
            <label>Show accounts
              <select value={['all', 'active', 'invited', 'nurses', 'restricted'].includes(userFilter) ? userFilter : 'all'} onChange={(event) => updateUserFilter(event.target.value)}>
                <option value="all">All accounts</option>
                <option value="active">Active</option>
                <option value="invited">Pending invites</option>
                <option value="nurses">Nurse accounts</option>
                <option value="restricted">Restricted or pending</option>
              </select>
            </label>
          </div>
          {showUserForm && <form className="inline-user-form" onSubmit={handleCreateUser}><label>Name<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} required /></label><label>Email<input type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required /></label><label>Role<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value, patientId: '' })}><option>Admin</option><option>Nurse</option><option>Guardian</option></select></label>{newUser.role === 'Guardian' && <><label>Linked student<select value={newUser.patientId} onChange={(event) => setNewUser({ ...newUser, patientId: event.target.value })} required><option value="">Select student…</option>{data.students.filter((student) => student.patientType !== 'faculty').map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label><label>Relationship<input value={newUser.relationship} onChange={(event) => setNewUser({ ...newUser, relationship: event.target.value })} required /></label></>}<button type="submit" className="primary-btn">Send invitation</button></form>}
          {guardianLinkTarget && <form className="inline-user-form" onSubmit={saveGuardianLink}><div><h4>Link student to {guardianLinkTarget.name}</h4><p className="field-hint">Only student roster records can be linked. Suspended accounts require a separate activation after relinking.</p></div><label>Student record<select value={guardianLinkForm.patientId} onChange={(event) => setGuardianLinkForm((current) => ({ ...current, patientId: event.target.value }))} required><option value="">Select student…</option>{data.students.filter((student) => student.patientType !== 'faculty').map((student) => <option key={student.id} value={student.id}>{student.name} · {student.studentId || student.id}</option>)}</select></label><label>Guardian relationship<input maxLength={80} value={guardianLinkForm.relationship} onChange={(event) => setGuardianLinkForm((current) => ({ ...current, relationship: event.target.value }))} required /></label><button type="submit" className="primary-btn" disabled={guardianLinkSaving || !guardianLinkForm.patientId}>{guardianLinkSaving ? 'Saving…' : 'Save guardian link'}</button><button type="button" className="secondary-btn" onClick={() => setGuardianLinkTarget(null)} disabled={guardianLinkSaving}>Cancel</button></form>}
          {userActionFeedback && <div className={userActionFeedback.tone === 'error' ? 'error-banner' : 'success-message'} role={userActionFeedback.tone === 'error' ? 'alert' : 'status'}>{userActionFeedback.tone === 'success' && <Check size={14} aria-hidden="true" />} {userActionFeedback.message}</div>}
          <p className="disabled-note nurse-license-admin-note">Only administrators can record a nurse’s PRC license, after independently verifying it against an authoritative source. This list shows the recording status without displaying the license number.</p>
          {nurseLicenseTarget && <form className="nurse-license-editor" onSubmit={updateNurseLicense}>
            <div><h4>PRC license for {nurseLicenseTarget.name}</h4><p>Current status: {nurseLicenseTarget.prcLicenseVerified ? 'recorded by an administrator' : 'not recorded'}. The current number is not displayed.</p></div>
            <label>PRC license number<input type="text" value={nurseLicenseNumber} maxLength={80} autoComplete="off" onChange={(event) => setNurseLicenseNumber(event.target.value)} placeholder="Enter a verified number, or leave blank to clear" /></label>
            {Boolean(nurseLicenseNumber.trim()) && <label className="check-label"><input type="checkbox" checked={licenseVerificationConfirmed} onChange={(event) => setLicenseVerificationConfirmed(event.target.checked)} required /> I independently verified this license against an authoritative source.</label>}
            <div className="form-actions"><button type="submit" className="primary-btn" disabled={licenseSaving || (Boolean(nurseLicenseNumber.trim()) && !licenseVerificationConfirmed) || (!nurseLicenseNumber.trim() && !nurseLicenseTarget.prcLicenseNumber)}>{licenseSaving ? 'Saving…' : nurseLicenseNumber.trim() ? 'Record verified license' : 'Clear license record'}</button><button type="button" className="secondary-btn" onClick={() => setNurseLicenseTarget(null)} disabled={licenseSaving}>Cancel</button></div>
          </form>}
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>PRC license</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small>@{account.username}</small></td><td>{({ system_administrator: 'Admin', school_nurse: 'Nurse', student: 'Student (login removed)', guardian: 'Guardian' })[account.role] || account.role}</td><td>{account.email}</td><td><span className={`status-chip ${account.status === 'active' ? 'success' : 'warn'}`}>{account.status}</span></td><td>{account.role === 'school_nurse' ? <span className={`status-chip ${account.prcLicenseVerified ? 'success' : 'warn'}`}>{account.prcLicenseVerified ? 'Recorded by admin' : 'Not recorded'}</span> : '—'}</td><td>{account.lastLogin ? new Date(account.lastLogin).toLocaleDateString() : 'Never'}</td><td>{account.role === 'student' ? 'Student sign-in is disabled' : <>{account.status === 'invited' ? <button type="button" className="table-action" onClick={() => handleResendInvitation(account)}>Resend invitation</button> : <button type="button" className="table-action" onClick={() => handleUserStatus(account)}>{account.status === 'active' ? 'Deactivate' : 'Activate'}</button>}{account.role === 'guardian' && <button type="button" className="table-action" onClick={() => { setGuardianLinkTarget(account); setGuardianLinkForm({ patientId: '', relationship: 'Parent' }); }}>Link student</button>}{account.role === 'school_nurse' && <button type="button" className="table-action" onClick={() => openNurseLicenseEditor(account)}>{account.prcLicenseVerified ? 'Update or clear license' : 'Record verified license'}</button>}</>}</td></tr>)}</tbody></table>{visibleUsers.length === 0 && <p className="empty-state">{users.length ? 'No accounts match this filter.' : 'No system accounts are available yet.'}</p>}</div>
          <div className="settings-subsection nurse-verifications">
            <div><h4>Pending nurse verifications</h4><p>Review the school and license details submitted with nurse registrations.</p></div>
            {pendingRegistrations.length === 0 ? <p className="muted-copy">No pending nurse registrations at the moment.</p> : (
              <div className="nurse-verification-list">
                {pendingRegistrations.map((entry) => (
                  <article className="nurse-verification-row" key={entry.username}>
                    <div>
                      <strong>{entry.name}</strong>
                      <p>{entry.email} · {entry.schoolName || 'School not provided'}</p>
                      <small>School ID: {entry.schoolId || 'Not provided'} · PRC: {entry.prcLicenseNumber || 'Not provided'}</small>
                    </div>
                    <div className="nurse-verification-actions">
                      <button type="button" className="primary-btn" onClick={() => handleApprove(entry.username)}>Approve</button>
                      <button type="button" className="secondary-btn" onClick={() => handleReject(entry.username)}>Reject</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeSection === 'notifications' && (
        <section className="panel settings-tab-panel narrow-panel">
          <div className="settings-panel-heading">
            <div>
              <h3>{isAdmin ? 'Clinic communications' : 'My notifications'}</h3>
              <p className="field-hint">{isAdmin ? 'Send an announcement or notice to selected active account roles.' : 'Delivery is controlled by saved clinical events and account links.'}</p>
            </div>
          </div>
          <p className="disabled-note">Visit, appointment, follow-up, recurring-visit, and dated pending-consent reminders are deduplicated by the server. Signed consent forms are not stored here.</p>
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

      {activeSection === 'risk' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><h3>Risk rules</h3><p className="field-hint">Versioned decision support only. No rule is a diagnosis or a substitute for nurse judgment.</p></div></div>
          {candidateRuleDraft && <div className="disabled-note">
            <strong>Conservative candidate rule</strong>
            <p>It marks a clinician-observed urgent warning sign for urgent review, and temperatures strictly below 36 °C or above 39 °C for nurse review. The warning-sign screen must be answered after assessment; an unanswered screen blocks saving. A valid reading with no listed sign remains unclassified and still requires the nurse’s full assessment. It does not calculate a weighted score.</p>
            <p>WHO sources: {candidateRuleDraft.sources.map((source, index) => <span key={source.url}>{index > 0 ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}</p>
            <ul>{candidateRuleDraft.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
            {isAdmin && <div className="form-actions">
              <button type="button" className="primary-btn" onClick={createCandidateRuleDraft} disabled={Boolean(savedCandidateRule)}>
                {savedCandidateRule ? `Candidate exists · v${savedCandidateRule.version} (${savedCandidateRule.status})` : 'Create inactive candidate draft'}
              </button>
              <button type="button" className="secondary-btn" onClick={loadCandidateIntoDraft}>Load candidate into draft form</button>
            </div>}
          </div>}
          {testActivationAvailable && <div className="disabled-note risk-test-activation-note" role="status">
            <strong>Development testing</strong>
            <span>Test activation is available to clinic administrators and nurses in this development environment. It keeps the rule in draft, leaves clinician approval fields empty, and labels assessments test_active.</span>
            {testActivation && <span>Currently testing rule version {riskRules.find((rule) => rule.id === testActivation.ruleId)?.version || 'unknown'}.</span>}
            {testActivation && <button type="button" className="secondary-btn" onClick={disableRiskRuleTesting}>Disable test activation</button>}
          </div>}
          {demonstrationRules && <div className="disabled-note">Demonstration rules are visible for testing and remain unapproved. They are the fallback when no clinician-approved version exists; an enabled test rule takes precedence in development.</div>}
          {isAdmin && <form className="inline-entry-form" onSubmit={createRiskRule}><div className="two-fields"><label>Version<input type="number" min="1" value={riskRuleForm.version} onChange={(event) => setRiskRuleForm({ ...riskRuleForm, version: event.target.value })} required /></label><label>Rule set name<input value={riskRuleForm.name} maxLength="120" onChange={(event) => setRiskRuleForm({ ...riskRuleForm, name: event.target.value })} required /></label></div><label>Rules JSON<textarea value={riskRuleForm.rules} onChange={(event) => setRiskRuleForm({ ...riskRuleForm, rules: event.target.value })} placeholder='{"requiredFields":["painScore"],"thresholds":{"moderate":3,"high":7},"indicators":[]}' required /></label><button className="primary-btn">Save draft rule set</button></form>}
          {riskMessage && <p className="success-message" role="status">{riskMessage}</p>}
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Version</th><th>Name</th><th>Status</th><th>Approver</th><th>Action</th></tr></thead><tbody>{riskRules.map((rule) => {
            const isTestActive = testActivation?.ruleId === rule.id;
            const isDraft = rule.status === 'draft';
            const canTest = testActivationAvailable && isDraft && rule.rules?.mode === 'conservative_triage_v1'
              && ['school_nurse', 'system_administrator'].includes(user?.role);
            return <tr key={rule.id}><td>{rule.version}</td><td>{rule.name}</td><td><span className={`status-chip ${rule.status === 'clinician_approved' ? 'success' : 'warn'}`}>{rule.status === 'clinician_approved' ? 'Clinician approved' : isTestActive ? 'Test active · development' : 'Draft — not in use'}</span></td><td>{rule.approved_by || 'None'}</td><td>
              {canTest && (isTestActive
                ? <button type="button" className="table-action" onClick={disableRiskRuleTesting}>Disable test</button>
                : <button type="button" className="table-action" onClick={() => enableRiskRuleForTesting(rule)}>Enable for testing</button>)}
              {user?.role === 'school_nurse' && isDraft && <button type="button" className="table-action" onClick={() => approveRiskRule(rule)} disabled={!currentUserLicenseVerified}>Approve</button>}
              {!canTest && !(user?.role === 'school_nurse' && isDraft) && '—'}
            </td></tr>;
          })}</tbody></table></div>
          {user?.role === 'school_nurse' && !currentUserLicenseVerified && <p className="disabled-note">A system administrator must independently verify and record your PRC license before rule approval is available. Nurses cannot record their own license here. Test activation does not require a PRC license.</p>}
        </section>
      )}

      {activeSection === 'security' && isAdmin && (
        <section className="panel settings-tab-panel audit-history-panel">
          <div className="settings-panel-heading">
            <div>
              <h3>Audit history</h3>
              <p className="field-hint">Recent account access and administrative activity recorded by the server.</p>
            </div>
            <button type="button" className="secondary-btn" onClick={refreshAuditLogs} disabled={auditLoading}>
              <RotateCcw size={15} aria-hidden="true" /> {auditLoading ? 'Refreshing…' : 'Refresh history'}
            </button>
          </div>
          <p className="disabled-note audit-history-note"><ShieldCheck size={14} aria-hidden="true" /> Event details are filtered before display. Manage active sessions under My Account; server security settings are controlled by deployment configuration.</p>
          {auditLoading && <p className="field-hint" role="status">Loading audit history…</p>}
          {auditError && <div className="error-banner" role="alert">{auditError}</div>}
          {!auditLoading && !auditError && auditLogs.length === 0 && <p className="empty-state audit-history-empty">No audit activity is available yet.</p>}
          {auditLogs.length > 0 && <>
            <div className="admin-table-wrap">
              <table className="admin-table audit-history-table" aria-label="Recent audit activity">
                <thead><tr><th>Date and time</th><th>Activity</th><th>Actor or account</th><th>Details</th></tr></thead>
                <tbody>{auditLogs.map((entry, index) => {
                  const meta = getAuditMeta(entry.event);
                  const timestamp = new Date(entry.timestamp);
                  const timeLabel = Number.isNaN(timestamp.getTime()) ? 'Time unavailable' : timestamp.toLocaleString();
                  return <tr key={entry.id || `${entry.timestamp}-${entry.event}-${index}`}>
                    <td><time dateTime={Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()}>{timeLabel}</time></td>
                    <td><strong>{meta.label}</strong><small>{meta.group}</small></td>
                    <td>{getAuditSubject(entry, users)}</td>
                    <td className="audit-history-details">{formatAuditDetails(entry.details)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p className="audit-history-count">Showing the latest {auditLogs.length} events from the server audit log.</p>
          </>}
        </section>
      )}

      {activeSection === 'data' && (
        <div className="settings-layout settings-import-layout">
          {isAdmin && <section className="panel settings-tab-panel narrow-panel settings-export-panel">
            <div className="settings-panel-heading"><div><h3>Data & reports</h3><p className="field-hint">Exports include only data visible to this account. CSV imports preview row errors and duplicates before saving.</p></div></div>
            <div className="data-command-grid"><button className="data-action" onClick={exportData}><Download size={17} /><span><strong>Export oversight data</strong><small>Spreadsheet-safe settings and roster export</small></span></button><button className="data-action" onClick={exportOversightSnapshot}><Database size={17} /><span><strong>Download oversight snapshot</strong><small>JSON of the settings and roster visible to this account</small></span></button></div>
            <p className="disabled-note">Clinical visit imports are restricted to school nurses. Schedule encrypted database backups with the hosting provider; local exports are manual.</p>
          </section>}
          {isAdmin && <ImportPanel type="students" title="Import student roster" description="Import only student ID, name, grade, section, and adviser. Link guardian accounts separately." onComplete={reload} />}
          <ImportPanel type="faculty" title="Import faculty profiles" description="Preview faculty IDs, profile fields, and duplicates. IDs are checked against student records too." onComplete={reload} />
          {!isAdmin && <ImportPanel type="visits" title="Import historical visits" description="Preview patient matching, dates, row errors, and duplicates before saving historical visits." onComplete={reload} />}
        </div>
      )}

      {activeSection === 'schedule' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><p className="section-kicker">Assigned by administrator</p><h3>My schedule</h3></div><span className="settings-badge">View only</span></div><div className="schedule-card"><strong>Monday – Friday</strong><span>08:00 AM – 04:00 PM</span><small>Assigned grade / section: All clinic referrals</small></div></section>}
      {activeSection === 'reports' && !isAdmin && <section className="panel settings-tab-panel narrow-panel"><div className="settings-panel-heading"><div><h3>My reports</h3><p className="field-hint">Staff reports are available from the Reports page.</p></div></div><p className="disabled-note">A personal export is not available yet because report access is scoped to authorized clinic-wide aggregates.</p><button className="secondary-btn" onClick={() => window.location.assign('/reports')}><FileBarChart size={15} /> Open reports</button></section>}

      {activeSection === 'school' && isAdmin && <div className="settings-layout">
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
          <p className="disabled-note" title="Sample reset is unavailable for server-backed records">
            <RotateCcw size={17} /> Sample data cannot replace server-backed records.
          </p>
          </>}
        </aside>
      </div>}
    </div>
  );
}
