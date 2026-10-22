import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import {
  LANDING_SECTION_IDS,
  LANDING_TIME_ZONE,
  createDefaultLandingContent,
  validateLandingContent,
} from '../../shared/landingContent.js';
import { announcementFromForm, announcementToForm } from '../utils/landingContentForm.js';

const SECTION_LABELS = {
  clinic: 'Clinic information',
  announcements: 'Announcements',
  faqs: 'Frequently asked questions',
};

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function formFromContent(content) {
  const next = copy(content || createDefaultLandingContent());
  next.announcements = next.announcements.map(announcementToForm);
  return next;
}

function contentFromForm(form) {
  return {
    ...form,
    announcements: form.announcements.map(announcementFromForm),
  };
}

function contentEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function publishedDateLabel(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: LANDING_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export default function LandingContentEditor() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(() => formFromContent(createDefaultLandingContent()));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setMessage('');
    api.get('/api/admin/landing-content').then((data) => {
      if (!active) return;
      setSaved(data);
      setForm(formFromContent(data.draftContent));
      setConflict(false);
    }).catch((requestError) => {
      if (active) setError(requestError.message || 'Landing-page content could not be loaded. Retry to continue.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadAttempt]);

  const payload = useMemo(() => contentFromForm(form), [form]);
  const validation = useMemo(() => validateLandingContent(payload), [payload]);
  const isDirty = !validation.valid || !contentEqual(validation.value, saved?.draftContent);
  const draftMatchesPublished = Boolean(saved) && contentEqual(saved.draftContent, saved.publishedContent);
  const busy = saving || publishing;

  useEffect(() => {
    if (!isDirty) return undefined;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isDirty]);

  const updateHero = (key, value) => setForm((current) => ({ ...current, hero: { ...current.hero, [key]: value } }));
  const updateClinic = (key, value) => setForm((current) => ({ ...current, clinic: { ...current.clinic, [key]: value } }));
  const updateItem = (collection, index, key, value) => setForm((current) => ({
    ...current,
    [collection]: current[collection].map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
  }));

  const reloadSaved = () => {
    if (isDirty && !window.confirm('Reload the saved server version and discard these unsaved edits?')) return;
    setLoadAttempt((value) => value + 1);
  };

  const saveDraft = async (event) => {
    event?.preventDefault();
    if (!saved || busy || !validation.valid || !isDirty) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.put('/api/admin/landing-content/draft', { version: saved.contentVersion, content: validation.value });
      setSaved(result);
      setForm(formFromContent(result.draftContent));
      setConflict(false);
      setMessage('Draft saved. It stays private until you publish it.');
    } catch (requestError) {
      setError(requestError.message || 'The draft could not be saved. Your edits are still here.');
      setConflict(requestError.status === 409);
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    if (!saved || busy || !validation.valid || isDirty || draftMatchesPublished) return;
    setPublishing(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post('/api/admin/landing-content/publish', { version: saved.contentVersion });
      setSaved(result);
      setForm(formFromContent(result.draftContent));
      setConflict(false);
      setMessage('Saved draft published to the public landing page.');
    } catch (requestError) {
      setError(requestError.message || 'The saved draft could not be published.');
      setConflict(requestError.status === 409);
    } finally {
      setPublishing(false);
    }
  };

  const previewDraft = () => {
    if (isDirty || loading || busy) return;
    window.open('/landing-preview?preview=draft', '_blank', 'noopener,noreferrer');
  };

  const moveSection = (section, direction) => setForm((current) => {
    const index = current.sectionOrder.indexOf(section);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= current.sectionOrder.length) return current;
    const sectionOrder = [...current.sectionOrder];
    [sectionOrder[index], sectionOrder[destination]] = [sectionOrder[destination], sectionOrder[index]];
    return { ...current, sectionOrder };
  });

  const fieldError = (name) => validation.errors[name] || '';

  return (
    <section className="cms-content-editor" id="cms-landing-content" aria-labelledby="cms-landing-content-title">
      <header className="cms-content-editor-heading">
        <div>
          <h3 id="cms-landing-content-title">Landing page content</h3>
          <p>Save changes as a private draft, preview the saved draft, then publish when it is ready.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={reloadSaved} disabled={loading || busy}>Reload saved content</button>
      </header>

      <div className="cms-content-state" role="status" aria-live="polite">
        <p><strong>Draft:</strong> {isDirty ? 'Unsaved edits' : 'Saved'}{saved?.draftUpdatedAt ? ` · updated ${publishedDateLabel(saved.draftUpdatedAt)} Philippine time` : ''}</p>
        <p><strong>Public page:</strong> {draftMatchesPublished ? 'matches the saved draft' : 'still shows the last published content'}{saved?.publishedAt ? ` · published ${publishedDateLabel(saved.publishedAt)} Philippine time` : ''}</p>
      </div>

      {error && <div className="error-banner" role="alert">
        <span>{conflict ? `${error} Your unsaved edits are preserved; reload only if you want to replace them with the saved version.` : error}</span>
        <button type="button" className="secondary-btn" onClick={() => conflict ? reloadSaved() : setLoadAttempt((value) => value + 1)} disabled={loading || busy}>
          {conflict ? 'Reload saved version' : 'Retry'}
        </button>
      </div>}
      {message && <p className="success-message" role="status">{message}</p>}
      {loading && <p className="field-hint" role="status">Loading saved landing-page content…</p>}

      {!loading && saved && <form className="cms-content-form" onSubmit={saveDraft}>
        <div className="cms-content-toolbar">
          <div className="cms-content-action-note" role="status">
            {isDirty ? 'Save your edits before previewing or publishing.' : 'Preview opens the saved draft; publishing makes it public.'}
          </div>
          <div className="cms-content-action-buttons">
            <button type="button" className="secondary-btn" onClick={previewDraft} disabled={busy || isDirty}>Preview saved draft</button>
            <button type="submit" className="secondary-btn" disabled={busy || !isDirty || !validation.valid}>{saving ? 'Saving draft…' : 'Save draft'}</button>
            <button type="button" className="primary-btn" onClick={publishDraft} disabled={busy || isDirty || !validation.valid || draftMatchesPublished}>{publishing ? 'Publishing…' : 'Publish saved draft'}</button>
          </div>
        </div>
        {!validation.valid && <div className="error-banner cms-validation-summary" role="alert">
          <strong>Review these fields before saving:</strong>
          <ul>{Object.entries(validation.errors).map(([field, messageText]) => <li key={field}>{field}: {messageText}</li>)}</ul>
        </div>}

        <fieldset className="cms-content-group">
          <legend>Hero message</legend>
          <p className="field-hint">The school seal remains in the hero. Sign-in and access links keep their existing destinations.</p>
          <div className="cms-content-fields">
            <label>Headline
              <input type="text" maxLength={120} value={form.hero.headline} aria-invalid={Boolean(fieldError('hero.headline'))} onChange={(event) => updateHero('headline', event.target.value)} />
            </label>
            <label>Introduction
              <textarea rows={3} maxLength={500} value={form.hero.introduction} aria-invalid={Boolean(fieldError('hero.introduction'))} onChange={(event) => updateHero('introduction', event.target.value)} />
            </label>
            <label>Sign-in button label
              <input type="text" maxLength={60} value={form.hero.primaryActionLabel} onChange={(event) => updateHero('primaryActionLabel', event.target.value)} />
            </label>
            <label>Access link label
              <input type="text" maxLength={60} value={form.hero.secondaryActionLabel} onChange={(event) => updateHero('secondaryActionLabel', event.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="cms-content-group">
          <legend>Optional sections</legend>
          <p className="field-hint">Sections with no information are omitted from the public page. Choose which populated sections appear and set their order.</p>
          <div className="cms-section-order-list">
            {form.sectionOrder.map((section, index) => (
              <div className="cms-section-order-row" key={section}>
                <label className="check-label"><input type="checkbox" checked={form.sectionVisibility[section]} onChange={(event) => setForm((current) => ({
                  ...current,
                  sectionVisibility: { ...current.sectionVisibility, [section]: event.target.checked },
                }))} /> Show {SECTION_LABELS[section]}</label>
                <div className="cms-section-reorder">
                  <button type="button" className="table-action" onClick={() => moveSection(section, -1)} disabled={index === 0} aria-label={`Move ${SECTION_LABELS[section]} up`}>Move up</button>
                  <button type="button" className="table-action" onClick={() => moveSection(section, 1)} disabled={index === LANDING_SECTION_IDS.length - 1} aria-label={`Move ${SECTION_LABELS[section]} down`}>Move down</button>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="cms-content-group">
          <legend>Clinic information</legend>
          <p className="field-hint">Leave details blank until school-approved information is available. Contact details display as plain text.</p>
          <div className="cms-content-fields">
            <label>Location
              <input type="text" maxLength={160} value={form.clinic.location} onChange={(event) => updateClinic('location', event.target.value)} />
            </label>
            <label>Hours
              <textarea rows={2} maxLength={280} value={form.clinic.hours} onChange={(event) => updateClinic('hours', event.target.value)} />
            </label>
            <label>Contact
              <textarea rows={2} maxLength={200} value={form.clinic.contact} onChange={(event) => updateClinic('contact', event.target.value)} />
            </label>
          </div>
          <div className="cms-repeater-heading">
            <div><h4>Services</h4><p>Optional plain-text list; no services are pre-filled.</p></div>
            <button type="button" className="secondary-btn" onClick={() => updateClinic('services', [...form.clinic.services, ''])} disabled={form.clinic.services.length >= 8}>Add service</button>
          </div>
          {form.clinic.services.length === 0 && <p className="cms-empty-guidance">No services listed. Add only school-approved clinic services.</p>}
          <div className="cms-repeat-list">
            {form.clinic.services.map((service, index) => (
              <div className="cms-repeat-row" key={`service-${index}`}>
                <label><span className="sr-only">Service {index + 1}</span><input type="text" maxLength={120} value={service} aria-invalid={Boolean(fieldError(`clinic.services.${index}`))} onChange={(event) => updateClinic('services', form.clinic.services.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>
                <button type="button" className="table-action" onClick={() => updateClinic('services', form.clinic.services.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove service ${index + 1}`}>Remove</button>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="cms-content-group">
          <legend>Announcements</legend>
          <p className="field-hint">Only notices within their start and expiry window appear publicly. Times use Philippine time ({LANDING_TIME_ZONE}, UTC+08:00).</p>
          <div className="cms-repeater-heading">
            <div><h4>Public notices</h4><p>Scheduled and expired notices stay in this draft for editing but are hidden from visitors.</p></div>
            <button type="button" className="secondary-btn" onClick={() => setForm((current) => ({
              ...current,
              announcements: [...current.announcements, { title: '', body: '', startsAt: '', expiresAt: '' }],
            }))} disabled={form.announcements.length >= 6}>Add announcement</button>
          </div>
          {form.announcements.length === 0 && <p className="cms-empty-guidance">No announcements are configured. The public page omits this section until a notice is saved and published.</p>}
          <div className="cms-repeat-list">
            {form.announcements.map((item, index) => (
              <article className="cms-repeat-item" key={`announcement-${index}`}>
                <header><h4>Announcement {index + 1}</h4><button type="button" className="table-action" onClick={() => setForm((current) => ({ ...current, announcements: current.announcements.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove announcement ${index + 1}`}>Remove</button></header>
                <div className="cms-content-fields">
                  <label>Title
                    <input type="text" maxLength={100} value={item.title} aria-invalid={Boolean(fieldError(`announcements.${index}.title`))} onChange={(event) => updateItem('announcements', index, 'title', event.target.value)} />
                  </label>
                  <label>Message
                    <textarea rows={3} maxLength={600} value={item.body} aria-invalid={Boolean(fieldError(`announcements.${index}.body`))} onChange={(event) => updateItem('announcements', index, 'body', event.target.value)} />
                  </label>
                  <label>Start date and time · Philippine time
                    <input type="datetime-local" value={item.startsAt} aria-invalid={Boolean(fieldError(`announcements.${index}.startsAt`))} onChange={(event) => updateItem('announcements', index, 'startsAt', event.target.value)} />
                  </label>
                  <label>Expiry date and time · Philippine time
                    <input type="datetime-local" value={item.expiresAt} aria-invalid={Boolean(fieldError(`announcements.${index}.expiresAt`))} onChange={(event) => updateItem('announcements', index, 'expiresAt', event.target.value)} />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </fieldset>

        <fieldset className="cms-content-group">
          <legend>Frequently asked questions</legend>
          <p className="field-hint">Answers are plain text and appear in expandable questions on the public page.</p>
          <div className="cms-repeater-heading">
            <div><h4>Questions and answers</h4><p>No example FAQs are pre-filled.</p></div>
            <button type="button" className="secondary-btn" onClick={() => setForm((current) => ({ ...current, faqs: [...current.faqs, { question: '', answer: '' }] }))} disabled={form.faqs.length >= 12}>Add question</button>
          </div>
          {form.faqs.length === 0 && <p className="cms-empty-guidance">No questions configured. Add a question and answer only when approved by the school.</p>}
          <div className="cms-repeat-list">
            {form.faqs.map((item, index) => (
              <article className="cms-repeat-item" key={`faq-${index}`}>
                <header><h4>Question {index + 1}</h4><button type="button" className="table-action" onClick={() => setForm((current) => ({ ...current, faqs: current.faqs.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove question ${index + 1}`}>Remove</button></header>
                <div className="cms-content-fields">
                  <label>Question
                    <input type="text" maxLength={180} value={item.question} aria-invalid={Boolean(fieldError(`faqs.${index}.question`))} onChange={(event) => updateItem('faqs', index, 'question', event.target.value)} />
                  </label>
                  <label>Answer
                    <textarea rows={3} maxLength={1200} value={item.answer} aria-invalid={Boolean(fieldError(`faqs.${index}.answer`))} onChange={(event) => updateItem('faqs', index, 'answer', event.target.value)} />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </fieldset>

      </form>}
    </section>
  );
}
