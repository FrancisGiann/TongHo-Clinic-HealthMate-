import { isStudentGradeLevel } from '../../shared/grades.js';

const stringValue = (value) => String(value ?? '').trim();

export function canRollbackImport(role, type) {
  if (type === 'students') return role === 'system_administrator';
  if (type === 'faculty') return role === 'system_administrator' || role === 'school_nurse';
  if (type === 'visits') return role === 'school_nurse';
  return false;
}

function bounded(value, maxLength, field, errors) {
  const text = stringValue(value);
  if (text.length > maxLength) errors.push(`${field} must be ${maxLength} characters or fewer.`);
  return text.slice(0, maxLength);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeRosterRow(type, row) {
  const errors = [];
  const name = bounded(row?.name, 160, 'Name', errors);
  const record = type === 'faculty'
    ? {
        patientType: 'faculty',
        facultyId: bounded(row?.facultyId || row?.staffId || row?.studentId, 80, 'Faculty ID', errors),
        name,
        department: bounded(row?.department, 120, 'Department', errors),
        position: bounded(row?.position || row?.title, 120, 'Position', errors),
        email: bounded(row?.email, 254, 'Email', errors).toLowerCase(),
        contactNumber: bounded(row?.contactNumber || row?.phone, 40, 'Contact number', errors),
        birthDate: bounded(row?.birthDate, 10, 'Birth date', errors),
        gender: bounded(row?.gender, 30, 'Gender', errors),
        bloodType: bounded(row?.bloodType, 10, 'Blood type', errors),
        allergies: bounded(row?.allergies, 2000, 'Allergies', errors),
        conditions: bounded(row?.conditions, 2000, 'Medical conditions', errors),
        medications: bounded(row?.medications, 2000, 'Medications', errors),
      }
      : {
        patientType: 'student',
        studentId: bounded(row?.studentId, 80, 'Student ID', errors),
        name,
        gradeLevel: bounded(row?.gradeLevel, 40, 'Grade level', errors),
        section: bounded(row?.section, 80, 'Section', errors),
        adviser: bounded(row?.adviser, 160, 'Adviser', errors),
      };

  const identifier = type === 'faculty' ? record.facultyId : record.studentId;
  if (!identifier) errors.push(`${type === 'faculty' ? 'Faculty ID' : 'Student ID'} is required.`);
  if (!name) errors.push('Name is required.');
  if (type === 'students' && !record.gradeLevel) errors.push('Grade level is required.');
  if (type === 'students' && record.gradeLevel && !isStudentGradeLevel(record.gradeLevel)) errors.push('Grade level must be Kindergarten or Grade 1 through Grade 10.');
  if (record.birthDate && !validDate(record.birthDate)) errors.push('Birth date must be a real date in YYYY-MM-DD format.');
  if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) errors.push('Email must be a valid email address.');
  if (type === 'faculty') record.studentId = record.facultyId;
  return { record, errors, identifier };
}

function normalizeVisitRow(row) {
  const errors = [];
  const patientId = bounded(row?.patientId || row?.studentId, 120, 'Patient ID', errors);
  const date = bounded(row?.date, 10, 'Date', errors);
  const chiefComplaint = bounded(row?.chiefComplaint || row?.complaint, 300, 'Chief complaint', errors);
  const treatment = bounded(row?.treatment, 300, 'Treatment', errors);
  const record = {
    patientId,
    date,
    type: bounded(row?.type || 'Illness', 40, 'Visit type', errors),
    chiefComplaint,
    treatment,
    disposition: bounded(row?.disposition, 120, 'Disposition', errors),
    notes: bounded(row?.notes, 2000, 'Notes', errors),
  };
  if (!patientId) errors.push('Patient ID is required.');
  if (!validDate(date)) errors.push('Date must be a real date in YYYY-MM-DD format.');
  if (!chiefComplaint) errors.push('Chief complaint is required.');
  if (!treatment) errors.push('Treatment is required.');
  return { record, errors };
}

export function normalizeImportRows(type, rows) {
  if (!['students', 'faculty', 'visits'].includes(type)) {
    return { validType: false, message: 'Choose a supported import type.' };
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) {
    return { validType: true, invalidBatch: true, message: 'Import between 1 and 1,000 rows.' };
  }

  const seen = new Set();
  const normalizedRows = rows.map((row, index) => {
    const normalized = type === 'visits' ? normalizeVisitRow(row) : normalizeRosterRow(type, row);
    const key = type === 'visits'
      ? `${normalized.record.patientId.toLowerCase()}|${normalized.record.date}|${normalized.record.chiefComplaint.toLowerCase()}`
      : normalized.identifier.toLowerCase();
    let duplicateInFile = false;
    if (key.replaceAll('|', '')) {
      duplicateInFile = seen.has(key);
      seen.add(key);
    }
    return {
      index,
      record: normalized.record,
      errors: normalized.errors,
      duplicateInFile,
      duplicate: duplicateInFile,
      duplicateReason: duplicateInFile ? 'This row repeats an earlier row in the file.' : null,
      status: normalized.errors.length ? 'invalid' : duplicateInFile ? 'duplicate' : 'ready',
      defaultAction: normalized.errors.length || duplicateInFile ? 'skip' : 'import',
    };
  });
  return { validType: true, normalizedRows };
}

export function selectedImportRows(preview, selectedIndices) {
  if (!Array.isArray(selectedIndices) || selectedIndices.length < 1) {
    return { valid: false, message: 'Select at least one valid row to import.' };
  }
  const indexes = new Set();
  for (const value of selectedIndices) {
    if (!Number.isInteger(value) || value < 0 || value >= preview.length || indexes.has(value)) {
      return { valid: false, message: 'The selected import rows are invalid.' };
    }
    indexes.add(value);
  }
  const selected = preview.filter((row) => indexes.has(row.index));
  const invalid = selected.filter((row) => row.errors.length || row.duplicate);
  if (invalid.length) {
    return {
      valid: false,
      code: invalid.some((row) => row.duplicate) ? 'DUPLICATE_RECORD' : 'IMPORT_ROWS_INVALID',
      message: 'One or more selected rows are invalid or duplicated. Refresh the preview and choose valid rows.',
      rows: invalid.map(({ index, errors, duplicateReason }) => ({ index, errors, duplicateReason })),
    };
  }
  return { valid: true, selected };
}
