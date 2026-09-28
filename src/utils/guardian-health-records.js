const stableSerialize = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function hasAlreadySubmittedForSchoolYear(submissions, schoolYear, payload) {
  return Boolean(schoolYear && submissions?.some((submission) => (
    submission.school_year === schoolYear
    && submission.source === 'guardian'
    && ['pending_review', 'accepted'].includes(submission.status)
    && stableSerialize(submission.payload) === stableSerialize(payload)
  )));
}

export function isHealthRecordRenewalDue(submissions, schoolYear) {
  const latest = submissions?.[0];
  return Boolean(schoolYear && latest && latest.school_year !== schoolYear
    && !submissions.some((submission) => submission.school_year === schoolYear));
}
