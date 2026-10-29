import ModalDialog from '../components/ModalDialog';
import useConfirmation from "../hooks/useConfirmation";
import { useRef, useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Check, Database, Download, Lock, RotateCcw, ShieldCheck, Upload, X, UserCog, Bell, FileBarChart, KeyRound } from "lucide-react";
import { downloadCsv } from "../utils/csv";
import { api } from "../utils/api";
import ImportPanel from "../components/ImportPanel";
import RiskRuleBuilder, { RiskRuleDetails } from "../components/RiskRuleBuilder";
import StudentPicker from "../components/StudentPicker";
import ListPagination from "../components/ListPagination";
import GuardianSignupRequests from "../components/GuardianSignupRequests.jsx";
import { compareValues, readListState, sortAndPaginate, updateListParams } from "../utils/listState";
import {
  getAuditLogs,
  getUsersForAdmin,
  createManagedUser,
  resendInvitation,
  updateUserStatus,
  changePassword,
  authenticateUser,
} from "../utils/auth";
import { describeRiskCondition, riskRuleFormFromRule } from "../utils/riskRules";

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
  GUARDIAN_SIGNUP_REQUESTED: { label: "Guardian signup verification requested", tone: "security", group: "People" },
  GUARDIAN_SELF_SIGNUP_COMPLETED: { label: "Guardian account created", tone: "positive", group: "People" },
  DASHBOARD_PREFERENCES_UPDATED: { label: "Dashboard preferences updated", tone: "neutral", group: "System" },
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
  return entry.actor_name || entry.actor_email || actor?.name || actor?.email || details.username || details.email || details.approvedBy || (entry.actor_user_id ? 'Account unavailable' : 'System');
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
  const { confirmAction, confirmationDialog } = useConfirmation();
  const confirmedActionLock = useRef(false);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditPage, setAuditPage] = useState({ previousCursor: null, nextCursor: null, hasPrevious: false, hasNext: false });
  const [auditRetry, setAuditRetry] = useState(0);
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
  const [currentUserLicenseVerified, setCurrentUserLicenseVerified] = useState(false);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskLoadError, setRiskLoadError] = useState('');
  const [riskActionBusy, setRiskActionBusy] = useState('');
  const [riskMessage, setRiskMessage] = useState(null);
  const [riskEditorSeed, setRiskEditorSeed] = useState(null);
  const [riskAdvancedOpen, setRiskAdvancedOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const isAdmin = user?.role === 'system_administrator';
  const savedCandidateRule = riskRules.find((rule) => rule.rules?.mode === 'conservative_triage_v1');
  const reusableCandidateRule = riskRules.find((rule) => rule.rules?.mode === 'conservative_triage_v1' && rule.status !== 'retired');
  const currentRiskRule = riskRules.find((rule) => rule.status === 'clinician_approved');
  const [users, setUsers] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
  const [guardianLinkTarget, setGuardianLinkTarget] = useState(null);
  const [guardianLinkForm, setGuardianLinkForm] = useState({ patientId: '', relationship: 'Parent' });
  const [guardianLinkSaving, setGuardianLinkSaving] = useState(false);
  const [nurseLicenseTarget, setNurseLicenseTarget] = useState(null);
  const [nurseLicenseNumber, setNurseLicenseNumber] = useState('');
  const [licenseVerificationConfirmed, setLicenseVerificationConfirmed] = useState(false);
  const [licenseSaving, setLicenseSaving] = useState(false);
  const contextSaveLock = useRef(false);
  const linkableStudents = Array.isArray(data?.students)
    ? data.students.filter((student) => student.patientType === 'student')
    : [];
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
  const userListState = readListState(searchParams, { sort: 'name', order: 'asc', pageSize: 25 });
  const roleFilter = searchParams.get('role') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const filteredUsers = users.filter((account) => {
    if (userFilter === 'active' && account.status !== 'active') return false;
    if (userFilter === 'invited' && account.status !== 'invited') return false;
    if (userFilter === 'nurses' && account.role !== 'school_nurse') return false;
    if (userFilter === 'restricted' && account.status === 'active') return false;
    if (roleFilter !== 'all' && account.role !== roleFilter) return false;
    if (statusFilter !== 'all' && account.status !== statusFilter) return false;
    const query = userListState.q.trim().toLocaleLowerCase();
    return !query || [account.name, account.email, account.username].some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
  const userSortGetters = { name: (account) => account.name, role: (account) => account.role, status: (account) => account.status, created: (account) => account.createdAt, lastLogin: (account) => account.lastLogin };
  const getUserSortValue = userSortGetters[userListState.sort] || userSortGetters.name;
  const userPage = sortAndPaginate(filteredUsers, (first, second, order) => compareValues(getUserSortValue(first), getUserSortValue(second), order), userListState);
  const visibleUsers = userPage.items;

  const refreshSessions = async () => {
    try {
      const result = await api.get('/api/auth/sessions');
      setSessions(result.sessions || []);
      setSessionsError('');
    } catch (error) {
      setSessionsError(error.message);
    }
  };

  const auditQuery = {
    event: searchParams.get('event') || '', actorId: searchParams.get('actorId') || '',
    start: searchParams.get('auditStart') || '', end: searchParams.get('auditEnd') || '',
    order: searchParams.get('auditOrder') === 'oldest' ? 'oldest' : 'newest',
    limit: [10, 25, 50].includes(Number(searchParams.get('auditLimit'))) ? Number(searchParams.get('auditLimit')) : 25,
    cursor: searchParams.get('cursor') || '',
  };
  const updateAuditFilter = (updates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    if (!Object.hasOwn(updates, 'cursor')) next.delete('cursor');
    setSearchParams(next);
  };

  useEffect(() => {
    if (!isAdmin || activeSection !== 'security') return undefined;
    let active = true;
    setAuditLoading(true);
    setAuditError('');
    getAuditLogs({ ...auditQuery, throwOnError: true })
      .then((result) => { if (active) { setAuditLogs(result.logs); setAuditPage(result); } })
      .catch((error) => { if (active) setAuditError(error.message || 'Audit history could not be loaded. Try refreshing.'); })
      .finally(() => { if (active) setAuditLoading(false); });
    return () => { active = false; };
  }, [isAdmin, activeSection, auditQuery.event, auditQuery.actorId, auditQuery.start, auditQuery.end, auditQuery.order, auditQuery.limit, auditQuery.cursor, auditRetry]);

  useEffect(() => {
    if (activeSection === 'users' && userPage.page !== userListState.page) {
      updateListParams(searchParams, setSearchParams, { page: userPage.page }, { replace: true });
    }
  }, [activeSection, userPage.page, userListState.page, searchParams, setSearchParams]);

  useEffect(() => {
    feedbackScopeRef.current = feedbackScope;
    clearUserActionFeedback();
    setReviewMessage('');
    setReminderMessage('');
    setSessionMessage('');
    setSessionsError('');
    setBroadcastMessage(null);
    setRiskMessage(null);
    return () => {
      if (userActionFeedbackTimerRef.current) window.clearTimeout(userActionFeedbackTimerRef.current);
      userActionFeedbackTimerRef.current = null;
    };
  }, [feedbackScope]);

  useEffect(() => {
    if (activeSection === 'account') refreshSessions();
    loadRiskRules();
    if (!isAdmin) return;
    if (activeSection === 'security') {
      getUsersForAdmin().then(setUsers);
    }
    if (activeSection === 'users') {
      getUsersForAdmin().then((accounts) => {
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
    if (confirmedActionLock.current) return;
    confirmedActionLock.current = true;
    if (!await confirmAction({
      title: session.current ? 'Sign out this browser?' : 'Sign out this session?',
      message: session.current ? 'You will need to sign in again to continue in this browser.' : 'That session will need to sign in again. Your current browser will stay signed in.',
      confirmLabel: 'Sign out',
    })) {
      confirmedActionLock.current = false;
      return;
    }
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
    } finally {
      confirmedActionLock.current = false;
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

  const refreshUsers = async () => {
    const accounts = await getUsersForAdmin();
    setUsers(accounts);
  };

  const openNurseLicenseEditor = (account) => {
    setNurseLicenseTarget(account);
    setNurseLicenseNumber('');
    setLicenseVerificationConfirmed(false);
  };
  const updateNurseLicense = async (event) => {
    event.preventDefault();
    if (!nurseLicenseTarget || contextSaveLock.current) return;
    contextSaveLock.current = true;
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
      await refreshUsers();
    } catch (error) {
      showScopedUserActionFeedback(scope, 'error', error.message);
    } finally {
      contextSaveLock.current = false;
      setLicenseSaving(false);
    }
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
    data: ['Data & Imports', 'Review oversight exports and roster imports.'],
    notifications: ['Communications', 'Send a clinic notice or process due reminders.'],
    risk: ['Risk Rules', 'See which review prompts are in use. Custom rules are optional.'],
    security: ['Audit history', 'Review recent access, account, clinic, and system activity.'],
  };
  const [adminPageTitle, adminPageDescription] = adminPageDetails[activeSection] || adminPageDetails.account;
  const nursePageDetails = {
    account: ['My account', 'Manage your password and sign-in preferences.'],
    data: ['Data & Imports', 'Import authorized historical clinic records and review roster workflows.'],
    risk: ['Risk Rules', 'See which review prompts are in use. Custom rules are optional.'],
  };
  const [nursePageTitle, nursePageDescription] = nursePageDetails[activeSection] || nursePageDetails.account;
  const updateUserFilter = (value) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value === 'all') nextParams.delete('filter');
    else nextParams.set('filter', value);
    nextParams.delete('page');
    setSearchParams(nextParams);
  };

  const triggerReminders = async () => {
    const scope = feedbackScopeRef.current;
    setReminderMessage('');
    try {
      const result = await api.post('/api/admin/notifications/reminders', {});
      setScopedFeedback(scope, setReminderMessage, `${result.triggered} due item${result.triggered === 1 ? '' : 's'} processed, including ${result.consents || 0} consent reminder${result.consents === 1 ? '' : 's'}; ${result.notificationFailures || 0} email delivery failures or unconfirmed results. Repeated runs are deduplicated.`);
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
    setRiskLoading(true);
    setRiskLoadError('');
    try {
      const result = await api.get('/api/risk/rules');
      setRiskRules(result.rules || []);
      setDemonstrationRules(result.demonstrationRules || null);
      setCandidateRuleDraft(result.candidateRuleDraft || null);
      setCurrentUserLicenseVerified(Boolean(result.currentUserLicenseVerified));
    } catch (error) {
      setRiskLoadError(error.message || 'Risk rules could not be loaded. Try refreshing.');
    } finally {
      setRiskLoading(false);
    }
  };
  const setRiskFeedback = (tone, text, position = 'builder') => setRiskMessage({ tone, text, position });
  const setScopedRiskFeedback = (scope, tone, text, position = 'builder') => {
    if (feedbackScopeRef.current === scope) setRiskFeedback(tone, text, position);
  };
  const createCandidateRuleDraft = async () => {
    const scope = feedbackScopeRef.current;
    setRiskMessage(null);
    setRiskActionBusy('candidate');
    try {
      const result = await api.post('/api/risk/rules/conservative-candidate', {});
      setScopedRiskFeedback(scope, 'success', result.created
        ? 'The optional screening candidate was saved for nurse review. It will not be used unless a verified school nurse approves it.'
        : 'An optional screening candidate already exists. No duplicate was created.', 'candidate');
      await loadRiskRules();
    } catch (error) {
      setScopedRiskFeedback(scope, 'error', error.message || 'The candidate draft could not be created.', 'candidate');
    } finally {
      setRiskActionBusy('');
    }
  };
  const createRiskRule = async ({ name, rules }) => {
    const scope = feedbackScopeRef.current;
    setRiskMessage(null);
    setRiskActionBusy('create');
    try {
      await api.post('/api/risk/rules', { name, rules });
      setScopedRiskFeedback(scope, 'success', 'Custom rules saved for nurse review. They will only be used after a verified school nurse approves them.');
      await loadRiskRules();
      return true;
    } catch (error) {
      setScopedRiskFeedback(scope, 'error', error.message || 'The inactive draft could not be saved.');
      return false;
    } finally {
      setRiskActionBusy('');
    }
  };
  const approveRiskRule = async (rule) => {
    const scope = feedbackScopeRef.current;
    setRiskMessage(null);
    setRiskActionBusy(`approve:${rule.id}`);
    try {
      await api.patch(`/api/risk/rules/${encodeURIComponent(rule.id)}/approve`, {});
      setScopedRiskFeedback(scope, 'success', 'Custom rules approved and now in use. The previously approved rules were retired.', rule.id);
      await loadRiskRules();
    } catch (error) {
      setScopedRiskFeedback(scope, 'error', error.message || 'The rule could not be approved.', rule.id);
    } finally {
      setRiskActionBusy('');
    }
  };
  const copyRiskRuleToDraft = (rule) => {
    if (!riskRuleFormFromRule(rule)) return;
    setRiskAdvancedOpen(true);
    setRiskEditorSeed({ rule, revision: (riskEditorSeed?.revision || 0) + 1 });
    setRiskFeedback('success', 'This rule is loaded below as a starting point. Review it, then save it for nurse approval.', 'builder');
  };
  const handleCreateUser = async (event) => {
    event.preventDefault();
    if (inviteSaving || contextSaveLock.current) return;
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    if (newUser.role === 'Guardian' && !linkableStudents.some((student) => String(student.id) === String(newUser.patientId))) {
      showScopedUserActionFeedback(scope, 'error', 'Choose a student from the search results before sending this guardian invitation.');
      return;
    }
    contextSaveLock.current = true;
    setInviteSaving(true);
    try {
      const result = await createManagedUser(newUser);
      const invitationSent = result.success && result.emailSent !== false;
      showScopedUserActionFeedback(scope, invitationSent ? 'success' : 'error', result.success ? (result.emailSent === false ? result.message : 'Invitation sent successfully.') : result.error);
      if (result.success) {
        setNewUser({ name: '', email: '', role: 'Nurse', patientId: '', relationship: 'Guardian' });
        setShowUserForm(false);
        await refreshUsers();
      }
    } finally {
      contextSaveLock.current = false;
      setInviteSaving(false);
    }
  };
  const handleUserStatus = async (account) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const result = await updateUserStatus(account.id, account.status === 'active' ? 'deactivated' : 'active');
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? `${account.name} is now ${account.status === 'active' ? 'inactive' : 'active'}.` : result.error);
    await refreshUsers();
  };
  const handleResendInvitation = async (account) => {
    const scope = feedbackScopeRef.current;
    clearUserActionFeedback();
    const result = await resendInvitation(account.id);
    showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? result.message : result.error);
    if (result.success) await refreshUsers();
  };
  const handleCancelInvitation = async (account) => {
    if (confirmedActionLock.current) return;
    confirmedActionLock.current = true;
    if (!await confirmAction({
      title: 'Cancel invitation?',
      message: `The activation link for ${account.name} will stop working.`,
      confirmLabel: 'Cancel invitation',
      cancelLabel: 'Keep invitation',
    })) {
      confirmedActionLock.current = false;
      return;
    }
    try {
      const scope = feedbackScopeRef.current;
      clearUserActionFeedback();
      const result = await updateUserStatus(account.id, 'deactivated');
      showScopedUserActionFeedback(scope, result.success ? 'success' : 'error', result.success ? `Invitation canceled for ${account.name}.` : result.error);
      if (result.success) await refreshUsers();
    } finally {
      confirmedActionLock.current = false;
    }
  };
  const saveGuardianLink = async (event) => {
    event.preventDefault();
    if (contextSaveLock.current || guardianLinkSaving || !guardianLinkTarget || !guardianLinkForm.relationship.trim()) return;
    const scope = feedbackScopeRef.current;
    if (!linkableStudents.some((student) => String(student.id) === String(guardianLinkForm.patientId))) {
      showScopedUserActionFeedback(scope, 'error', 'Choose a student from the search results before saving this link.');
      return;
    }
    contextSaveLock.current = true;
    setGuardianLinkSaving(true);
    clearUserActionFeedback();
    try {
      await api.patch(`/api/admin/users/${encodeURIComponent(guardianLinkTarget.id)}/patient-link`, guardianLinkForm);
      showScopedUserActionFeedback(scope, 'success', `${guardianLinkTarget.name} is linked to the selected student. Activate the account separately if it is suspended.`);
      setGuardianLinkTarget(null);
      await refreshUsers();
    } catch (error) {
      showScopedUserActionFeedback(scope, 'error', error.message || 'The guardian link could not be saved.');
    } finally { contextSaveLock.current = false; setGuardianLinkSaving(false); }
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
      {confirmationDialog}
      <div className="page-intro">
        <div>
          {activeSection !== 'data' && <p className="section-kicker">{isAdmin ? 'Administration' : activeSection === 'account' ? 'Workspace preferences' : 'Clinic operations'}</p>}
          {activeSection !== 'data' && <h2>{isAdmin ? adminPageTitle : nursePageTitle}</h2>}
          <p>{isAdmin ? adminPageDescription : nursePageDescription}</p>
        </div>
      </div>

      {activeSection === 'account' && (
        <section className="panel settings-tab-panel">
          <div className="settings-panel-heading"><div><p className="section-kicker">{isAdmin ? 'Administrator identity' : 'Staff identity'}</p><h3>{isAdmin ? 'Account settings' : 'My account'}</h3></div><span className="settings-badge">{isAdmin ? 'Full access' : 'Clinic staff'}</span></div>
          <div className="profile-settings-grid">
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
          <div className="settings-panel-heading"><div><p className="section-kicker">Access control</p><h3>User management</h3></div><button className="primary-btn" onClick={() => { clearUserActionFeedback(); setShowUserForm(true); }}><UserCog size={15} /> Add new user</button></div>
          <div className="settings-users-toolbar">
            <p className="tab-description">Invite staff or manage administrator-issued guardian invitations. Self-registered guardians remain pending until you verify their relationship against school records. Administrators record nurse PRC verification here.</p>
            <label>Show accounts
              <select value={['all', 'active', 'invited', 'nurses', 'restricted'].includes(userFilter) ? userFilter : 'all'} onChange={(event) => updateUserFilter(event.target.value)}>
                <option value="all">All accounts</option>
                <option value="active">Active</option>
                <option value="invited">Pending invites</option>
                <option value="nurses">Nurse accounts</option>
                <option value="restricted">Restricted or pending</option>
              </select>
            </label>
            <label className="settings-users-filter-field settings-users-search-field"><span>Search accounts</span><span className="search-box settings-users-search-box"><input type="search" aria-label="Search name, email, or username" value={userListState.q} placeholder="Name, email, or username" onChange={(event) => updateListParams(searchParams, setSearchParams, { q: event.target.value }, { resetPage: true })} /></span></label>
            <label>Role<select value={roleFilter} onChange={(event) => updateListParams(searchParams, setSearchParams, { role: event.target.value === 'all' ? null : event.target.value }, { resetPage: true })}><option value="all">All roles</option><option value="system_administrator">Administrator</option><option value="school_nurse">Nurse</option><option value="guardian">Guardian</option><option value="student">Student account</option></select></label>
            <label>Status<select value={statusFilter} onChange={(event) => updateListParams(searchParams, setSearchParams, { status: event.target.value === 'all' ? null : event.target.value }, { resetPage: true })}><option value="all">All statuses</option><option value="active">Active</option><option value="invited">Invited</option><option value="deactivated">Deactivated</option></select></label>
            <label>Sort by<select value={userSortGetters[userListState.sort] ? userListState.sort : 'name'} onChange={(event) => updateListParams(searchParams, setSearchParams, { sort: event.target.value }, { resetPage: true })}><option value="name">Name</option><option value="role">Role</option><option value="status">Status</option><option value="created">Created</option><option value="lastLogin">Last login</option></select></label>
            <label>Order<select value={userListState.order} onChange={(event) => updateListParams(searchParams, setSearchParams, { order: event.target.value }, { resetPage: true })}><option value="asc">A to Z / oldest</option><option value="desc">Z to A / newest</option></select></label>
          </div>
          {showUserForm && <ModalDialog open title="Invite user" eyebrow="Account access" historyKey="invite-user" onClose={() => setShowUserForm(false)} busy={inviteSaving} className="admin-context-dialog"><form className="context-dialog-form" onSubmit={handleCreateUser}>
            {userActionFeedback?.tone === 'error' && <div className="error-banner" role="alert">{userActionFeedback.message}</div>}
            <label>Name<input value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} required disabled={inviteSaving} /></label>
            <label>Email<input type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} required disabled={inviteSaving} /></label>
            <label>Role<select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value, patientId: '' })} disabled={inviteSaving}><option>Admin</option><option>Nurse</option><option>Guardian</option></select></label>
            {newUser.role === 'Guardian' && <>
              <StudentPicker
                students={linkableStudents}
                value={newUser.patientId}
                onChange={(patientId) => setNewUser((current) => ({ ...current, patientId }))}
                label="Linked student"
                itemLabel="student"
                searchPlaceholder="Search by student name or ID"
                description="Choose a student from the results. Typing alone does not select a record."
                required
                disabled={inviteSaving}
              />
              <label>Relationship<input value={newUser.relationship} onChange={(event) => setNewUser({ ...newUser, relationship: event.target.value })} required disabled={inviteSaving} /></label>
            </>}
            <button type="submit" className="primary-btn" disabled={inviteSaving || (newUser.role === 'Guardian' && !newUser.patientId)}>{inviteSaving ? 'Sending…' : 'Send invitation'}</button>
          <div className="form-actions"><button type="button" className="secondary-btn" disabled={inviteSaving} onClick={() => setShowUserForm(false)}>Cancel</button></div></form></ModalDialog>}
          {guardianLinkTarget && <ModalDialog open title={`Link student · ${guardianLinkTarget.name}`} eyebrow="Guardian access" historyKey="link-student" onClose={() => setGuardianLinkTarget(null)} busy={guardianLinkSaving} className="admin-context-dialog"><form className="context-dialog-form" onSubmit={saveGuardianLink}>
            {userActionFeedback?.tone === 'error' && <div className="error-banner" role="alert">{userActionFeedback.message}</div>}
            <div><h4>Link student to {guardianLinkTarget.name}</h4><p className="field-hint">Only student roster records can be linked. Suspended accounts require a separate activation after relinking.</p></div>
            <StudentPicker
              students={linkableStudents}
              value={guardianLinkForm.patientId}
              onChange={(patientId) => setGuardianLinkForm((current) => ({ ...current, patientId }))}
              label="Student record"
              itemLabel="student"
              searchPlaceholder="Search by student name or ID"
              description="Choose a student from the results. Typing alone does not select a record."
              required
              disabled={guardianLinkSaving}
            />
            <label>Guardian relationship<input maxLength={80} value={guardianLinkForm.relationship} onChange={(event) => setGuardianLinkForm((current) => ({ ...current, relationship: event.target.value }))} required disabled={guardianLinkSaving} /></label>
            <button type="submit" className="primary-btn" disabled={guardianLinkSaving || !guardianLinkForm.patientId}>{guardianLinkSaving ? 'Saving…' : 'Save guardian link'}</button>
            <button type="button" className="secondary-btn" onClick={() => setGuardianLinkTarget(null)} disabled={guardianLinkSaving}>Cancel</button>
          </form></ModalDialog>}
          {userActionFeedback && <div className={userActionFeedback.tone === 'error' ? 'error-banner' : 'success-message'} role={userActionFeedback.tone === 'error' ? 'alert' : 'status'}>{userActionFeedback.tone === 'success' && <Check size={14} aria-hidden="true" />} {userActionFeedback.message}</div>}
          <p className="disabled-note nurse-license-admin-note">Only administrators can record a nurse’s PRC license, after independently verifying it against an authoritative source. This list shows the recording status without displaying the license number.</p>
          {nurseLicenseTarget && <ModalDialog open title={`Verified PRC license · ${nurseLicenseTarget.name}`} eyebrow="Nurse verification" historyKey="nurse-license" onClose={() => setNurseLicenseTarget(null)} busy={licenseSaving} className="admin-context-dialog"><form className="context-dialog-form" onSubmit={updateNurseLicense}>
            {userActionFeedback?.tone === 'error' && <div className="error-banner" role="alert">{userActionFeedback.message}</div>}
            <div><h4>PRC license for {nurseLicenseTarget.name}</h4><p>Current status: {nurseLicenseTarget.prcLicenseVerified ? 'recorded by an administrator' : 'not recorded'}. The current number is not displayed.</p></div>
            <label>PRC license number<input type="text" disabled={licenseSaving} value={nurseLicenseNumber} maxLength={80} autoComplete="off" onChange={(event) => setNurseLicenseNumber(event.target.value)} placeholder="Enter a verified number, or leave blank to clear" /></label>
            {Boolean(nurseLicenseNumber.trim()) && <label className="check-label"><input type="checkbox" checked={licenseVerificationConfirmed} disabled={licenseSaving} onChange={(event) => setLicenseVerificationConfirmed(event.target.checked)} required /> I independently verified this license against an authoritative source.</label>}
            <div className="form-actions"><button type="submit" className="primary-btn" disabled={licenseSaving || (Boolean(nurseLicenseNumber.trim()) && !licenseVerificationConfirmed) || (!nurseLicenseNumber.trim() && !nurseLicenseTarget.prcLicenseNumber)}>{licenseSaving ? 'Saving…' : nurseLicenseNumber.trim() ? 'Record verified license' : 'Clear license record'}</button><button type="button" className="secondary-btn" onClick={() => setNurseLicenseTarget(null)} disabled={licenseSaving}>Cancel</button></div>
          </form></ModalDialog>}
          <div className="admin-table-wrap"><table className="admin-table settings-users-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th>PRC license</th><th>Last login</th><th>Actions</th></tr></thead><tbody>{visibleUsers.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small>@{account.username}</small></td><td>{({ system_administrator: 'Admin', school_nurse: 'Nurse', student: 'Student (login removed)', guardian: 'Guardian' })[account.role] || account.role}</td><td>{account.email}</td><td><span className={`status-chip ${account.status === 'active' ? 'success' : 'warn'}`}>{account.status}</span></td><td>{account.role === 'school_nurse' ? <span className={`status-chip ${account.prcLicenseVerified ? 'success' : 'warn'}`}>{account.prcLicenseVerified ? 'Recorded by admin' : 'Not recorded'}</span> : '—'}</td><td>{account.lastLogin ? new Date(account.lastLogin).toLocaleDateString() : 'Never'}</td><td>{account.role === 'student' ? 'Student sign-in is disabled' : <>{account.status === 'invited' ? <><button type="button" className="table-action" onClick={() => handleResendInvitation(account)}>Resend invitation</button><button type="button" className="table-action" onClick={() => handleCancelInvitation(account)}>Cancel invitation</button></> : account.status === 'deactivated' && !account.invitationAccepted && account.username === `invited-${account.id.slice(0, 8)}` ? <button type="button" className="table-action" onClick={() => handleResendInvitation(account)}>Send new invitation</button> : <button type="button" className="table-action" onClick={() => handleUserStatus(account)}>{account.status === 'active' ? 'Deactivate' : 'Activate'}</button>}{account.role === 'guardian' && <button type="button" className="table-action" onClick={() => { clearUserActionFeedback(); setGuardianLinkTarget(account); setGuardianLinkForm({ patientId: '', relationship: 'Parent' }); }}>Link student</button>}{account.role === 'school_nurse' && <button type="button" className="table-action" onClick={() => { clearUserActionFeedback(); openNurseLicenseEditor(account); }}>{account.prcLicenseVerified ? 'Update or clear license' : 'Record verified license'}</button>}</>}</td></tr>)}</tbody></table>{visibleUsers.length === 0 && <p className="empty-state">{users.length ? 'No accounts match this filter.' : 'No system accounts are available yet.'}</p>}</div>
          <ListPagination page={userPage.page} pageCount={userPage.pageCount} pageSize={userPage.pageSize} total={userPage.total} onPageChange={(page) => updateListParams(searchParams, setSearchParams, { page })} onPageSizeChange={(pageSize) => updateListParams(searchParams, setSearchParams, { pageSize }, { resetPage: true })} />
          <GuardianSignupRequests students={linkableStudents} />
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
          <div className="settings-panel-heading">
            <div><h3>Risk rules</h3><p className="field-hint">Rules offer prompts for nurse review. They do not diagnose or replace clinical judgment.</p></div>
            <button type="button" className="secondary-btn" onClick={loadRiskRules} disabled={riskLoading || Boolean(riskActionBusy)}>{riskLoading ? 'Refreshing…' : 'Refresh rules'}</button>
          </div>
          {riskLoadError && <div className="risk-feedback is-error" role="alert"><span>{riskLoadError}</span><button type="button" className="secondary-btn" onClick={loadRiskRules} disabled={riskLoading}>{riskLoading ? 'Retrying…' : 'Try again'}</button></div>}
          {riskLoading && !demonstrationRules && <p className="risk-loading" role="status">Checking which rules are in use…</p>}
          {demonstrationRules && currentRiskRule && <div className="risk-current-rule">
            <div className="risk-current-rule-heading"><div><h4>Clinician-approved custom rules are in use</h4><p>{currentRiskRule.name}</p></div><span className="status-chip success">Approved by a nurse</span></div>
            <p>For each visit, complete the full assessment and use your clinical judgment with these prompts.</p>
            <RiskRuleDetails rule={currentRiskRule} />
          </div>}
          {demonstrationRules && !currentRiskRule && <div className="risk-sample-card">
            <div className="risk-sample-heading"><h4>Sample risk rules are automatically in use</h4><span className="status-chip warn">Not approved by a nurse</span></div>
            <p>No setup is needed. This sample is used whenever there are no clinician-approved custom rules. Its values are not nurse-approved or clinically validated.</p>
            <p className="risk-sample-next-step">For every visit, complete the full assessment, review the student's condition, and decide care yourself.</p>
            <details className="risk-sample-details">
              <summary>See how sample rules work</summary>
              <p>Each matching condition adds points. A measurement can match more than one condition, and those points add together. The score bands begin at {demonstrationRules.thresholds.moderate} points for moderate and {demonstrationRules.thresholds.high} points for high.</p>
              <ul>{demonstrationRules.indicators.map((indicator, index) => <li key={`${indicator.field}-${indicator.operator}-${index}`}><strong>{indicator.label}</strong><span>{describeRiskCondition(indicator)}; adds {indicator.weight} point{Number(indicator.weight) === 1 ? '' : 's'}.</span></li>)}</ul>
            </details>
          </div>}
          <details className="risk-advanced" open={riskAdvancedOpen} onToggle={(event) => setRiskAdvancedOpen(event.currentTarget.open)}>
            <summary>Advanced: manage custom rules</summary>
            <p className="risk-advanced-intro">Custom rules are optional. Saving a rule does not change assessments; a verified school nurse must approve it before it can be used.</p>
            {candidateRuleDraft && <div className="risk-candidate-card">
              <h4>Optional WHO-informed screening candidate</h4>
              <p>This partial screening option does not replace a full assessment. {reusableCandidateRule?.status === 'clinician_approved' ? 'A verified school nurse approved it, and it is currently in use.' : 'It stays out of use until a verified school nurse approves it.'}</p>
              {reusableCandidateRule && <p className={currentRiskRule?.id === reusableCandidateRule.id ? 'risk-current-label' : 'risk-candidate-state'}>{currentRiskRule?.id === reusableCandidateRule.id ? 'Approved and in use' : reusableCandidateRule.status === 'draft' ? 'Saved for nurse review' : 'Retired'}</p>}
              <details className="risk-candidate-details">
                <summary>Sources and limits of this option</summary>
                <p className="risk-source-links">WHO sources: {candidateRuleDraft.sources.map((source, index) => <span key={source.url}>{index > 0 ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}</p>
                <ul>{candidateRuleDraft.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
              </details>
              <div className="form-actions">
                <button type="button" className="secondary-btn" onClick={createCandidateRuleDraft} disabled={riskLoading || Boolean(riskActionBusy) || Boolean(reusableCandidateRule)}>
                  {riskActionBusy === 'candidate' ? 'Saving…' : reusableCandidateRule?.status === 'clinician_approved' ? 'Approved and in use' : reusableCandidateRule ? 'Saved for nurse review' : 'Save candidate for nurse review'}
                </button>
                {savedCandidateRule?.status === 'retired' && !reusableCandidateRule && <span className="field-hint">The earlier candidate is retired. Saving it again creates a new version.</span>}
              </div>
              {riskMessage?.position === 'candidate' && <p className={`risk-feedback ${riskMessage.tone === 'error' ? 'is-error' : 'is-success'}`} role={riskMessage.tone === 'error' ? 'alert' : 'status'}>{riskMessage.text}</p>}
            </div>}
            {riskMessage?.position === 'builder' && <p className={`risk-feedback ${riskMessage.tone === 'error' ? 'is-error' : 'is-success'}`} role={riskMessage.tone === 'error' ? 'alert' : 'status'}>{riskMessage.text}</p>}
            <RiskRuleBuilder onSave={createRiskRule} saving={riskActionBusy === 'create'} busy={riskLoading || Boolean(riskActionBusy)} demonstrationRules={demonstrationRules} seed={riskEditorSeed} />

            <div className="risk-rules-heading"><div><h4>Saved custom rules</h4><p>Review conditions, approval dates, and earlier versions here.</p></div>{currentRiskRule && <span className="risk-current-label">Currently in use · version {currentRiskRule.version}</span>}</div>
            {!riskLoading && !riskLoadError && riskRules.length === 0 && <p className="risk-empty-state">No custom rules have been saved.</p>}
            <div className="risk-rule-list">
              {riskRules.map((rule) => {
                const isDraft = rule.status === 'draft';
                const isCurrent = currentRiskRule?.id === rule.id;
                const canCopy = !rule.rules?.mode && Boolean(riskRuleFormFromRule(rule));
                const busy = riskLoading || Boolean(riskActionBusy);
                const statusLabel = rule.status === 'clinician_approved' ? 'Clinician approved'
                  : rule.status === 'retired' ? 'No longer active'
                    : 'Waiting for nurse approval';
                const approvedAt = rule.approved_at ? new Date(rule.approved_at) : null;
                const approvedDate = approvedAt && !Number.isNaN(approvedAt.getTime()) ? approvedAt.toLocaleDateString() : '';
                const approvalRecorded = Boolean(rule.approved_at || rule.status === 'clinician_approved');
                return <article className="risk-rule-card" key={rule.id}>
                  <div className="risk-rule-card-heading">
                    <div><p className="section-kicker">Version {rule.version}</p><h5>{rule.name}</h5></div>
                    <div className="risk-rule-badges">
                      <span className={`status-chip ${rule.status === 'clinician_approved' || isCurrent ? 'success' : rule.status === 'retired' ? 'neutral' : 'warn'}`}>{statusLabel}</span>
                      {isCurrent && <span className="risk-current-label">Currently used</span>}
                    </div>
                  </div>
                  <RiskRuleDetails rule={rule} />
                  <div className="risk-rule-card-footer">
                    <span>{approvalRecorded ? `Nurse approval recorded${approvedDate ? ` · ${approvedDate}` : ''}` : rule.status === 'retired' ? 'Retired without recorded approval' : 'Not in use until approved by a verified school nurse'}</span>
                    <div className="risk-rule-actions">
                      {canCopy && <button type="button" className="secondary-btn" onClick={() => copyRiskRuleToDraft(rule)} disabled={busy}>Use as starting point</button>}
                      {user?.role === 'school_nurse' && isDraft && <button type="button" className="primary-btn" onClick={() => approveRiskRule(rule)} disabled={!currentUserLicenseVerified || busy}>{riskActionBusy === `approve:${rule.id}` ? 'Approving…' : `Approve and use version ${rule.version}`}</button>}
                    </div>
                    {user?.role === 'system_administrator' && isDraft && <span className="risk-approval-note">Only a verified school nurse can approve these rules.</span>}
                  </div>
                  {riskMessage?.position === rule.id && <p className={`risk-feedback ${riskMessage.tone === 'error' ? 'is-error' : 'is-success'}`} role={riskMessage.tone === 'error' ? 'alert' : 'status'}>{riskMessage.text}</p>}
                </article>;
              })}
            </div>
            {user?.role === 'school_nurse' && !currentUserLicenseVerified && <p className="risk-license-note">Custom rules can be saved now. To approve and use them, ask an administrator to verify and record your PRC license. Nurses cannot record their own verification.</p>}
          </details>
        </section>
      )}

      {activeSection === 'security' && isAdmin && (
        <section className="panel settings-tab-panel audit-history-panel">
          <div className="settings-panel-heading">
            <div>
              <h3>Audit history</h3>
              <p className="field-hint">Recent account access and administrative activity recorded by the server.</p>
            </div>
            <button type="button" className="secondary-btn" onClick={() => setAuditRetry((count) => count + 1)} disabled={auditLoading}>
              <RotateCcw size={15} aria-hidden="true" /> {auditLoading ? 'Refreshing…' : 'Refresh history'}
            </button>
          </div>
          <p className="disabled-note audit-history-note"><ShieldCheck size={14} aria-hidden="true" /> Event details are filtered before display. Manage active sessions under My Account; server security settings are controlled by deployment configuration.</p>
          <div className="audit-filter-toolbar">
            <label>Event<select value={auditQuery.event} onChange={(event) => updateAuditFilter({ event: event.target.value })}><option value="">All events</option>{Object.keys(auditEventMeta).sort().map((event) => <option value={event} key={event}>{auditEventMeta[event].label}</option>)}</select></label>
            <label>Actor<select value={auditQuery.actorId} onChange={(event) => updateAuditFilter({ actorId: event.target.value })}><option value="">All actors</option><option value="system">System</option>{users.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}</select></label>
            <label>From<input type="date" value={auditQuery.start} max={auditQuery.end || undefined} onChange={(event) => updateAuditFilter({ auditStart: event.target.value })} /></label>
            <label>To<input type="date" value={auditQuery.end} min={auditQuery.start || undefined} onChange={(event) => updateAuditFilter({ auditEnd: event.target.value })} /></label>
            <label>Order<select value={auditQuery.order} onChange={(event) => updateAuditFilter({ auditOrder: event.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            <label>Page size<select value={auditQuery.limit} onChange={(event) => updateAuditFilter({ auditLimit: event.target.value })}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label>
          </div>
          {auditLoading && <p className="field-hint" role="status">Loading audit history…</p>}
          {auditError && <div className="error-banner" role="alert">{auditError} <button type="button" className="secondary-btn" onClick={() => setAuditRetry((count) => count + 1)}>Retry</button></div>}
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
            <div className="list-pagination audit-pagination"><p>Showing {auditLogs.length} events in this page.</p><div className="list-pagination-actions"><button type="button" className="secondary-btn" disabled={!auditPage.hasPrevious || auditLoading} onClick={() => updateAuditFilter({ cursor: auditPage.previousCursor })}>Previous</button><button type="button" className="secondary-btn" disabled={!auditPage.hasNext || auditLoading} onClick={() => updateAuditFilter({ cursor: auditPage.nextCursor })}>Next</button></div></div>
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

    </div>
  );
}
