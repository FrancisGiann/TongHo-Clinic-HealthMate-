const spreadsheetFormulaPrefix = /^[=+\-@\t\r]/;

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(value.trim());
      value = '';
    } else if (character === '\n') {
      row.push(value.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else if (character !== '\r') {
      value += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (value !== '' || row.length) {
    row.push(value.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

export function validateStudentImport(rows, existingStudents = []) {
  if (!Array.isArray(rows) || rows.length < 2) return { valid: false, errors: ['Add a header row and at least one student.'] };
  const headers = rows[0].map((header) => String(header).trim().toLowerCase());
  const studentIdIndex = headers.findIndex((header) => ['student id', 'studentid', 'id'].includes(header));
  const nameIndex = headers.findIndex((header) => ['name', 'full name', 'fullname'].includes(header));
  if (studentIdIndex < 0 || nameIndex < 0) return { valid: false, errors: ['The CSV must include Student ID and Name columns.'] };
  const existing = new Set(existingStudents.map((student) => String(student.studentId || '').trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const errors = [];
  const records = [];
  rows.slice(1).forEach((cells, index) => {
    const studentId = String(cells[studentIdIndex] || '').trim();
    const name = String(cells[nameIndex] || '').trim();
    const key = studentId.toLowerCase();
    if (!studentId || !name) errors.push(`Row ${index + 2}: Student ID and Name are required.`);
    else if (seen.has(key) || existing.has(key)) errors.push(`Row ${index + 2}: duplicate Student ID ${studentId}.`);
    else {
      seen.add(key);
      records.push({ studentId, name, gradeLevel: String(cells[headers.findIndex((header) => ['grade', 'gradelevel', 'grade level'].includes(header))] || '').trim(), section: String(cells[headers.indexOf('section')] || '').trim(), guardianName: String(cells[headers.findIndex((header) => ['guardian', 'guardianname', 'guardian name'].includes(header))] || '').trim(), guardianPhone: String(cells[headers.findIndex((header) => ['phone', 'guardianphone', 'guardian phone'].includes(header))] || '').trim() });
    }
  });
  return { valid: errors.length === 0, errors, records };
}

const importHeaderAliases = {
  studentid: 'studentId', id: 'studentId',
  facultyid: 'facultyId', staffid: 'facultyId',
  name: 'name', fullname: 'name', patientname: 'name',
  grade: 'gradeLevel', gradelevel: 'gradeLevel',
  section: 'section', adviser: 'adviser', birthdate: 'birthDate', gender: 'gender',
  guardian: 'guardianName', guardianname: 'guardianName', guardianphone: 'guardianPhone', phone: 'guardianPhone',
  guardianrelation: 'guardianRelation', relationship: 'guardianRelation',
  department: 'department', position: 'position', title: 'position', email: 'email', contact: 'contactNumber', contactnumber: 'contactNumber',
  patientid: 'patientId', visitdate: 'date', date: 'date', type: 'type', complaint: 'chiefComplaint', chiefcomplaint: 'chiefComplaint',
  treatment: 'treatment', disposition: 'disposition', notes: 'notes',
};

export function importCsvRecords(csvRows, type) {
  if (!['students', 'faculty', 'visits'].includes(type)) throw new Error('Choose a supported import type.');
  if (!Array.isArray(csvRows) || csvRows.length < 2) throw new Error('Add a header row and at least one record.');
  const headers = csvRows[0].map((value) => importHeaderAliases[String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '')] || null);
  const required = type === 'students' ? ['studentId', 'name'] : type === 'faculty' ? ['facultyId', 'name'] : ['patientId', 'date', 'chiefComplaint', 'treatment'];
  if (required.some((key) => !headers.includes(key))) {
    const labels = { studentId: 'Student ID', facultyId: 'Faculty ID', name: 'Name', patientId: 'Patient ID', date: 'Date', chiefComplaint: 'Complaint', treatment: 'Treatment' };
    throw new Error(`The CSV must include ${required.map((key) => labels[key]).join(', ')} columns.`);
  }
  return csvRows.slice(1).map((cells) => Object.fromEntries(headers
    .map((key, index) => [key, String(cells?.[index] || '').trim()])
    .filter(([key]) => key)));
}

const serializeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const escapeCsvCell = (value) => {
  const serialized = serializeValue(value);
  const safeValue = spreadsheetFormulaPrefix.test(serialized)
    ? `'${serialized}`
    : serialized;
  return `"${safeValue.replaceAll('"', '""')}"`;
};

export function downloadCsv(filename, rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = [...new Set(safeRows.flatMap((row) => Object.keys(row || {})))];
  const csv = [
    headers.map(escapeCsvCell).join(","),
    ...safeRows.map((row) => headers.map((header) => escapeCsvCell(row?.[header])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
