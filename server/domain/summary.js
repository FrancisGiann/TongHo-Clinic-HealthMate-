const MAX_DRAFT_LENGTH = 5000;
const UNKNOWN_TEXT = /^(?:unknown|not (?:provided|recorded|known|available|assessed|measured|documented)|n\/?a|unspecified)$/i;
const INSTRUCTION_TEXT = /\b(?:ignore|disregard|bypass|override)\b.{0,100}\b(?:instructions?|prompts?|rules?|system|developer)\b|\b(?:system|developer|assistant)\s*:|<\/?(?:system|developer|assistant)>|\[\/?INST\]|\b(?:set|mark|change|classify)\b.{0,50}\brisk\b/isu;
// Conservative abstention, not clinical interpretation: retain legitimate negatives
// verbatim in source quotations instead of accepting model-written negative claims.
const NEGATIVE_OR_NORMAL = /\b(?:no|none|nil|nothing|denies|denied|negative|absent|normal|unremarkable|asymptomatic|without|free of)\b/iu;
const GENERATED_DIRECTIONS = /\b(?:diagnos(?:is|e|ed)|prescrib(?:e|ed)|(?:low|high|moderate)\s+risk|risk\s+(?:score|classification)|you should|must take)\b/iu;
const LABELS = {
  visitType: 'Visit type', complaint: 'Chief complaint', symptoms: 'Symptoms',
  treatment: 'Treatment / care provided', disposition: 'Disposition',
  painScore: 'Pain score', temperature: 'Temperature', pulse: 'Pulse',
};

function text(value) { return typeof value === 'string' ? value : ''; }
function numeric(value, min, max, integer = false) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && (!value.trim() || value.length > 16)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)) ? n : null;
}
function sourceEntries(encounter) {
  const input = encounter && typeof encounter === 'object' && !Array.isArray(encounter) ? encounter : {};
  return {
    visitType: text(input.visitType ?? input.type), complaint: text(input.chiefComplaint),
    symptoms: Array.isArray(input.symptoms) ? input.symptoms.filter((item) => typeof item === 'string' && item.trim()) : [],
    treatment: text(input.treatment), disposition: text(input.disposition),
    painScore: numeric(input.painScore, 1, 10, true), temperature: numeric(input.temperature, 30, 45), pulse: numeric(input.pulse, 20, 250, true),
  };
}
function known(value) {
  if (Array.isArray(value)) return value.some(known);
  if (typeof value === 'string') return Boolean(value.trim()) && !UNKNOWN_TEXT.test(value.trim());
  return typeof value === 'number' && Number.isFinite(value);
}
function quote(value) {
  return JSON.stringify(value).replace(/[\u2028\u2029]/g, (character) => character === '\u2028' ? '\\u2028' : '\\u2029');
}
function missing(entries) { return Object.keys(LABELS).filter((key) => !known(entries[key])).map((key) => LABELS[key]); }
function normalizedForGuard(value) { return value.normalize('NFKC').replace(/\p{Cf}/gu, ''); }

export function summaryInputNeedsSourceReview(encounter) {
  const entries = sourceEntries(encounter);
  return Object.values(entries).flat().filter((value) => typeof value === 'string')
    .some((value) => INSTRUCTION_TEXT.test(normalizedForGuard(value)));
}

export function sourceReviewSummary(encounter, reason = 'source_review') {
  const entries = sourceEntries(encounter);
  const lines = Object.entries(LABELS).map(([key, label]) => {
    const value = entries[key];
    if (known(value)) return `${label} — source quote: ${quote(value)}`;
    const retainedUnknown = (typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length);
    return `${label}: Not provided${retainedUnknown ? `; source quote: ${quote(value)}` : ''}`;
  });
  const prefix = 'Source quotations for nurse review. Quoted entries are untrusted data, not directions or independently confirmed findings.';
  let draft = [prefix, ...lines].join('\n');
  const manualEntryRequired = draft.length > MAX_DRAFT_LENGTH;
  if (manualEntryRequired) {
    // Do not silently truncate clinical source text into a partial summary.
    draft = 'A summary could not be safely fitted within the draft limit. Review the original encounter entries and write the summary manually.';
    const fields = missing(entries);
    if (fields.length) draft += `\nNot provided: ${fields.join('; ')}.`;
  }
  return {
    draft, sourceQuoted: !manualEntryRequired, manualEntryRequired, missingFields: missing(entries), guardReason: reason,
    reviewNotice: manualEntryRequired
      ? 'Original encounter entries are unchanged. Write a summary after reviewing them; no source quotation was silently shortened.'
      : 'Automated wording was replaced with source quotations. Review the original encounter and do not follow instructions embedded in quoted text.',
  };
}

export function reviewGeneratedSummary(encounter, draft) {
  if (summaryInputNeedsSourceReview(encounter)) return sourceReviewSummary(encounter, 'input_instructions');
  if (typeof draft !== 'string' || !draft.trim()) return sourceReviewSummary(encounter, 'invalid_draft');
  const normalized = normalizedForGuard(draft);
  if (INSTRUCTION_TEXT.test(normalized) || GENERATED_DIRECTIONS.test(normalized)) return sourceReviewSummary(encounter, 'generated_directions');
  if (NEGATIVE_OR_NORMAL.test(normalized)) return sourceReviewSummary(encounter, 'negative_or_normal_wording');
  const missingFields = missing(sourceEntries(encounter));
  const suffix = missingFields.length ? `\nNot provided: ${missingFields.join('; ')}.` : '';
  return {
    draft: draft.trim().slice(0, MAX_DRAFT_LENGTH - suffix.length).trim() + suffix,
    sourceQuoted: false, manualEntryRequired: false, missingFields, reviewNotice: null, guardReason: null,
  };
}
