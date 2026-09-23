const isoDate = (daysAgo = 0) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

/** Default seed data for the school health clinic */
const seed = {
  schemaVersion: 1,
  settings: { 
    schoolName: 'Tong Ho Academy', 
    clinicName: 'Health Center', 
    schoolYear: '2025–2026', 
    nurseName: 'Nurse Maya Santos', 
    address: '18 Mabini Avenue, Quezon City', 
    contactNumber: '+63 2 8123 4567' 
  },
  students: [
    { id: 101, studentId: 'THA-2026-0101', name: 'Ana Cruz', gradeLevel: 'Grade 4', section: 'Rizal', adviser: 'J. Mendoza', birthDate: '2017-05-14', gender: 'Female', guardianName: 'Maricel Cruz', guardianPhone: '+63 917 555 0101', guardianRelation: 'Mother', bloodType: 'O+', allergies: 'Peanuts', conditions: 'Mild asthma', medications: 'Salbutamol inhaler' },
    { id: 102, studentId: 'THA-2026-0102', name: 'Miguel Santos', gradeLevel: 'Grade 6', section: 'Bonifacio', adviser: 'R. Lim', birthDate: '2015-02-22', gender: 'Male', guardianName: 'Joel Santos', guardianPhone: '+63 917 555 0102', guardianRelation: 'Father', bloodType: 'A+', allergies: '', conditions: '', medications: '' },
    { id: 103, studentId: 'THA-2026-0103', name: 'Sofia Reyes', gradeLevel: 'Grade 2', section: 'Mabini', adviser: 'C. Flores', birthDate: '2019-09-08', gender: 'Female', guardianName: 'Liza Reyes', guardianPhone: '+63 917 555 0103', guardianRelation: 'Mother', bloodType: 'B+', allergies: 'Dust', conditions: 'Allergic rhinitis', medications: '' },
    { id: 104, studentId: 'THA-2026-0104', name: 'Liam Tan', gradeLevel: 'Grade 8', section: 'Luna', adviser: 'M. Garcia', birthDate: '2013-11-19', gender: 'Male', guardianName: 'Teresa Tan', guardianPhone: '+63 917 555 0104', guardianRelation: 'Mother', bloodType: 'O+', allergies: '', conditions: '', medications: '' },
    { id: 105, studentId: 'THA-2026-0105', name: 'Bea Navarro', gradeLevel: 'Grade 10', section: 'Del Pilar', adviser: 'A. Ramos', birthDate: '2011-04-03', gender: 'Female', guardianName: 'Ramon Navarro', guardianPhone: '+63 917 555 0105', guardianRelation: 'Father', bloodType: 'AB+', allergies: 'Ibuprofen', conditions: '', medications: '' },
  ],
  visits: [
    { id: 201, studentId: 101, date: isoDate(0), time: '08:15 AM', type: 'Illness', chiefComplaint: 'Headache', treatment: 'Rest and hydration', disposition: 'Returned to class', followUp: false, nurseName: 'Nurse Maya Santos' },
    { id: 202, studentId: 103, date: isoDate(0), time: '09:40 AM', type: 'Illness', chiefComplaint: 'Cough', treatment: 'Medication given', disposition: 'Returned to class', followUp: true, nurseName: 'Nurse Maya Santos' },
    { id: 203, studentId: 104, date: isoDate(1), time: '10:20 AM', type: 'Injury', chiefComplaint: 'Wound', treatment: 'Bandage', disposition: 'Returned to class', followUp: false, nurseName: 'Nurse Maya Santos' },
    { id: 204, studentId: 102, date: isoDate(3), time: '01:05 PM', type: 'Illness', chiefComplaint: 'Stomachache', treatment: 'Rest and hydration', disposition: 'Sent home', followUp: true, nurseName: 'Nurse Maya Santos' },
    { id: 205, studentId: 105, date: isoDate(5), time: '11:10 AM', type: 'Routine Check', chiefComplaint: 'Dizziness', treatment: 'Rest and hydration', disposition: 'Returned to class', followUp: false, nurseName: 'Nurse Maya Santos' },
  ],
  inventory: [
    { id: 301, name: 'Paracetamol 500mg', category: 'Analgesics', quantity: 8, unit: 'tablets', expiryDate: '2027-03-31', reorderLevel: 20 },
    { id: 302, name: 'Adhesive bandages', category: 'First Aid', quantity: 46, unit: 'pieces', expiryDate: '2028-01-31', reorderLevel: 25 },
    { id: 303, name: 'Salbutamol inhaler', category: 'Respiratory', quantity: 4, unit: 'inhalers', expiryDate: '2027-08-31', reorderLevel: 5 },
    { id: 304, name: 'Oral rehydration salts', category: 'Supplies', quantity: 18, unit: 'sachets', expiryDate: '2027-06-30', reorderLevel: 10 },
    { id: 305, name: 'Instant cold pack', category: 'First Aid', quantity: 12, unit: 'pieces', expiryDate: '2028-04-30', reorderLevel: 8 },
  ],
  screenings: [
    { id: 401, studentId: 101, schoolYear: '2025–2026', date: isoDate(12), vision: '20/20', hearing: 'Pass', bmi: 'Normal', nutritionalStatus: 'Normal' },
    { id: 402, studentId: 102, schoolYear: '2025–2026', date: isoDate(14), vision: '20/30', hearing: 'Pass', bmi: 'Normal', nutritionalStatus: 'Normal' },
    { id: 403, studentId: 104, schoolYear: '2025–2026', date: isoDate(18), vision: '20/20', hearing: 'Pass', bmi: 'Normal', nutritionalStatus: 'Normal' },
  ],
  immunizations: [
    { id: 501, studentId: 101, vaccineName: 'MMR', doseNumber: '2nd', dateAdministered: '2025-09-10', nextDueDate: '', remarks: 'Up to date' },
    { id: 502, studentId: 102, vaccineName: 'Td', doseNumber: '1st', dateAdministered: '2025-09-12', nextDueDate: isoDate(-30), remarks: 'Schedule booster' },
    { id: 503, studentId: 103, vaccineName: 'MMR', doseNumber: '1st', dateAdministered: '2025-09-08', nextDueDate: '2026-10-08', remarks: 'Follow-up due' },
  ],
  incidents: [
    { id: 601, studentId: 104, date: isoDate(1), location: 'Covered court', type: 'Sports injury', severity: 'Moderate', description: 'Minor knee injury during PE.', actionTaken: 'Cold pack applied; guardian notified.', parentNotified: true },
  ],
  appointments: [
    { id: 701, studentId: 103, date: isoDate(-2), time: '02:30 PM', reason: 'Asthma follow-up', status: 'Scheduled' },
    { id: 702, studentId: 102, date: isoDate(-5), time: '10:00 AM', reason: 'Parent notification', status: 'Pending' },
  ],
  queue: []
};

const collectionKeys = [
  'students',
  'visits',
  'inventory',
  'screenings',
  'immunizations',
  'incidents',
  'appointments',
  'queue',
  'dispenseLogs',
  'stockAdjustments',
];

let localRecordSequence = 0;
function nextRecordId(records = []) {
  const existing = new Set(records.map((record) => String(record.id)));
  let candidate;
  do {
    if (typeof globalThis.crypto?.randomUUID === 'function') candidate = globalThis.crypto.randomUUID();
    else {
      localRecordSequence += 1;
      candidate = `${Date.now()}-${localRecordSequence}-${Math.random().toString(36).slice(2, 10)}`;
    }
  } while (existing.has(String(candidate)));
  return candidate;
}

const createInitialData = () => ({
  ...seed,
  settings: { ...seed.settings },
  ...Object.fromEntries(collectionKeys.map((key) => [key, [...(seed[key] || [])]])),
});

function normalizeData(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {
    schemaVersion: 1,
    ...source,
    settings: { ...(source.settings || {}) },
  };

  collectionKeys.forEach((key) => {
    normalized[key] = Array.isArray(source[key]) ? source[key] : [];
  });

  return normalized;
}

/**
 * Load application data from localStorage, with fallback to seed data.
 * Merges saved data with seed to ensure all required fields exist.
 * @returns {Object} Complete application data object
 */
export function loadData() {
  return createInitialData();
}

/**
 * Save application data to localStorage.
 * @param {Object} data - The complete application data object
 * @returns {Object} The saved data object
 * @throws {Error} If localStorage is unavailable or quota exceeded
 */
export function saveData(data) { 
  return normalizeData(data);
}

/**
 * Reset all data to initial seed state and clear localStorage.
 * @returns {Object} The seed data object
 */
export function resetData() { 
  return createInitialData();
}

/**
 * Add a new record to a data table.
 * @param {Object} data - The current application data
 * @param {string} table - The table name to add record to
 * @param {Object} record - The record data to add
 * @returns {Object} Updated application data with new record
 */
export function addRecord(data, table, record) {
  const next = {
    ...data,
    [table]: [...(data[table] || []), { ...record, id: nextRecordId(data[table] || []) }]
  };
  return saveData(next);
}
