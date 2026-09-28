import { useEffect, useRef, useState } from 'react';
import { KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { changePassword, validatePasswordStrength } from '../utils/auth';

const roleLabels = {
  guardian: 'Guardian',
};

export default function PortalAccount({ user, onPasswordChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [sessionEnding, setSessionEnding] = useState(false);
  const redirectTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  const submitPasswordChange = async (event) => {
    event.preventDefault();
    if (busy || sessionEnding) return;
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      setError(strength.error);
      return;
    }

    setBusy(true);
    const result = await changePassword(user?.username, currentPassword, newPassword);
    setBusy(false);
    if (!result.success) {
      setError(result.code === 'UNAUTHENTICATED'
        ? 'Your session has expired. Returning to sign-in.'
        : result.error || 'The password could not be changed. Try again.');
      if (result.code === 'UNAUTHENTICATED') {
        setSessionEnding(true);
        redirectTimer.current = window.setTimeout(onPasswordChanged, 1600);
      }
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSessionEnding(true);
    setMessage(result.message || 'Password changed. Returning to sign-in…');
    redirectTimer.current = window.setTimeout(onPasswordChanged, 1800);
  };

  return (
    <div className="portal-account-page">
      <div className="page-intro">
        <div><p className="section-kicker">Account</p><h2>My account</h2><p>Review your account identity and sign-in options.</p></div>
      </div>
      <section className="panel portal-detail-panel" aria-labelledby="portal-account-identity-heading">
        <div className="panel-heading"><div><p className="section-kicker">Account identity</p><h3 id="portal-account-identity-heading">Your details</h3></div><UserRound size={19} aria-hidden="true" /></div>
        <dl className="portal-detail-grid">
          <Detail label="Full name" value={user?.name} />
          <Detail label="Email" value={user?.email} />
          <Detail label="Username" value={user?.username} />
          <Detail label="Account type" value={roleLabels[user?.role] || 'Portal user'} />
        </dl>
        <p className="portal-account-note">For changes to your name or email, contact the school administrator.</p>
      </section>

      <section className="panel portal-detail-panel" aria-labelledby="portal-password-heading">
        <div className="panel-heading"><div><p className="section-kicker">Sign-in</p><h3 id="portal-password-heading">Change password</h3><p>Use at least 12 characters, including uppercase, lowercase, a number, and a symbol.</p></div><LockKeyhole size={19} aria-hidden="true" /></div>
        <form className="portal-password-form" onSubmit={submitPasswordChange}>
          <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required disabled={busy || sessionEnding} /></label>
          <label>New password<input type="password" name="newPassword" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required disabled={busy || sessionEnding} /></label>
          <label>Confirm new password<input type="password" name="confirmPassword" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required disabled={busy || sessionEnding} /></label>
          {error && <p className="error-banner" role="alert">{error}</p>}
          {message && <p className="success-message" role="status">{message}</p>}
          <button type="submit" className="primary-btn" disabled={busy || sessionEnding || !currentPassword || !newPassword || !confirmPassword}>
            <KeyRound size={16} aria-hidden="true" />
            {busy ? 'Updating password…' : sessionEnding ? 'Returning to sign-in…' : 'Update password'}
          </button>
        </form>
      </section>

    </div>
  );
}

function Detail({ label, value }) {
  return <div className="portal-detail-field"><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>;
}
