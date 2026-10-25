import { resolvePrintContext } from './printDocuments.js';

export function consultationSelection(data, user, search) {
  if (user?.role !== 'school_nurse') return { students: [], student: null, visits: [], selected: null };
  const students = (data.students || []).filter((record) => record.patientType === 'student');
  const studentId = search.get('patientId') || '';
  const student = students.find((record) => String(record.id) === studentId) || null;
  const visits = student ? (data.visits || []).filter((visit) => String(visit.studentId || visit.patientId) === studentId)
    .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''))) : [];
  return { students, student, visits, selected: resolvePrintContext(data, user, studentId, search.get('visitId') || '') };
}

export function changeConsultationStudent(search, id) {
  const next = new URLSearchParams(search);
  if (id) next.set('patientId', String(id)); else next.delete('patientId');
  next.delete('visitId');
  return next;
}

export function consultationReportReturn(studentId, visitId) {
  const search = new URLSearchParams({ tab: 'consultation' });
  if (studentId) search.set('patientId', String(studentId));
  if (visitId) search.set('visitId', String(visitId));
  return `/reports?${search}`;
}
