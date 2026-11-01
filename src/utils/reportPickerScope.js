export function shouldLoadReportsPatientPicker(role, reportTab) {
  return role === 'school_nurse' && ['patient', 'consultation'].includes(reportTab);
}
