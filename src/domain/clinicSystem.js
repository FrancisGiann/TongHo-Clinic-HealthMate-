export const clinicModules = [
  { key: 'students', label: 'Student records', route: '/students' },
  { key: 'visits', label: 'Clinic visits', route: '/new-visit' },
  { key: 'screenings', label: 'Health screenings', route: '/health-screening' },
  { key: 'immunizations', label: 'Immunizations', route: '/immunizations' },
  { key: 'incidents', label: 'Incident reports', route: '/incident-reports' },
  { key: 'appointments', label: 'Appointments and queue', route: '/queue' },
  { key: 'inventory', label: 'Clinic inventory', route: '/inventory' },
  { key: 'reports', label: 'Reports and analytics', route: '/reports' },
];

export const clinicRoles = {
  nurse: {
    label: 'School nurse',
    permissions: ['read:clinic', 'write:care', 'write:inventory', 'read:reports'],
  },
  administrator: {
    label: 'Clinic administrator',
    permissions: ['read:clinic', 'write:clinic', 'write:users', 'read:reports'],
  },
};

export const dataCollections = [
  'students',
  'visits',
  'screenings',
  'immunizations',
  'incidents',
  'appointments',
  'inventory',
];
