import crypto from 'node:crypto';

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

const CONSERVATIVE_TRIAGE_MODE = 'conservative_triage_v1';
const CONSERVATIVE_TRIAGE_DRAFT = Object.freeze({
  name: 'WHO IITT-informed partial screening (draft)',
  rules: Object.freeze({
    mode: CONSERVATIVE_TRIAGE_MODE,
    requiredFields: ['temperature', 'clinicianRedFlag'],
    requireReviewOnNoMatch: true,
    indicators: [
      { field: 'clinicianRedFlag', operator: 'equals', value: true, outcome: 'urgent', label: 'Clinician-observed urgent warning sign' },
      { field: 'temperature', operator: 'lt', value: 36, outcome: 'review', label: 'Temperature below 36 °C — nurse review / up-triage' },
      { field: 'temperature', operator: 'gt', value: 39, outcome: 'review', label: 'Temperature above 39 °C — nurse review / up-triage' },
    ],
  }),
  sources: [
    { label: 'WHO Interagency Integrated Triage Tool (IITT)', url: 'https://www.who.int/tools/triage' },
    { label: 'WHO IITT, age 12 and older', url: 'https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_adult.pdf' },
    { label: 'WHO IITT, under age 12', url: 'https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_pediatric.pdf' },
  ],
  limitations: [
    'This is a partial school-clinic screening prompt, not a complete IITT triage assessment or a validated prediction rule.',
    'It uses the same temperature signs for all students and does not apply a pulse cutoff; pulse interpretation depends on age and clinical context.',
    'A temperature within these bounds and no marked warning sign never means the student is safe: every result without an urgent sign requires nurse review.',
    'Pain severity is not scored because the available form does not define a clinically supported cutoff. Other danger signs, age-specific assessment, and disposition remain the nurse’s responsibility.',
  ],
});

const allowedFields = new Set(['painScore', 'clinicianRedFlag', 'recentVisitCount', 'temperature', 'pulse']);
const allowedOperators = new Set(['equals', 'gte', 'lte', 'lt', 'gt']);

function validateConservativeTriageRules(rules) {
  if (rules.requireReviewOnNoMatch !== true
    || !Array.isArray(rules.requiredFields)
    || rules.requiredFields.length !== 2
    || new Set(rules.requiredFields).size !== 2
    || !rules.requiredFields.includes('temperature')
    || !rules.requiredFields.includes('clinicianRedFlag')
    || !Array.isArray(rules.indicators)
    || rules.indicators.length !== 3) {
    return { valid: false, message: 'Conservative triage rules must require temperature and clinician review when no indicator matches.' };
  }

  const expected = [
    { field: 'clinicianRedFlag', operator: 'equals', value: true, outcome: 'urgent' },
    { field: 'temperature', operator: 'lt', value: 36, outcome: 'review' },
    { field: 'temperature', operator: 'gt', value: 39, outcome: 'review' },
  ];
  const sameConditions = (condition) => rules.indicators.some((indicator) => indicator
    && indicator.field === condition.field
    && indicator.operator === condition.operator
    && indicator.value === condition.value
    && indicator.outcome === condition.outcome
    && typeof indicator.label === 'string'
    && Boolean(indicator.label.trim())
    && indicator.label.trim().length <= 120);
  if (!expected.every(sameConditions)) {
    return { valid: false, message: 'Conservative triage indicators must retain the clinician warning sign and WHO temperature boundaries.' };
  }
  return { valid: true };
}

export function validateRiskRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return { valid: false, message: 'Rules must be an object.' };
  if (rules.mode === CONSERVATIVE_TRIAGE_MODE) return validateConservativeTriageRules(rules);
  if (rules.mode !== undefined) return { valid: false, message: 'The risk-rule mode is not supported.' };
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
    } else if (!['gte', 'lte', 'lt', 'gt'].includes(indicator.operator) || !Number.isFinite(Number(indicator.value))) {
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
  if (operator === 'lt') return Number.isFinite(Number(actual)) && Number(actual) < Number(expected);
  if (operator === 'gt') return Number.isFinite(Number(actual)) && Number(actual) > Number(expected);
  if (operator === 'includes') return Array.isArray(actual) && actual.includes(expected);
  return false;
}

const decisionDisclaimer = 'Decision support only. This result is not a diagnosis and does not replace clinical judgment.';

function missingConservativeTriageFields(input) {
  const missing = [];
  const rawTemperature = input?.temperature;
  if (rawTemperature === undefined || rawTemperature === null || rawTemperature === '') {
    missing.push('temperature');
  } else {
    const temperature = Number(rawTemperature);
    if (!Number.isFinite(temperature) || temperature < 30 || temperature > 45) missing.push('validTemperature');
  }
  if (input?.clinicianRedFlag === undefined || input?.clinicianRedFlag === null) missing.push('clinicianRedFlag');
  else if (typeof input.clinicianRedFlag !== 'boolean') missing.push('validClinicianRedFlag');
  return missing;
}

function assessConservativeTriage(input, rules) {
  const missingFields = missingConservativeTriageFields(input);
  const temperatureIsUsable = !missingFields.includes('temperature') && !missingFields.includes('validTemperature');
  const normalizedInput = { ...input, temperature: temperatureIsUsable ? Number(input.temperature) : Number.NaN };
  const components = (rules.indicators || []).filter((indicator) => compare(
    normalizedInput[indicator.field], indicator.operator, indicator.value,
  )).map(({ field, label, outcome }) => ({ field, label, outcome }));
  const hasUrgentFinding = components.some((component) => component.outcome === 'urgent');
  const requiresReview = missingFields.length > 0 || components.some((component) => component.outcome === 'review')
    || (!components.length && rules.requireReviewOnNoMatch);
  const status = missingFields.length ? 'incomplete' : !components.length && rules.requireReviewOnNoMatch ? 'review_required' : 'complete';
  const missingDescriptions = {
    temperature: 'temperature is missing',
    validTemperature: 'temperature must be a valid reading from 30 to 45 °C',
    clinicianRedFlag: 'the clinician warning-sign screen is unanswered',
    validClinicianRedFlag: 'the clinician warning-sign screen must record yes or no',
  };
  const rationale = [
    ...components.map((item) => item.label),
    ...(missingFields.length ? [`Assessment incomplete: ${missingFields.map((field) => missingDescriptions[field] || field).join('; ')}. A nurse must review this assessment.`] : []),
    ...(!components.length && !missingFields.length ? ['No configured warning sign matched. This remains unclassified and requires a nurse to complete the clinical assessment; no-match does not mean low risk.'] : []),
  ].join('; ');

  return {
    status,
    total: null,
    category: hasUrgentFinding ? 'high' : 'unclassified',
    priority: hasUrgentFinding ? 'urgent' : requiresReview ? 'requires-review' : 'routine',
    components,
    missingFields: [...new Set(missingFields)],
    rationale,
    ruleVersion: rules.version,
    ruleStatus: rules.status,
    decisionSupportMode: CONSERVATIVE_TRIAGE_MODE,
    disclaimer: decisionDisclaimer,
  };
}

export function riskNeedsNurseAcknowledgement(result) {
  return result?.category === 'high' || result?.priority === 'requires-review' || result?.status === 'incomplete';
}

export function riskAllowsAcknowledgedIncomplete(result) {
  return result?.decisionSupportMode === CONSERVATIVE_TRIAGE_MODE
    && Array.isArray(result.missingFields)
    && result.missingFields.length === 1
    && result.missingFields[0] === 'temperature';
}

export function assessRisk(input, configuredRules = DEMONSTRATION_RULES) {
  const rules = configuredRules || DEMONSTRATION_RULES;
  if (rules.mode === CONSERVATIVE_TRIAGE_MODE) return assessConservativeTriage(input, rules);
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
      disclaimer: decisionDisclaimer,
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
    disclaimer: decisionDisclaimer,
  };
}

export function getDemonstrationRules() {
  return JSON.parse(JSON.stringify(DEMONSTRATION_RULES));
}

export function getConservativeCandidateRuleDraft() {
  return JSON.parse(JSON.stringify(CONSERVATIVE_TRIAGE_DRAFT));
}

function testActivationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function eligibleTestRule(rule) {
  return rule?.status === 'draft'
    && rule.rules?.mode === CONSERVATIVE_TRIAGE_MODE
    && validateRiskRules(rule.rules).valid;
}

function validRuleId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export async function selectRiskRules(client, environment = process.env.NODE_ENV) {
  if (environment === 'development') {
    const settings = await client.query('SELECT data FROM clinic_settings WHERE id=1');
    const ruleId = settings.rows[0]?.data?.testRiskRuleActivation?.ruleId;
    if (validRuleId(ruleId)) {
      const result = await client.query('SELECT id,version,name,status,rules FROM risk_rules WHERE id=$1', [ruleId]);
      const rule = result.rows[0];
      if (eligibleTestRule(rule)) {
        return { ...rule.rules, version: rule.version, name: rule.name, status: 'test_active' };
      }
    }
  }

  const approved = await client.query("SELECT version,name,status,rules FROM risk_rules WHERE status='clinician_approved' ORDER BY version DESC LIMIT 1");
  if (!approved.rows[0]) return getDemonstrationRules();
  return { ...approved.rows[0].rules, version: approved.rows[0].version, name: approved.rows[0].name, status: approved.rows[0].status };
}

export async function readTestRiskRuleActivation(client, environment = process.env.NODE_ENV) {
  if (environment !== 'development') return null;
  const settings = await client.query('SELECT data FROM clinic_settings WHERE id=1');
  const activation = settings.rows[0]?.data?.testRiskRuleActivation;
  if (!validRuleId(activation?.ruleId)) return null;
  const result = await client.query('SELECT id,status,rules FROM risk_rules WHERE id=$1', [activation.ruleId]);
  if (!eligibleTestRule(result.rows[0])) return null;
  return { ruleId: activation.ruleId, activatedAt: activation.activatedAt || null };
}

export async function activateRiskRuleForTesting(client, ruleId, environment = process.env.NODE_ENV) {
  if (environment !== 'development') {
    throw testActivationError(404, 'NOT_FOUND', 'Test rule activation is only available in development.');
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext('risk-rule-test-activation'))");
  const locked = await client.query('SELECT data FROM clinic_settings WHERE id=1 FOR UPDATE');
  if (!locked.rowCount) throw testActivationError(500, 'SETTINGS_NOT_FOUND', 'Clinic settings are unavailable.');
  const current = locked.rows[0]?.data && typeof locked.rows[0].data === 'object' && !Array.isArray(locked.rows[0].data)
    ? locked.rows[0].data
    : {};
  const result = await client.query('SELECT id,version,name,status,rules FROM risk_rules WHERE id=$1 FOR UPDATE', [ruleId]);
  if (!result.rowCount) throw testActivationError(404, 'NOT_FOUND', 'Risk rule version not found.');
  const rule = result.rows[0];
  if (!eligibleTestRule(rule)) {
    throw testActivationError(409, 'RULE_NOT_ELIGIBLE_FOR_TESTING', 'Only a valid conservative triage draft can be enabled for testing.');
  }
  const existing = current.testRiskRuleActivation;
  if (existing?.ruleId === ruleId) return { activation: { ruleId, activatedAt: existing.activatedAt || null }, changed: false };

  const activation = { ruleId, activatedAt: new Date().toISOString() };
  await client.query(
    'UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1',
    [JSON.stringify({ ...current, testRiskRuleActivation: activation })],
  );
  return { activation, changed: true, rule: { id: rule.id, version: rule.version, name: rule.name, status: rule.status } };
}

export async function disableRiskRuleTesting(client, environment = process.env.NODE_ENV) {
  if (environment !== 'development') {
    throw testActivationError(404, 'NOT_FOUND', 'Test rule activation is only available in development.');
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext('risk-rule-test-activation'))");
  const locked = await client.query('SELECT data FROM clinic_settings WHERE id=1 FOR UPDATE');
  if (!locked.rowCount) throw testActivationError(500, 'SETTINGS_NOT_FOUND', 'Clinic settings are unavailable.');
  const current = locked.rows[0]?.data && typeof locked.rows[0].data === 'object' && !Array.isArray(locked.rows[0].data)
    ? locked.rows[0].data
    : {};
  if (!current.testRiskRuleActivation) return { changed: false };
  const ruleId = current.testRiskRuleActivation.ruleId;

  const next = { ...current };
  delete next.testRiskRuleActivation;
  await client.query(
    'UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1',
    [JSON.stringify(next)],
  );
  return { changed: true, ruleId: validRuleId(ruleId) ? ruleId : null };
}

export async function ensureConservativeCandidateDraft(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('risk-rule-conservative-candidate'))");
  const existing = await client.query(
    "SELECT id,version,name,status FROM risk_rules WHERE rules->>'mode'=$1 ORDER BY version DESC LIMIT 1",
    [CONSERVATIVE_TRIAGE_MODE],
  );
  if (existing.rowCount) return { ...existing.rows[0], created: false };

  const latest = await client.query('SELECT COALESCE(MAX(version),0)::int AS version FROM risk_rules');
  const version = Number(latest.rows[0]?.version || 0) + 1;
  const candidate = getConservativeCandidateRuleDraft();
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO risk_rules(id,version,name,rules,status,approved_by,approved_at) VALUES($1,$2,$3,$4::jsonb,'draft',NULL,NULL)",
    [id, version, candidate.name, JSON.stringify(candidate.rules)],
  );
  return { id, version, name: candidate.name, status: 'draft', created: true };
}
