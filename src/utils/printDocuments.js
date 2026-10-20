import { manilaCalendarDate } from './dateTime.js';

export const complaintLabels = ['Headache', 'Stomachache', 'Toothache', 'Injury', 'Others'];
export function resolvePrintContext(data, user, studentId, visitId, passType) {
  if (user?.role !== 'school_nurse') return null;
  if (passType && !['clinic', 'gate'].includes(passType)) return null;
  const student = data.students?.find((item) => String(item.id) === String(studentId) && item.patientType === 'student');
  if (!student) return null;
  const visit = visitId ? data.visits?.find((item) => String(item.id) === String(visitId) && String(item.studentId || item.patientId) === String(student.id)) : null;
  if ((visitId || !passType) && !visit) return null;
  return { student, visit, settings: data.settings || {} };
}
export function summaryFields({ student, visit, settings }) {
  return {
    school: settings.schoolName || '', clinic: settings.clinicName || '',
    name: student.name || '', rosterId: student.studentId || '',
    date: visit.date || visit.createdAt || '', time: visit.time || '',
    complaint: visit.chiefComplaint || '', treatment: visit.treatment || '', disposition: visit.disposition || '',
    followUp: visit.followUp ? (visit.followUpDate || 'Recommended; date not recorded') : '',
    summary: visit.summaryApprovedBy ? visit.consultationSummary || '' : '',
    nurse: visit.nurseName || '',
  };
}
export function initialPass({ student, visit, settings }, now = new Date()) {
  return {
    school: settings.schoolName || '', schoolYear: settings.schoolYear || '',
    name: student.name || '', grade: [student.gradeLevel, student.section].filter(Boolean).join(' · '),
    teacher: student.adviser || '', date: visit?.date || manilaCalendarDate(now),
    nurse: settings.nurseName || '', complaints: [], other: visit?.chiefComplaint || '',
    notes: '', timeIn: '', timeOut: '', reason: '', departure: '', fetcher: '', relationship: '', timeLeft: '', timeArrived: '',
  };
}
