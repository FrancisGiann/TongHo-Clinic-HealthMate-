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

const allowedFields = new Set(['painScore', 'clinicianRedFlag', 'recentVisitCount', 'temperature', 'pulse']);
const allowedOperators = new Set(['equals', 'gte', 'lte']);

export function validateRiskRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return { valid: false, message: 'Rules must be an object.' };
  const thresholds = rules.thresholds;
  if (!thresholds || !Number.isFinite(Number(thresholds.moderate)) || !Number.isFinite(Number(thresholds.high))
    || Number(thresholds.moderate) < 1 || Number(thresholds.high) <= Number(thresholds.moderate) || Number(thresholds.high) > 100) {
    return { valid: false, message: 'Provide ordered thresholds from 1 to 100.' };
  }
  if (!Array.isArray(rules.requiredFields) || rules.requiredFields.some((field) => !allowedFields.has(field))) {
    return { valid: false, message: 'Required fields contain an unsupported clinical indicator.' };
  }
  if (!Array.isArray(rules.indicators) || rules.indicators.length < 1 || rules.indicators.length > 30) {
    return { valid: false, message: 'Provide between 1 and 30 indicators.' };
  }
  for (const indicator of rules.indicators) {
    if (!indicator || !allowedFields.has(indicator.field) || !allowedOperators.has(indicator.operator)
      || !Number.isInteger(Number(indicator.weight)) || Number(indicator.weight) < 1 || Number(indicator.weight) > 20
      || typeof indicator.label !== 'string' || !indicator.label.trim() || indicator.label.trim().length > 120) {
      return { valid: false, message: 'Each indicator needs a supported field, operator, 1–20 weight, and short label.' };
    }
    if (indicator.field === 'clinicianRedFlag') {
      if (indicator.operator !== 'equals' || typeof indicator.value !== 'boolean') return { valid: false, message: 'Clinician warning indicators must compare a boolean value.' };
    } else if (!['gte', 'lte'].includes(indicator.operator) || !Number.isFinite(Number(indicator.value))) {
      return { valid: false, message: 'Numeric indicators must use a numeric threshold.' };
    }
  }
  return { valid: true };
}

export async function approveDraftRiskRule(client, ruleId, approverId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('risk-rule-approval'))");
  const result = await client.query('SELECT id,version,status,rules FROM risk_rules WHERE id=$1 FOR UPDATE', [ruleId]);
  if (!result.rowCount) {
    const error = new Error('Risk rule version not found.');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  const rule = result.rows[0];
  if (rule.status !== 'draft') {
    const error = new Error('Only draft rules can be approved.');
    error.status = 409;
    error.code = 'RULE_NOT_DRAFT';
    throw error;
  }
  if (!validateRiskRules(rule.rules).valid) {
    const error = new Error('This risk rule version is no longer valid for approval.');
    error.status = 409;
    error.code = 'RULE_INVALID';
    throw error;
  }
  await client.query("UPDATE risk_rules SET status='retired' WHERE status='clinician_approved'");
  const approved = await client.query(
    "UPDATE risk_rules SET status='clinician_approved',approved_by=$1,approved_at=NOW() WHERE id=$2 AND status='draft' RETURNING id,version,status",
    [approverId, ruleId],
  );
  if (!approved.rowCount) {
    const error = new Error('Only draft rules can be approved.');
    error.status = 409;
    error.code = 'RULE_NOT_DRAFT';
    throw error;
  }
  return approved.rows[0];
}

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
