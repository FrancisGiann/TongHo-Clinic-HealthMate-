const MAX_STUDENT_MATCHES = 50;

export function findStudentMatches(students, query, limit = MAX_STUDENT_MATCHES) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  const searchableStudents = Array.isArray(students) ? students : [];
  const matches = normalized
    ? searchableStudents.filter((student) => (
      `${student.name || ''} ${student.studentId || ''} ${student.facultyId || ''} ${student.id || ''} ${student.gradeLevel || ''} ${student.section || ''} ${student.department || ''} ${student.position || ''}`
        .toLocaleLowerCase()
        .includes(normalized)
    ))
    : searchableStudents;
  return matches.slice(0, limit);
}

export function nextStudentIndex(activeIndex, direction, matchCount) {
  if (!Number.isInteger(matchCount) || matchCount <= 0) return -1;
  if (direction > 0) return Math.min(matchCount - 1, activeIndex + 1);
  if (direction < 0) return Math.max(0, activeIndex - 1);
  return Math.min(matchCount - 1, Math.max(-1, activeIndex));
}
