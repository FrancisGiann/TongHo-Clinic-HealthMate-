const DEMONSTRATION_RULES = Object.freeze({
  version: 0,
  name: 'Demonstration rules — clinician approval required',
  status: 'draft',
  requiredFields: ['painScore'],
  thresholds: { moderate: 3, high: 7 },
  indicators: [
    { field: 'clinicianRedFlag', operator: 'equals', value: true, weight: 10, label: 'Clinician marked an urgent warning sign' },
    { field: 'painScore', operator: 'gte', value: 7, weight: 4, label: 'High reported pain' },
    { field: 'painScore', operator: 'gte', value: 4, weight: 2, label: 'Moderate reported pain' },
    { field: 'recentVisitCount', operator: 'gte', value: 3, weight: 2, label: 'Recurring clinic visits' },
  ],
});

function compare(actual, operator, expected) {
  if (operator === 'equals') return actual === expected;
  if (operator === 'gte') return Number.isFinite(Number(actual)) && Number(actual) >= Number(expected);
  if (operator === 'lte') return Number.isFinite(Number(actual)) && Number(actual) <= Number(expected);
  if (operator === 'includes') return Array.isArray(actual) && actual.includes(expected);
  return false;
}

export function assessRisk(input, configuredRules = DEMONSTRATION_RULES) {
  const rules = configuredRules || DEMONSTRATION_RULES;
  const missingFields = (rules.requiredFields || []).filter((field) => {
    const value = input?.[field];
    return value === undefined || value === null || value === '';
  });

  if (input?.painScore !== undefined && (!Number.isInteger(Number(input.painScore)) || Number(input.painScore) < 1 || Number(input.painScore) > 10)) {
    missingFields.push('validPainScore');
  }

  const components = [];
  let total = 0;
  for (const indicator of rules.indicators || []) {
    if (!compare(input?.[indicator.field], indicator.operator, indicator.value)) continue;
    total += Number(indicator.weight) || 0;
    components.push({
      field: indicator.field,
      label: indicator.label,
      weight: Number(indicator.weight) || 0,
    });
  }

  if (missingFields.length) {
    return {
      status: 'incomplete',
      total,
      category: 'unclassified',
      priority: 'requires-review',
      components,
      missingFields: [...new Set(missingFields)],
      rationale: 'Required clinical inputs are missing or invalid. A nurse must complete the assessment.',
      ruleVersion: rules.version,
      ruleStatus: rules.status,
      disclaimer: 'Decision support only. This result is not a diagnosis and does not replace clinical judgment.',
    };
  }

  const category = total >= rules.thresholds.high ? 'high' : total >= rules.thresholds.moderate ? 'moderate' : 'low';
  return {
    status: 'complete',
    total,
    category,
    priority: category === 'high' ? 'urgent' : category === 'moderate' ? 'priority' : 'routine',
    components,
    missingFields: [],
    rationale: components.length ? components.map((item) => item.label).join('; ') : 'No configured indicators matched.',
    ruleVersion: rules.version,
    ruleStatus: rules.status,
    disclaimer: 'Decision support only. This result is not a diagnosis and does not replace clinical judgment.',
  };
}

export function getDemonstrationRules() {
  return JSON.parse(JSON.stringify(DEMONSTRATION_RULES));
}
