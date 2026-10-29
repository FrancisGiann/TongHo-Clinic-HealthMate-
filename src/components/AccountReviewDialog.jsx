import { useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import { resendInvitation, updateUserStatus } from '../utils/auth';

export default function AccountReviewDialog({ account, onClose, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const lock = useRef(false);
  const run = async (action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await (action === 'resend' ? resendInvitation(account.id) : updateUserStatus(account.id, 'deactivated'));
      if (!result.success) throw new Error(result.error);
      if (action === 'resend' && result.emailSent === false) throw new Error(result.message || 'The invitation email could not be sent. Try again.');
      setConfirmCancel(false);
      setMessage(action === 'resend' ? `Invitation resent to ${account.email}.` : 'Invitation canceled.');
      onUpdated?.();
    } catch (failure) { setError(failure.message || 'The invitation could not be updated.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <ModalDialog open title={`Review invitation · ${account.name}`} eyebrow="Account access" onClose={onClose} busy={busy} historyKey="invitation-review" className="admin-context-dialog">
    <dl className="context-record-summary"><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Role</dt><dd>{({ school_nurse: 'School nurse', system_administrator: 'Administrator', guardian: 'Guardian' })[account.role] || account.role}</dd></div><div><dt>Status</dt><dd>{account.status}</dd></div></dl>
    <p className="field-hint">An invited account must complete its invitation before signing in.</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {message && <p className="success-message" role="status">{message}</p>}
    {account.status === 'invited' && !message.startsWith('Invitation canceled') && <>
      {confirmCancel && <div className="context-confirmation"><p>Cancel the invitation for <strong>{account.name}</strong>? They will no longer be able to accept it.</p><div className="form-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep invitation</button><button type="button" className="primary-btn" disabled={busy} onClick={() => run('cancel')}>Confirm cancellation</button></div></div>}
      {!confirmCancel && <div className="form-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel invitation</button><button type="button" className="primary-btn" disabled={busy} onClick={() => run('resend')}>{busy ? 'Sending…' : 'Resend invitation'}</button></div>}
    </>}
    <div className="form-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>Done</button></div>
  </ModalDialog>;
}
