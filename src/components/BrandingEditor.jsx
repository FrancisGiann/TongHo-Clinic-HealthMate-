import { useEffect, useRef, useState } from 'react';
import { api, apiRequest } from '../utils/api';

const SLOT_GROUPS = [
  {
    id: 'school-identity',
    title: 'School identity',
    description: 'These marks identify HealthMate+ and Philippine Tong Ho Institute across the landing page, sign-in, and clinic workspace.',
    slots: ['applicationLogo', 'schoolSeal'],
  },
  {
    id: 'landing-page-photos',
    title: 'Landing page photo',
    description: 'The public hero uses the school seal. This optional community image appears with the school-community section; without one, the page shows its bundled illustration.',
    slots: ['landingCommunityPhoto'],
  },
];

const SLOT_CONFIG = {
  applicationLogo: {
    label: 'HealthMate+ logo',
    note: 'Used in the landing-page header, sign-in header, and clinic workspace.',
    fallbackImage: '/healthmate-mark.svg',
    fallbackLabel: 'bundled HealthMate+ logo',
    inputLabel: 'Choose image',
  },
  schoolSeal: {
    label: 'School seal',
    note: 'Displayed prominently in the landing-page hero and on sign-in.',
    fallbackImage: '/Logo.jpg',
    fallbackLabel: 'bundled school seal',
    inputLabel: 'Choose image',
  },
  landingCommunityPhoto: {
    label: 'Community photo',
    note: 'Shown with the school-community section on the landing page.',
    fallbackImage: '/illustrations/guardian-care.webp',
    fallbackLabel: 'family and student illustration fallback',
    inputLabel: 'Choose photo',
    pagePhoto: true,
  },
};

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function fallbackPreviewOnce(event, fallback) {
  const image = event.currentTarget;
  if (image.dataset.fallbackAttempted) {
    image.hidden = true;
    return;
  }
  image.dataset.fallbackAttempted = 'true';
  if (image.getAttribute('src') === fallback) image.hidden = true;
  else image.src = fallback;
}

export default function BrandingEditor() {
  const [branding, setBranding] = useState({ version: 1, applicationLogo: null, schoolSeal: null, landingCommunityPhoto: null, storageConfigured: false });
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const load = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await api.get('/api/admin/branding');
      setBranding(result);
      setDrafts((current) => {
        Object.values(current).forEach((draft) => draft.previewUrl && URL.revokeObjectURL(draft.previewUrl));
        return {};
      });
    } catch (requestError) {
      setError(requestError.message || 'Image settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [attempt]);
  useEffect(() => () => Object.values(draftsRef.current).forEach((draft) => draft.previewUrl && URL.revokeObjectURL(draft.previewUrl)), []);

  const chooseFile = async (slot, file) => {
    if (!file) return;
    setMessage('');
    setError('');
    if (!ALLOWED_TYPES.has(file.type) || file.size < 1 || file.size > 1024 * 1024) {
      setError('Choose a PNG, JPEG, or WebP image no larger than 1 MiB. SVG uploads are not supported.');
      return;
    }
    try {
      const dataBase64 = await readAsBase64(file);
      setDrafts((current) => {
        if (current[slot]?.previewUrl) URL.revokeObjectURL(current[slot].previewUrl);
        return { ...current, [slot]: { dataBase64, contentType: file.type, previewUrl: URL.createObjectURL(file), name: file.name } };
      });
    } catch (readError) {
      setError(readError.message);
    }
  };

  const cancel = (slot) => setDrafts((current) => {
    if (current[slot]?.previewUrl) URL.revokeObjectURL(current[slot].previewUrl);
    const next = { ...current };
    delete next[slot];
    return next;
  });

  const save = async (slot) => {
    const draft = drafts[slot];
    if (!draft || busySlot) return;
    setBusySlot(slot);
    setError('');
    setMessage('');
    try {
      const saved = await api.put(`/api/admin/branding/${slot}`, { version: branding.version, contentType: draft.contentType, dataBase64: draft.dataBase64 });
      setBranding((current) => ({ ...current, version: saved.version, [slot]: { assetId: saved.assetId, url: saved.url } }));
      cancel(slot);
      setMessage(`${SLOT_CONFIG[slot].label} saved.`);
      window.dispatchEvent(new Event('healthmate-branding-updated'));
    } catch (requestError) {
      setError(requestError.message || 'The image could not be saved.');
      if (requestError.status === 409) await load();
    } finally {
      setBusySlot('');
    }
  };

  const reset = async (slot) => {
    if (busySlot) return;
    setBusySlot(slot);
    setError('');
    setMessage('');
    try {
      const saved = await apiRequest(`/api/admin/branding/${slot}`, { method: 'DELETE', body: JSON.stringify({ version: branding.version }) });
      setBranding((current) => ({ ...current, version: saved.version, [slot]: null }));
      cancel(slot);
      setMessage(`${SLOT_CONFIG[slot].label} reset to the ${SLOT_CONFIG[slot].fallbackLabel}.`);
      window.dispatchEvent(new Event('healthmate-branding-updated'));
    } catch (requestError) {
      setError(requestError.message || 'The image could not be reset.');
      if (requestError.status === 409) await load();
    } finally {
      setBusySlot('');
    }
  };

  return (
    <section className="branding-editor" aria-labelledby="branding-editor-title">
      <div className="settings-panel-heading branding-editor-heading">
        <div><h3 id="branding-editor-title">School and landing page images</h3><p>Manage the school identity and the images shown to visitors.</p></div>
        <button type="button" className="secondary-btn" onClick={() => setAttempt((value) => value + 1)} disabled={loading || Boolean(busySlot)}>Refresh</button>
      </div>
      {!branding.storageConfigured && <p className="disabled-note" role="status">Private image storage is not configured. Bundled identity images and landing-page illustrations remain available; custom uploads are disabled.</p>}
      {error && <div className="error-banner" role="alert">{error} <button type="button" className="secondary-btn" onClick={() => setAttempt((value) => value + 1)} disabled={loading}>Retry</button></div>}
      {message && <p className="success-message" role="status">{message}</p>}
      {loading && <p className="field-hint" role="status">Loading image settings…</p>}
      {!loading && !error && <div className="branding-groups">{SLOT_GROUPS.map((group) => (
        <section className="settings-subsection branding-group" key={group.id} aria-labelledby={`${group.id}-title`}>
          <header className="branding-group-heading"><div><h4 id={`${group.id}-title`}>{group.title}</h4><p>{group.description}</p></div></header>
          <div className="branding-slot-list">{group.slots.map((id) => {
            const slot = SLOT_CONFIG[id];
            const draft = drafts[id];
            const savedAsset = branding[id];
            const previewSource = draft?.previewUrl || savedAsset?.url || slot.fallbackImage;
            const hasPhoto = slot.pagePhoto && Boolean(savedAsset);
            return <article className={`branding-slot${slot.pagePhoto ? ' is-page-photo' : ''}`} key={id}>
              <div className="branding-slot-preview">
                <strong>{slot.label}</strong>
                <p>{slot.note}</p>
                <img key={previewSource} className={`branding-preview${slot.pagePhoto ? ' branding-preview-page-photo' : ''}`} src={previewSource} alt={`${slot.label} preview`} onError={(event) => fallbackPreviewOnce(event, slot.fallbackImage)} />
                {slot.pagePhoto && <span className="branding-preview-caption">{draft ? 'Unsaved preview' : hasPhoto ? 'Shown on the public landing page' : `Site fallback: ${slot.fallbackLabel}`}</span>}
              </div>
              <div className="branding-slot-actions">
                <label className="secondary-btn">{slot.inputLabel}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { chooseFile(id, event.target.files?.[0]); event.target.value = ''; }} disabled={!branding.storageConfigured || Boolean(busySlot)} /></label>
                {draft && <><span className="field-hint branding-draft-name">{draft.name}</span><button type="button" className="primary-btn" onClick={() => save(id)} disabled={Boolean(busySlot)}>{busySlot === id ? 'Saving…' : 'Save image'}</button><button type="button" className="table-action" onClick={() => cancel(id)} disabled={Boolean(busySlot)}>Cancel</button></>}
                {!draft && savedAsset && <button type="button" className="secondary-btn" onClick={() => reset(id)} disabled={Boolean(busySlot)}>{busySlot === id ? 'Resetting…' : 'Reset to default'}</button>}
              </div>
            </article>;
          })}</div>
        </section>
      ))}</div>}
    </section>
  );
}
