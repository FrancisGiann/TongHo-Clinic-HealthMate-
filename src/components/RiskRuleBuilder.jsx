import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createEmptyRiskRuleForm, describeRiskCondition, riskRuleFields, riskRuleFormFromRule, serializeRiskRuleForm } from '../utils/riskRules';

const numericOperators = [
  ['gte', 'is at least'],
  ['gt', 'is above'],
  ['lte', 'is at most'],
  ['lt', 'is below'],
];

export function RiskRuleDetails({ rule }) {
  const rules = rule?.rules || {};
  const requiredFields = (rules.requiredFields || []).map((key) => riskRuleFields.find((field) => field.key === key)?.label || key);
  const conservative = rules.mode === 'conservative_triage_v1';

  return (
    <details className="risk-rule-details">
      <summary>View required information and conditions</summary>
      {conservative ? <>
        <p>Special partial screening: it does not calculate a weighted score. A clinician warning sign marks urgent review. Temperatures below 36 °C or above 39 °C require nurse review. No matching sign remains unclassified and still requires a nurse to complete the assessment.</p>
        <ul>
          {(rules.indicators || []).map((indicator, index) => <li key={`${indicator.field}-${indicator.operator}-${index}`}>
            <strong>{indicator.label}</strong><span>{describeRiskCondition(indicator)}{indicator.outcome === 'urgent' ? ' · urgent review' : ' · nurse review'}</span>
          </li>)}
        </ul>
      </> : <>
        <dl className="risk-rule-score-thresholds">
          <div><dt>Moderate from</dt><dd>{rules.thresholds?.moderate ?? 'Not set'} points</dd></div>
          <div><dt>High from</dt><dd>{rules.thresholds?.high ?? 'Not set'} points</dd></div>
        </dl>
        <p>Every matching condition adds its points. Overlapping conditions both count; for example, a score can match both a higher cutoff and a lower cutoff.</p>
        <ul>
          {(rules.indicators || []).map((indicator, index) => <li key={`${indicator.field}-${indicator.operator}-${index}`}>
            <strong>{indicator.label}</strong><span>{describeRiskCondition(indicator)} · adds {indicator.weight} point{Number(indicator.weight) === 1 ? '' : 's'}</span>
          </li>)}
        </ul>
      </>}
      <p><strong>Required before scoring:</strong> {requiredFields.length ? requiredFields.join(', ') : 'No required fields selected.'}</p>
      <p className="risk-rule-disclaimer">Decision support only. A nurse remains responsible for the full assessment and clinical judgment.</p>
    </details>
  );
}

export default function RiskRuleBuilder({ onSave, saving = false, busy = false, demonstrationRules, seed }) {
  const [form, setForm] = useState(createEmptyRiskRuleForm);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const next = seed?.rule ? riskRuleFormFromRule(seed.rule) : null;
    setForm(next || createEmptyRiskRuleForm());
    setFormError('');
    if (next) {
      window.requestAnimationFrame(() => {
        const nameField = document.getElementById('risk-rule-draft-name');
        nameField?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        nameField?.focus({ preventScroll: true });
      });
    }
  }, [seed?.revision]);

  const disabled = busy || saving;

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateThreshold = (key, value) => setForm((current) => ({
    ...current,
    thresholds: { ...current.thresholds, [key]: value },
  }));
  const updateIndicator = (index, key, value) => setForm((current) => ({
    ...current,
    indicators: current.indicators.map((indicator, itemIndex) => itemIndex === index ? { ...indicator, [key]: value } : indicator),
  }));
  const useDemonstrationExample = () => {
    const example = riskRuleFormFromRule(demonstrationRules, { copyName: false });
    if (!example) return;
    example.name = 'Copy of demonstration rules';
    setForm(example);
    setFormError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    try {
      const payload = serializeRiskRuleForm(form);
      const saved = await onSave(payload);
      if (saved) setForm(createEmptyRiskRuleForm());
    } catch (error) {
      setFormError(error.message || 'Check the rule details and try again.');
    }
  };

  return (
    <form className="risk-rule-builder" onSubmit={submit} aria-labelledby="risk-rule-builder-title">
      <div className="risk-rule-builder-heading">
        <div><h4 id="risk-rule-builder-title">Create a risk-rule draft</h4><p>Use clear conditions and point values. Saving creates an inactive draft for clinical review.</p></div>
        <button type="button" className="secondary-btn" onClick={useDemonstrationExample} disabled={!demonstrationRules || disabled}>Load demonstration example</button>
      </div>
      <p className="risk-rule-builder-note">Enter thresholds already reviewed for your clinic. A draft does not change assessments. Only a verified school nurse can approve and use it.</p>

      <label className="risk-rule-name-field">Draft name
        <input id="risk-rule-draft-name" value={form.name} maxLength="120" onChange={(event) => updateField('name', event.target.value)} placeholder="For example, pain and visit-frequency draft" required disabled={disabled} />
      </label>

      <fieldset className="risk-rule-fieldset">
        <legend>Information the nurse must enter</legend>
        <p>Select only the information needed to score this rule. Missing optional measurements will not count as zero.</p>
        <div className="risk-rule-field-options">
          {riskRuleFields.map((field) => <label className="risk-rule-check" key={field.key}>
            <input type="checkbox" checked={form.requiredFields.includes(field.key)} disabled={disabled} onChange={(event) => {
              const checked = event.target.checked;
              updateField('requiredFields', checked
                ? [...form.requiredFields, field.key]
                : form.requiredFields.filter((item) => item !== field.key));
            }} />
            <span>{field.label}</span>
          </label>)}
        </div>
      </fieldset>

      <fieldset className="risk-rule-fieldset">
        <legend>Score categories</legend>
        <p>The total is the sum of all matching condition points.</p>
        <div className="two-fields risk-rule-score-inputs">
          <label>Moderate from<input type="number" min="1" max="100" step="any" value={form.thresholds.moderate} onChange={(event) => updateThreshold('moderate', event.target.value)} required disabled={disabled} /></label>
          <label>High from<input type="number" min="1" max="100" step="any" value={form.thresholds.high} onChange={(event) => updateThreshold('high', event.target.value)} required disabled={disabled} /></label>
        </div>
      </fieldset>

      <fieldset className="risk-rule-fieldset risk-rule-conditions">
        <legend>Conditions that add points</legend>
        <p>All matching conditions count. If one measurement meets two conditions, both point values are added.</p>
        <div className="risk-rule-condition-list">
          {form.indicators.map((indicator, index) => {
            const field = riskRuleFields.find((option) => option.key === indicator.field) || riskRuleFields[0];
            return <fieldset className="risk-rule-condition" key={index}>
              <legend>Condition {index + 1}</legend>
              <div className="risk-rule-condition-grid">
                <label>Information<select value={indicator.field} disabled={disabled} onChange={(event) => {
                  const nextField = riskRuleFields.find((option) => option.key === event.target.value);
                  updateIndicator(index, 'field', nextField.key);
                  if (nextField.kind === 'boolean') {
                    updateIndicator(index, 'operator', 'equals');
                    updateIndicator(index, 'value', null);
                  } else {
                    if (indicator.operator === 'equals') updateIndicator(index, 'operator', 'gte');
                    if (typeof indicator.value === 'boolean' || indicator.value === null) updateIndicator(index, 'value', '');
                  }
                }}>{riskRuleFields.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
                <label>Matches<select value={indicator.operator} disabled={disabled} onChange={(event) => updateIndicator(index, 'operator', event.target.value)}>
                  {field.kind === 'boolean' ? <option value="equals">is</option> : numericOperators.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></label>
                <label>{field.kind === 'boolean' ? 'Answer' : 'Cutoff'}{field.kind === 'boolean'
                  ? <select value={indicator.value === true ? 'true' : indicator.value === false ? 'false' : ''} disabled={disabled} required onChange={(event) => updateIndicator(index, 'value', event.target.value === '' ? null : event.target.value === 'true')}><option value="">Choose yes or no</option><option value="true">Yes</option><option value="false">No</option></select>
                  : <input type="number" step="any" value={indicator.value === null || typeof indicator.value === 'boolean' ? '' : indicator.value} onChange={(event) => updateIndicator(index, 'value', event.target.value)} required disabled={disabled} />}</label>
                <label>Points<input type="number" min="1" max="20" step="1" value={indicator.weight} onChange={(event) => updateIndicator(index, 'weight', event.target.value)} required disabled={disabled} /></label>
              </div>
              <div className="risk-rule-condition-footer">
                <label>Explanation shown with the result<input value={indicator.label} maxLength="120" onChange={(event) => updateIndicator(index, 'label', event.target.value)} placeholder="Describe what this condition means" required disabled={disabled} /></label>
                <button type="button" className="table-action risk-rule-remove" onClick={() => setForm((current) => ({ ...current, indicators: current.indicators.filter((_, itemIndex) => itemIndex !== index) }))} disabled={disabled || form.indicators.length === 1} aria-label={`Remove condition ${index + 1}`}><Trash2 size={15} aria-hidden="true" /> Remove</button>
              </div>
            </fieldset>;
          })}
        </div>
        <button type="button" className="secondary-btn risk-rule-add" onClick={() => setForm((current) => ({
          ...current,
          indicators: [...current.indicators, { field: 'painScore', operator: 'gte', value: '', weight: '', label: '' }],
        }))} disabled={disabled || form.indicators.length >= 30}><Plus size={15} aria-hidden="true" /> Add condition</button>
      </fieldset>

      {formError && <p className="risk-feedback is-error" role="alert">{formError}</p>}
      <div className="form-actions">
        <button className="primary-btn" type="submit" disabled={disabled}>{saving ? 'Saving inactive draft…' : 'Save inactive draft'}</button>
      </div>
    </form>
  );
}
