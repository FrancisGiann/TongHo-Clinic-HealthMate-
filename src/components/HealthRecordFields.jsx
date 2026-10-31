const EMPTY_RECORD = {
  birthDate: '', gender: '', motherName: '', fatherName: '', guardianName: '', guardianPhone: '', guardianRelation: 'Parent',
  bloodType: '', allergies: '', allergiesStatus: 'unknown', conditions: '', conditionsStatus: 'unknown', medications: '', medicationsStatus: 'unknown', pastIllness: {}, presentIllness: {},
  hospitalizationHistory: null, hospitalizationDetails: '', g6pdDeficiency: '', medicationAtHome: {},
  takingRegularMedication: '', regularMedicationName: '', onTherapy: null, lastTreatmentDate: '', therapistName: '', therapyInterventions: '',
  hasConcerns: null, concernsDetails: '', documentsSubmitted: {},
};

export const emptyHealthRecord = () => ({
  ...EMPTY_RECORD,
  pastIllness: { chickenpox: null, pneumonia: null, dengue: null, measles: null, gastroenteritis: null, amoebasis: null, typhoidFever: null, heartDisease: null, asthma: null, headInjury: null, otherPastIllness: '' },
  presentIllness: { allergicRhinitis: null, hyperacidity: null, asthma: null, skinDisorder: null, skinDisorderDetails: '', eyeDisorder: null, eyeDisorderDetails: '', otherPresentIllness: '' },
  medicationAtHome: { pain: null, painName: '', fever: null, feverName: '', allergies: null, allergiesName: '', stomachache: null, stomachacheName: '', otherMedication: '' },
  documentsSubmitted: { psychiatricEvaluation: null, diagnosticAssessment: null, medicationRecords: null },
});

export function ageFromBirthDate(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const birthDate = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(birthDate.getTime()) || birthDate > today) return '';
  let age = today.getFullYear() - birthDate.getFullYear();
  if (today.getMonth() < birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

const pastIllnesses = [
  ['chickenpox', 'Chickenpox'], ['pneumonia', 'Pneumonia'], ['dengue', 'Dengue'], ['measles', 'Measles'],
  ['gastroenteritis', 'Gastroenteritis'], ['amoebasis', 'Amoebiasis'], ['typhoidFever', 'Typhoid fever'],
  ['heartDisease', 'Heart disease'], ['asthma', 'Asthma'], ['headInjury', 'Head injury'],
];
const presentIllnesses = [
  ['allergicRhinitis', 'Allergic rhinitis'], ['hyperacidity', 'Hyperacidity'], ['asthma', 'Asthma'],
  ['skinDisorder', 'Skin disorder'], ['eyeDisorder', 'Eye disorder'],
];
const homeMedicines = [['pain', 'Pain reliever', 'painName'], ['fever', 'Fever medicine', 'feverName'], ['allergies', 'Allergy medicine', 'allergiesName'], ['stomachache', 'Stomach medicine', 'stomachacheName']];
const documents = [['psychiatricEvaluation', 'Psychiatric evaluation'], ['diagnosticAssessment', 'Diagnostic assessment'], ['medicationRecords', 'Medication records']];

export default function HealthRecordFields({ value, onChange, disabled = false, section }) {
  const form = { ...emptyHealthRecord(), ...(value || {}) };
  const setField = (key, next) => onChange({ ...form, [key]: next });
  const setFields = (updates) => onChange({ ...form, ...updates });
  const setNested = (key, field, next) => onChange({ ...form, [key]: { ...form[key], [field]: next } });
  return (
    <>
      {(section === undefined || section === 0) && <section className="form-section">
        <h3 className="section-title">Student and family details</h3>
        <div className="three-fields">
          <label>Date of birth<input type="date" value={form.birthDate} onChange={(event) => setField('birthDate', event.target.value)} disabled={disabled} /></label>
          <label>Age<input value={ageFromBirthDate(form.birthDate) ?? ''} placeholder="Calculated from birth date" readOnly /></label>
          <label>Gender<select value={form.gender} onChange={(event) => setField('gender', event.target.value)} disabled={disabled}><option value="">Choose</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></label>
        </div>
        <div className="two-fields">
          <label>Mother’s name<input maxLength={160} value={form.motherName} onChange={(event) => setField('motherName', event.target.value)} disabled={disabled} /></label>
          <label>Father’s name<input maxLength={160} value={form.fatherName} onChange={(event) => setField('fatherName', event.target.value)} disabled={disabled} /></label>
        </div>
        <div className="three-fields">
          <label>Parent or guardian name<input maxLength={160} value={form.guardianName} onChange={(event) => setField('guardianName', event.target.value)} disabled={disabled} /></label>
          <label>Relationship<select value={form.guardianRelation} onChange={(event) => setField('guardianRelation', event.target.value)} disabled={disabled}><option>Parent</option><option>Grandparent</option><option>Aunt/Uncle</option><option>Legal guardian</option><option>Other</option></select></label>
          <label>Contact number<input type="tel" maxLength={40} value={form.guardianPhone} onChange={(event) => setField('guardianPhone', event.target.value)} disabled={disabled} /></label>
        </div>
      </section>}

      {(section === undefined || section === 1) && <section className="form-section">
        <h3 className="section-title">Health information</h3>
        <div className="two-fields">
          <label>Blood type <span className="field-hint">Optional</span><select value={form.bloodType} onChange={(event) => setField('bloodType', event.target.value)} disabled={disabled}><option value="">Not known / not provided</option>{['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>G6PD deficiency<select value={form.g6pdDeficiency} onChange={(event) => setField('g6pdDeficiency', event.target.value)} disabled={disabled}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        </div>
        <NoneOrDetails label="Known allergies" field="allergies" statusField="allergiesStatus" form={form} setField={setField} setFields={setFields} disabled={disabled} />
        <NoneOrDetails label="Existing medical conditions" field="conditions" statusField="conditionsStatus" form={form} setField={setField} setFields={setFields} disabled={disabled} />
        <NoneOrDetails label="Current medications and dosage" field="medications" statusField="medicationsStatus" form={form} setField={setField} setFields={setFields} disabled={disabled} />
        <ChoiceGroup title="Past illnesses" items={pastIllnesses} value={form.pastIllness} setValue={(field, next) => setNested('pastIllness', field, next)} disabled={disabled} />
        <label>Other past illnesses<input maxLength={1000} value={form.pastIllness.otherPastIllness || ''} onChange={(event) => setNested('pastIllness', 'otherPastIllness', event.target.value)} disabled={disabled} /></label>
        <ChoiceGroup title="Current or present conditions" items={presentIllnesses} value={form.presentIllness} setValue={(field, next) => setNested('presentIllness', field, next)} disabled={disabled} />
        {form.presentIllness.skinDisorder === true && <label>Skin disorder, specify<input maxLength={200} value={form.presentIllness.skinDisorderDetails || ''} onChange={(event) => setNested('presentIllness', 'skinDisorderDetails', event.target.value)} disabled={disabled} /></label>}
        {form.presentIllness.eyeDisorder === true && <label>Eye disorder, specify<input maxLength={200} value={form.presentIllness.eyeDisorderDetails || ''} onChange={(event) => setNested('presentIllness', 'eyeDisorderDetails', event.target.value)} disabled={disabled} /></label>}
        <label>Other current conditions<input maxLength={1000} value={form.presentIllness.otherPresentIllness || ''} onChange={(event) => setNested('presentIllness', 'otherPresentIllness', event.target.value)} disabled={disabled} /></label>
      </section>}

      {(section === undefined || section === 2) && <section className="form-section">
        <h3 className="section-title">Care history</h3>
        <label>Hospitalized in the past year<BinarySelect value={form.hospitalizationHistory} onChange={(next) => setField('hospitalizationHistory', next)} disabled={disabled} /></label>
        {form.hospitalizationHistory && <label>Reason and dates<textarea maxLength={1000} rows={2} value={form.hospitalizationDetails} onChange={(event) => setField('hospitalizationDetails', event.target.value)} disabled={disabled} /></label>}
        <ChoiceGroup title="Medication kept at home" items={homeMedicines} value={form.medicationAtHome} setValue={(field, next) => setNested('medicationAtHome', field, next)} disabled={disabled} />
        <label>Other medication kept at home<input maxLength={1000} value={form.medicationAtHome.otherMedication || ''} onChange={(event) => setNested('medicationAtHome', 'otherMedication', event.target.value)} disabled={disabled} /></label>
        <div className="two-fields">
          <label>Regular medication<select value={form.takingRegularMedication} onChange={(event) => setField('takingRegularMedication', event.target.value)} disabled={disabled}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>Medication name<input maxLength={1000} value={form.regularMedicationName} onChange={(event) => setField('regularMedicationName', event.target.value)} disabled={disabled} /></label>
        </div>
        <label>Currently receiving therapy or intervention<BinarySelect value={form.onTherapy} onChange={(next) => setField('onTherapy', next)} disabled={disabled} /></label>
        {form.onTherapy === true && <div className="two-fields"><label>Last treatment date<input type="date" value={form.lastTreatmentDate} onChange={(event) => setField('lastTreatmentDate', event.target.value)} disabled={disabled} /></label><label>Therapist or professional<input maxLength={160} value={form.therapistName} onChange={(event) => setField('therapistName', event.target.value)} disabled={disabled} /></label><label>Therapy/intervention occasions<textarea maxLength={1000} rows={2} value={form.therapyInterventions} onChange={(event) => setField('therapyInterventions', event.target.value)} disabled={disabled} placeholder="Frequency, dates, or type of intervention" /></label></div>}
        <label>Health concern to share<BinarySelect value={form.hasConcerns} onChange={(next) => setField('hasConcerns', next)} disabled={disabled} /></label>
        {form.hasConcerns && <label>Concern details<textarea maxLength={2000} rows={3} value={form.concernsDetails} onChange={(event) => setField('concernsDetails', event.target.value)} disabled={disabled} /></label>}
        <ChoiceGroup title="Documents I submitted" items={documents} value={form.documentsSubmitted} setValue={(field, next) => setNested('documentsSubmitted', field, next)} disabled={disabled} />
      </section>}
    </>
  );
}

function ChoiceGroup({ title, items, value, setValue, disabled }) {
  return <fieldset className="form-section"><legend className="section-title">{title}</legend><div className="three-fields">{items.map(([field, label, nameField]) => <div key={field}><label>{label}<BinarySelect value={value?.[field]} onChange={(next) => setValue(field, next)} disabled={disabled} /></label>{nameField && value?.[field] === true && <label>Medicine name<input maxLength={200} value={value?.[nameField] || ''} onChange={(event) => setValue(nameField, event.target.value)} disabled={disabled} /></label>}</div>)}</div></fieldset>;
}

function BinarySelect({ value, onChange, disabled }) {
  return <select value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(event) => onChange(event.target.value === 'yes' ? true : event.target.value === 'no' ? false : null)} disabled={disabled}><option value="">Unknown / not answered</option><option value="yes">Yes</option><option value="no">No</option></select>;
}

function NoneOrDetails({ label, field, statusField, form, setField, setFields, disabled }) {
  const isNone = form[statusField] === 'none';
  return <div className="none-or-details"><label>{label}<textarea maxLength={2000} rows={2} value={form[field]} onChange={(event) => setFields({ [field]: event.target.value, [statusField]: event.target.value ? 'reported' : 'unknown' })} disabled={disabled || isNone} placeholder="Leave blank if unknown" /></label><label className="checkbox-label"><input type="checkbox" checked={isNone} onChange={(event) => { if (event.target.checked) setFields({ [field]: '', [statusField]: 'none' }); else setField(statusField, 'unknown'); }} disabled={disabled} /> No {label.toLowerCase()} reported</label><p className="field-hint">A blank answer means unknown. Select the box only when none is reported.</p></div>;
}
