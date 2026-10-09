export const riskRuleFields = [
  { key: 'painScore', label: 'Pain score', kind: 'number' },
  { key: 'clinicianRedFlag', label: 'Clinician warning sign', kind: 'boolean' },
  { key: 'recentVisitCount', label: 'Recent clinic visits', kind: 'number' },
  { key: 'temperature', label: 'Temperature (°C)', kind: 'number' },
  { key: 'pulse', label: 'Pulse (bpm)', kind: 'number' },
];

const numericOperators = ['gte', 'lte', 'lt', 'gt'];

export function createEmptyRiskRuleForm() {
  return {
    name: '',
    requiredFields: ['painScore'],
    thresholds: { moderate: '', high: '' },
    indicators: [{ field: 'painScore', operator: 'gte', value: '', weight: '', label: '' }],
  };
}

function parseFiniteNumber(value, description) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${description} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${description} must be a valid number.`);
  return parsed;
}

export function serializeRiskRuleForm(form) {
  const name = String(form.name || '').trim();
  if (!name) throw new Error('Enter a name for this draft.');
  if (name.length > 120) throw new Error('Keep the draft name to 120 characters or fewer.');

  const moderate = parseFiniteNumber(form.thresholds?.moderate, 'The moderate score threshold');
  const high = parseFiniteNumber(form.thresholds?.high, 'The high score threshold');
  if (moderate < 1 || moderate > 100 || high <= moderate || high > 100) {
    throw new Error('Use ordered score thresholds: moderate from 1 to 100, with high above moderate and no higher than 100.');
  }

  if (!Array.isArray(form.requiredFields) || form.requiredFields.some((field) => !riskRuleFields.some((option) => option.key === field))
    || new Set(form.requiredFields).size !== form.requiredFields.length) {
    throw new Error('Choose valid required assessment fields.');
  }
  if (!Array.isArray(form.indicators) || form.indicators.length < 1 || form.indicators.length > 30) {
    throw new Error('Add between 1 and 30 matching conditions.');
  }

  const indicators = form.indicators.map((indicator, index) => {
    const field = riskRuleFields.find((option) => option.key === indicator.field);
    const label = String(indicator.label || '').trim();
    if (!field || !label || label.length > 120) throw new Error(`Condition ${index + 1} needs a supported field and a short explanation.`);
    const weight = parseFiniteNumber(indicator.weight, `Condition ${index + 1} points`);
    if (!Number.isInteger(weight) || weight < 1 || weight > 20) throw new Error(`Condition ${index + 1} points must be a whole number from 1 to 20.`);
    if (field.kind === 'boolean') {
      if (indicator.operator !== 'equals' || typeof indicator.value !== 'boolean') {
        throw new Error(`Condition ${index + 1} must compare the warning-sign answer with yes or no.`);
      }
      return { field: field.key, operator: 'equals', value: indicator.value, weight, label };
    }
    if (!numericOperators.includes(indicator.operator)) throw new Error(`Condition ${index + 1} needs a numeric comparison.`);
    const value = parseFiniteNumber(indicator.value, `Condition ${index + 1} threshold`);
    return { field: field.key, operator: indicator.operator, value, weight, label };
  });

  return { name, rules: { requiredFields: [...form.requiredFields], thresholds: { moderate, high }, indicators } };
}

export function riskRuleFormFromRule(rule, { copyName = true } = {}) {
  const rules = rule?.rules || rule;
  if (!rules || rules.mode || !rules.thresholds || !Array.isArray(rules.indicators)) return null;
  return {
    name: copyName ? `${String(rule?.name || 'Risk rule').slice(0, 114)} copy` : String(rule?.name || ''),
    requiredFields: Array.isArray(rules.requiredFields) ? [...rules.requiredFields] : [],
    thresholds: {
      moderate: rules.thresholds.moderate === undefined ? '' : String(rules.thresholds.moderate),
      high: rules.thresholds.high === undefined ? '' : String(rules.thresholds.high),
    },
    indicators: rules.indicators.map((indicator) => ({
      field: indicator.field,
      operator: indicator.operator,
      value: typeof indicator.value === 'boolean' ? indicator.value : String(indicator.value ?? ''),
      weight: String(indicator.weight ?? ''),
      label: indicator.label || '',
    })),
  };
}

export function describeRiskCondition(indicator) {
  const field = riskRuleFields.find((option) => option.key === indicator.field)?.label || indicator.field;
  const operator = { equals: 'is', gte: 'is at least', lte: 'is at most', lt: 'is below', gt: 'is above' }[indicator.operator] || indicator.operator;
  const value = typeof indicator.value === 'boolean' ? (indicator.value ? 'Yes' : 'No') : indicator.value;
  return `${field} ${operator} ${value}`;
}

export function riskRuleStatusLabel(result) {
  if (result?.ruleStatus === 'clinician_approved') return 'Clinician approved';
  if (result?.ruleStatus === 'test_active') return 'Development test · not approved by a nurse';
  const isLegacySample = result?.ruleStatus === 'draft' && (result.ruleVersion === 0 || result.ruleVersion === '0');
  if (result?.ruleStatus === 'sample' || isLegacySample) return 'Sample rules · not approved by a nurse';
  if (result?.ruleStatus === 'draft') return 'Custom rules · waiting for nurse approval';
  if (result?.ruleStatus === 'retired') return 'Retired rules · no longer active';
  return 'Approval status unavailable';
}
