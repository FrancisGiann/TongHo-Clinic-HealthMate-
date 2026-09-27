export const DEV_ROLE_ACCOUNTS = Object.freeze([
  {
    key: 'system_administrator',
    id: 'd1e7bf55-35af-46d1-b0e5-125a91a9c201',
    username: 'dev.admin',
    email: 'admin@healthmate.test',
    password: 'DevAdmin-92!Mango-Slate',
    name: 'Fictional Development Administrator',
    role: 'system_administrator',
  },
  {
    key: 'school_nurse',
    id: 'd1e7bf55-35af-46d1-b0e5-125a91a9c202',
    username: 'dev.nurse',
    email: 'nurse@healthmate.test',
    password: 'DevNurse-47!Cedar-Cloud',
    name: 'Fictional Development Nurse',
    role: 'school_nurse',
  },
  {
    key: 'student',
    id: 'd1e7bf55-35af-46d1-b0e5-125a91a9c203',
    username: 'dev.student',
    email: 'student@healthmate.test',
    password: 'DevStudent-83!Maple-River',
    name: 'Fictional Development Student',
    role: 'student',
  },
  {
    key: 'guardian',
    id: 'd1e7bf55-35af-46d1-b0e5-125a91a9c204',
    username: 'dev.guardian',
    email: 'guardian@healthmate.test',
    password: 'DevGuardian-26!Birch-Stone',
    name: 'Fictional Development Guardian',
    role: 'guardian',
  },
]);

export const DEV_ROLE_PATIENT_ID = 'PTHI-DEV-ROLE-001';
export const DEV_ROLE_SEED_REGISTRY = 'dev_role_account_seed_registry';

export function assertDevRoleAccountSeedEnabled(env = process.env) {
  if (env.NODE_ENV !== 'development') {
    throw new Error('Development role accounts can only be seeded when NODE_ENV=development.');
  }
  if (env.SEED_DEV_ROLE_ACCOUNTS !== 'true') {
    throw new Error('Set SEED_DEV_ROLE_ACCOUNTS=true to explicitly enable development role account seeding.');
  }
}
