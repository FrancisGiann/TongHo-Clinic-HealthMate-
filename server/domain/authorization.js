export const clinicalWriteRoles = ['school_nurse'];
export const reportReadRoles = ['school_nurse', 'system_administrator'];
export const adminRoles = ['system_administrator'];

export function roleCanWriteClinicalRecords(role) {
  return clinicalWriteRoles.includes(role);
}

export function roleCanReadReports(role) {
  return reportReadRoles.includes(role);
}

export function roleIsAdministrator(role) {
  return adminRoles.includes(role);
}
