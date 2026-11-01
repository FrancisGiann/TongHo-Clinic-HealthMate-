const textLimits = Object.freeze({
  studentId: 80,
  facultyId: 80,
  name: 160,
  gradeLevel: 40,
  section: 80,
  adviser: 160,
  department: 120,
  position: 120,
  email: 254,
  contactNumber: 40,
  birthDate: 10,
  gender: 30,
  guardianName: 160,
  guardianPhone: 40,
  allergies: 2000,
  conditions: 2000,
});

function validBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validatePatientProfilePayload(pathPatientId, input) {
  const fields = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, message: 'A patient record is required.', fields: { patient: 'Enter a patient record.' } };
  }
  if (Object.hasOwn(input, 'id') && (typeof input.id !== 'string' || input.id !== pathPatientId)) {
    fields.id = 'The patient ID must match the selected profile.';
  }
  const value = {};
  const editable = [
    'studentId', 'facultyId', 'name', 'gradeLevel', 'section', 'adviser', 'department', 'position',
    'email', 'contactNumber', 'birthDate', 'gender', 'guardianName', 'guardianPhone',
    'allergies', 'conditions', 'profileImage',
  ];
  for (const key of editable) {
    if (!Object.hasOwn(input, key)) continue;
    const raw = input[key];
    if (key === 'profileImage' && raw === null) {
      value[key] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      fields[key] = 'Enter text for this field.';
      continue;
    }
    const limit = textLimits[key] || (key === 'profileImage' ? 3_000_000 : 400);
    if (raw.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
      fields[key] = `Use no more than ${limit} characters.`;
      continue;
    }
    value[key] = raw;
  }
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) fields.email = 'Enter a valid email address.';
  if (value.birthDate && !validBirthDate(value.birthDate)) fields.birthDate = 'Enter a real date in YYYY-MM-DD format.';
  if (value.guardianPhone && !/^[\d\s+().-]{7,40}$/.test(value.guardianPhone)) fields.guardianPhone = 'Enter a valid contact number.';
  if (Object.keys(fields).length) return { valid: false, message: 'Review the patient profile fields.', fields };
  return { valid: true, value };
}
