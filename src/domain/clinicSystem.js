export const clinicModules = [
  { key: 'students', label: 'Student records', route: '/students' },
  { key: 'visits', label: 'Clinic visits', route: '/new-visit' },
  { key: 'appointments', label: 'Appointments', route: '/appointments' },
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
  'appointments',
  'inventory',
];
