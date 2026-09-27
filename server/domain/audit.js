const safeAuditFields = {
  LOGIN_FAILED: ['identifier', 'attemptsRemaining'],
  MFA_SETTING_UPDATED: ['enabled'],
  PASSWORD_RESET_REQUESTED: ['accountFound'],
  USER_INVITED: ['role', 'email'],
  INVITATION_RESENT: ['email'],
  INVITATION_EMAIL_FAILED: ['email'],
  ACCOUNT_STATUS_CHANGED: ['status'],
  NURSE_PRC_LICENSE_VERIFICATION_UPDATED: ['verified', 'cleared'],
  ACCOUNT_APPROVED: ['approvedBy'],
  ACCOUNT_REJECTED: ['email'],
  NURSE_ACCOUNT_CREATED: ['email', 'role'],
  CLINIC_SETTINGS_UPDATED: ['fields'],
  CLINIC_DATA_UPDATED: ['version'],
  PATIENT_CONSENT_TRACKING_UPDATED: ['consentStatus'],
  RISK_ASSESSMENT_CALCULATED: ['category', 'status', 'ruleVersion'],
  CLINIC_VISIT_CREATED: ['category', 'ruleVersion', 'medicineDispensed'],
  RISK_RULE_CREATED: ['version', 'status'],
  RISK_RULE_APPROVED: ['version', 'approverRole'],
  QUEUE_ENTRY_CREATED: ['triagePriority', 'prioritySource', 'priority'],
  QUEUE_ENTRY_UPDATED: ['status'],
  STUDENTS_IMPORTED: ['imported'],
  HISTORICAL_VISITS_IMPORTED: ['imported'],
  APPOINTMENT_CREATED: [],
  APPOINTMENT_UPDATED: ['status'],
  REPORT_SNAPSHOT_CREATED: ['type', 'start', 'end'],
  NOTIFICATION_BROADCAST_STARTED: ['type', 'roles', 'recipientCount'],
  NOTIFICATION_BROADCAST_COMPLETED: ['type', 'roles', 'recipientCount', 'inAppCreated', 'emailsSent', 'emailFailures', 'duplicateEmailNoticesSkipped'],
};

export function redactAuditDetails(event, details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const fields = safeAuditFields[event] || [];
  return Object.fromEntries(fields
    .filter((field) => details[field] !== undefined)
    .map((field) => [field, details[field]]));
}

export function sanitizeAuditLogs(logs) {
  return logs.map((entry) => ({ ...entry, details: redactAuditDetails(entry.event, entry.details) }));
}
