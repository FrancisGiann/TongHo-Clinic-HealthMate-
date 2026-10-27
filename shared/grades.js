export const STUDENT_GRADE_LEVELS = Object.freeze([
  'Kindergarten',
  ...Array.from({ length: 10 }, (_, index) => `Grade ${index + 1}`),
]);

export function isStudentGradeLevel(value) {
  return STUDENT_GRADE_LEVELS.includes(value);
}
