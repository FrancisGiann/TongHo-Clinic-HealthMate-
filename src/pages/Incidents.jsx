import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { formatManilaDateTime } from '../utils/dateTime';

const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyForm = () => ({ patientId: '', date: todayInManila(), time: '08:00', location: '', description: '', actionTaken: '', visitId: '' });
const PHOTO_NOTICE_VERSION = 'incident-photo-defense-v1';

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export default function Incidents({ data = {}, user }) {
  const isNurse = user?.role === 'school_nurse';
  const [incidents, setIncidents] = useState([]);
  const [photosEnabled, setPhotosEnabled] = useState(false);
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [guardiansByIncident, setGuardiansByIncident] = useState({});
  const [selectedGuardian, setSelectedGuardian] = useState({});
  const [busyAction, setBusyAction] = useState('');
  const [filterText, setFilterText] = useState('');
  const students = useMemo(() => (data.students || []).filter((patient) => patient.patientType === 'student' || !patient.patientType), [data.students]);
  const visits = data.visits || [];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    api.get('/api/incidents').then((result) => {
      if (!active) return;
      setIncidents(result.incidents || []);
      setPhotosEnabled(Boolean(result.photosEnabled));
      setStorageConfigured(Boolean(result.storageConfigured));
    }).catch((requestError) => {
      if (active) setLoadError(requestError.message || 'Incident reports could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const matchingIncidents = incidents.filter((incident) => {
    const needle = filterText.trim().toLocaleLowerCase();
    return !needle || `${incident.patientName} ${incident.schoolId} ${incident.location} ${incident.description}`.toLocaleLowerCase().includes(needle);
  });

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    const payload = { ...form, visitId: form.visitId || null };
    try {
      if (editingId) await api.patch(`/api/incidents/${encodeURIComponent(editingId)}`, payload);
      else await api.post('/api/incidents', payload);
      setMessage(editingId ? 'Incident report updated.' : 'Incident report saved.');
      setForm(emptyForm());
      setEditingId('');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The incident report could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const edit = (incident) => {
    setEditingId(incident.id);
    setForm({ patientId: incident.patientId, date: incident.date, time: incident.time, location: incident.location, description: incident.description, actionTaken: incident.actionTaken, visitId: incident.visitId || '' });
    setMessage('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const loadGuardians = async (incident) => {
    if (guardiansByIncident[incident.id]) return guardiansByIncident[incident.id];
    try {
      const result = await api.get(`/api/incidents/${encodeURIComponent(incident.id)}/eligible-guardians`);
      setGuardiansByIncident((current) => ({ ...current, [incident.id]: result.guardians || [] }));
      if (incident.photoConsent?.guardianUserId) setSelectedGuardian((current) => ({ ...current, [incident.id]: incident.photoConsent.guardianUserId }));
      return result.guardians || [];
    } catch (requestError) {
      setError(requestError.message || 'Linked guardian accounts could not be loaded.');
      return [];
    }
  };

  const requestConsent = async (incident) => {
    const guardianUserId = selectedGuardian[incident.id];
    if (!guardianUserId || busyAction) return;
    setBusyAction(`consent:${incident.id}`);
    setError('');
    setMessage('');
    try {
      await api.post(`/api/incidents/${encodeURIComponent(incident.id)}/photo-consent/request`, { guardianUserId });
      setMessage('Photo consent request sent to the selected linked guardian.');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The photo request could not be sent.');
    } finally {
      setBusyAction('');
    }
  };

  const decideConsent = async (incident, decision) => {
    if (busyAction) return;
    setBusyAction(`consent:${incident.id}`);
    setError('');
    setMessage('');
    try {
      await api.patch(`/api/incidents/${encodeURIComponent(incident.id)}/photo-consent`, { decision, noticeVersion: PHOTO_NOTICE_VERSION });
      setMessage(decision === 'revoked' ? 'Photo access ended immediately. Deletion has been queued.' : `Photo consent ${decision}.`);
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Your photo-consent response could not be saved.');
    } finally {
      setBusyAction('');
    }
  };

  const uploadPhoto = async (incident, file) => {
    if (!file || busyAction) return;
    if (file.size < 1 || file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP image no larger than 2 MiB. The clinic validates the image bytes before storage.');
      return;
    }
    setBusyAction(`photo:${incident.id}`);
    setError('');
    setMessage('');
    try {
      const dataBase64 = await readImage(file);
      await api.post(`/api/incidents/${encodeURIComponent(incident.id)}/photos`, { contentType: file.type, dataBase64 });
      setMessage('Incident photo uploaded under the current guardian consent.');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The incident photo could not be uploaded.');
    } finally {
      setBusyAction('');
    }
  };

  const removePhoto = async (incident, photo) => {
    if (busyAction) return;
    setBusyAction(`photo:${incident.id}`);
    setError('');
    setMessage('');
    try {
      await api.delete(`/api/incidents/${encodeURIComponent(incident.id)}/photos/${encodeURIComponent(photo.id)}`);
      setMessage('Photo access ended and deletion was queued.');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The photo could not be removed.');
    } finally {
      setBusyAction('');
    }
  };

  const patientVisits = visits.filter((visit) => String(visit.patientId || visit.studentId || '') === String(form.patientId));

  return <section className="incidents-page">
    <div className="page-intro"><div><h2>Incident reports</h2><p>{isNurse ? 'Record and review student incidents. Photo access requires a guardian decision.' : 'View incident reports for students linked to your account.'}</p></div></div>
    {isNurse && <section className="panel incident-editor">
      <div className="panel-heading"><div><h3>{editingId ? 'Edit incident report' : 'Record an incident'}</h3></div></div>
      <form onSubmit={submit}>
        <div className="incident-form-grid">
          <label>Student<select value={form.patientId} onChange={(event) => setForm((current) => ({ ...current, patientId: event.target.value, visitId: '' }))} required disabled={saving || Boolean(editingId)}><option value="">Choose a student</option>{students.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.studentId || 'ID unavailable'}</option>)}</select></label>
          <label>Date<input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} required disabled={saving} /></label>
          <label>Time<input type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} required disabled={saving} /></label>
          <label>Location<input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} minLength={1} maxLength={160} required disabled={saving} /></label>
          <label className="incident-form-wide">Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={5000} required disabled={saving} /></label>
          <label className="incident-form-wide">Action taken<textarea value={form.actionTaken} onChange={(event) => setForm((current) => ({ ...current, actionTaken: event.target.value }))} maxLength={5000} disabled={saving} /></label>
          <label className="incident-form-wide"><span>Linked clinic visit <span className="field-hint">(Optional)</span></span><select value={form.visitId} onChange={(event) => setForm((current) => ({ ...current, visitId: event.target.value }))} disabled={saving || !form.patientId}><option value="">No linked visit</option>{patientVisits.map((visit) => <option key={visit.id} value={visit.id}>{visit.date || visit.createdAt || 'Clinic visit'} · {visit.type || 'Visit'}</option>)}</select></label>
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="incident-form-actions"><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save incident report'}</button>{editingId && <button type="button" className="secondary-btn" onClick={() => { setEditingId(''); setForm(emptyForm()); setError(''); }} disabled={saving}>Cancel edit</button>}</div>
      </form>
    </section>}
    {message && <p className="success-message" role="status">{message}</p>}
    {error && !isNurse && <div className="error-banner" role="alert">{error}</div>}
    <section className="panel incident-list">
      <div className="panel-heading"><div><h3>{isNurse ? 'Recorded reports' : 'Reports for linked students'}</h3></div><label className="search-box incidents-search-box"><span>Search</span><input aria-label="Search incident reports" value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Student or incident" /></label></div>
      {!photosEnabled && <p className="disabled-note" role="status">Incident photos and consent are disabled by clinic configuration. Text-only reports remain available.</p>}
      {photosEnabled && !storageConfigured && <p className="disabled-note" role="status">Private image storage is not configured. Photo consent and photo access are unavailable until storage is configured.</p>}
      {loadError && <div className="error-banner incidents-load-error" role="alert"><span>{loadError}</span><button type="button" className="secondary-btn" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {loading ? <p className="field-hint" role="status">Loading incident reports…</p> : loadError && !incidents.length ? null : !matchingIncidents.length ? <div className="empty-state">{incidents.length ? 'No incident reports match this search.' : isNurse ? 'No student incident reports have been recorded.' : 'No incident reports are available for linked students.'}</div> : matchingIncidents.map((incident) => {
        const consent = incident.photoConsent;
        const busy = busyAction.endsWith(incident.id);
        return <article className="incident-card" key={incident.id}>
          <header className="incident-card-header"><div><span className="incident-date">{incident.date} · {incident.time}</span><h4>{incident.patientName} <small>{incident.schoolId}</small></h4><p>{incident.location}</p></div>{isNurse && <button type="button" className="table-action" onClick={() => edit(incident)}>Edit report</button>}</header>
          <dl className="incident-detail-list"><div><dt>Description</dt><dd>{incident.description}</dd></div>{incident.actionTaken && <div><dt>Action taken</dt><dd>{incident.actionTaken}</dd></div>}{incident.visitId && <div><dt>Linked clinic visit</dt><dd>{incident.visitId}</dd></div>}</dl>
          {photosEnabled && storageConfigured && <section className="incident-photo-consent">
            <h5>Incident photos</h5>
            <p className="field-hint">Photos are requested only for a defense-related review. Access ends immediately when consent is revoked; deletion is queued. Photos expire after one year at the latest, with removal after the defense purpose ends.</p>
            {isNurse && <div className="incident-consent-request">
              {consent?.status && <span className="status-chip neutral">Consent {consent.status}</span>}
              {['pending', 'granted'].includes(consent?.status) ? <span className="field-hint">A request is already active for this incident.</span> : <>
                <button type="button" className="secondary-btn" onClick={() => loadGuardians(incident)} disabled={busy}>Load linked guardians</button>
                {(guardiansByIncident[incident.id] || []).length > 0 && <><label>Request guardian<select value={selectedGuardian[incident.id] || ''} onChange={(event) => setSelectedGuardian((current) => ({ ...current, [incident.id]: event.target.value }))} disabled={busy}><option value="">Choose a linked guardian</option>{guardiansByIncident[incident.id].map((guardian) => <option key={guardian.id} value={guardian.id}>{guardian.name} · {guardian.account_label}</option>)}</select></label><button type="button" className="primary-btn" onClick={() => requestConsent(incident)} disabled={busy || !selectedGuardian[incident.id]}>{busy ? 'Sending…' : 'Request photo consent'}</button></>}
              </>}
              {consent?.status === 'granted' && <>
                <label className="incident-photo-upload">Add a photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { uploadPhoto(incident, event.target.files?.[0]); event.target.value = ''; }} disabled={busy || (incident.photos || []).length >= 3} /></label>
                {(incident.photos || []).map((photo) => <figure className="incident-photo" key={photo.id}><img src={`/api/incidents/${encodeURIComponent(incident.id)}/photos/${encodeURIComponent(photo.id)}`} alt={`Incident photo from ${incident.date}`} loading="lazy" /><figcaption>{formatManilaDateTime(photo.createdAt)} <button type="button" className="table-action" onClick={() => removePhoto(incident, photo)} disabled={busy}>Queue removal</button></figcaption></figure>)}
              </>}
            </div>}
            {!isNurse && consent?.status === 'pending' && <div className="incident-consent-actions"><p role="status">A nurse has requested photo consent. Photos remain unavailable until you decide.</p><button type="button" className="primary-btn" onClick={() => decideConsent(incident, 'granted')} disabled={busy}>Grant consent</button><button type="button" className="secondary-btn" onClick={() => decideConsent(incident, 'declined')} disabled={busy}>Decline</button></div>}
            {!isNurse && consent?.status === 'granted' && <div className="incident-consent-actions"><span className="status-chip positive">Consent granted</span><button type="button" className="secondary-btn" onClick={() => decideConsent(incident, 'revoked')} disabled={busy}>Revoke photo consent</button></div>}
            {!isNurse && consent?.status === 'declined' && <p className="field-hint">You declined this photo request. No photos are available.</p>}
            {!isNurse && (incident.photos || []).length > 0 && <div className="incident-photo-gallery">{incident.photos.map((photo) => <figure key={`view-${photo.id}`}><img src={`/api/incidents/${encodeURIComponent(incident.id)}/photos/${encodeURIComponent(photo.id)}`} alt={`Incident photo from ${incident.date}`} loading="lazy" /><figcaption>{formatManilaDateTime(photo.createdAt)}</figcaption></figure>)}</div>}
          </section>}
        </article>;
      })}
    </section>
  </section>;
}
