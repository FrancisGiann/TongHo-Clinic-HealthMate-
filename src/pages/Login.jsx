import { useId, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, Shield, User, UserCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  activateAccount,
  authenticateUser,
  requestPasswordReset,
  resetPassword,
  validatePasswordStrength,
  verifyMfaCode,
} from '../utils/auth';
import { getSafeReturnPath } from '../utils/navigation';

export default function Login({ onLogin, authError = '' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activationToken = useMemo(() => new URLSearchParams(location.search).get('activate'), [location.search]);
  const returnTo = useMemo(() => getSafeReturnPath(location.state?.from), [location.state]);
  const [mode, setMode] = useState(activationToken ? 'activate' : 'signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activationUsername, setActivationUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const signIn = async (event) => {
    event.preventDefault();
    clearMessages();
    setLoading(true);
    const result = await authenticateUser(identifier, password, remember);
    setLoading(false);
    if (result.mfaRequired) {
      setChallengeId(result.challengeId);
      setSuccess(result.message);
      setMode('mfa');
      return;
    }
    if (!result.success) return setError(result.error);
    onLogin(result.user);
    navigate(returnTo, { replace: true });
  };

  const verifyMfa = async (event) => {
    event.preventDefault();
    clearMessages();
    setLoading(true);
    const result = await verifyMfaCode(challengeId, code);
    setLoading(false);
    if (!result.success) return setError(result.error);
    onLogin(result.user);
    navigate(returnTo, { replace: true });
  };

  const requestReset = async () => {
    clearMessages();
    setLoading(true);
    const result = await requestPasswordReset(identifier);
    setLoading(false);
    if (!result.success) return setError(result.error);
    setSuccess(result.message);
  };

  const confirmReset = async (event) => {
    event.preventDefault();
    clearMessages();
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) return setError(strength.error);
    setLoading(true);
    const result = await resetPassword(identifier, code, newPassword);
    setLoading(false);
    if (!result.success) return setError(result.error);
    setSuccess(result.message);
    setTimeout(() => setMode('signin'), 1200);
  };

  const activate = async (event) => {
    event.preventDefault();
    clearMessages();
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) return setError(strength.error);
    setLoading(true);
    const result = await activateAccount(activationToken, activationUsername, newPassword);
    setLoading(false);
    if (!result.success) return setError(result.error);
    const remainingSearch = new URLSearchParams(location.search);
    remainingSearch.delete('activate');
    const remainingQuery = remainingSearch.toString();
    const search = remainingQuery ? `?${remainingQuery}` : '';
    navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true });
    setSuccess(result.message);
    setMode('signin');
  };

  const back = () => {
    clearMessages();
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setMode('signin');
  };

  return (
    <main className="hm-login-page">
      <header className="hm-login-topbar">
        <Link className="hm-login-brand" to="/" aria-label="HealthMate+ home">
          <img src="/Logo.jpg" alt="" />
          <span>HealthMate+</span>
        </Link>
        <Link className="hm-login-back" to="/"><ArrowLeft size={17} /> Back to home</Link>
      </header>
      <div className="hm-login-layout">
        <section className="hm-login-welcome" aria-labelledby="hm-login-welcome-title">
          <div className="hm-login-welcome-seal"><img src="/Logo.jpg" alt="Philippine Tong Ho Institute seal" /></div>
          <h1 id="hm-login-welcome-title">Welcome to your school clinic portal.</h1>
          <p>Sign in to reach the tools and records available for your account.</p>
          <div className="hm-login-identity">Philippine Tong Ho Institute <span>City of Lucena</span></div>
        </section>
        <section className="hm-login-card" aria-labelledby="hm-login-title">
          <div className="hm-login-card-heading">
            <h2 id="hm-login-title">HealthMate+</h2>
            <p>Sign in securely to continue.</p>
          </div>

        {authError && <div className="hm-login-connection-error" role="alert">{authError}</div>}
        {error && <div className="login-error" role="alert"><AlertTriangle size={18} /><p>{error}</p></div>}
        {success && <div className="login-success" role="status"><UserCheck size={18} /><p>{success}</p></div>}

        {mode === 'signin' && (
          <form onSubmit={signIn} className="login-form">
            <Intro title="Welcome back" text="Use the account provided by your school clinic administrator." />
            <Field icon={User} label="Email / Username" inputId="login-identifier">
              <input id="login-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required autoFocus />
            </Field>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="login-options-row">
              <label className="remember-me"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Keep me signed in on this browser for up to 12 hours</label>
              <button type="button" className="text-link-button" onClick={() => { clearMessages(); setMode('forgot'); }}>Forgot password?</button>
            </div>
            <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Signing in…' : <><Shield size={16} /> Sign in securely</>}</button>
            <p className="login-help">New accounts are issued by the clinic administrator.</p>
          </form>
        )}

        {mode === 'mfa' && (
          <form onSubmit={verifyMfa} className="login-form">
            <Intro title="Verify your identity" text="Enter the six-digit code sent to your registered email." />
            <Field icon={KeyRound} label="Verification code" inputId="mfa-code">
              <input id="mfa-code" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required autoFocus />
            </Field>
            <button type="submit" className="login-btn" disabled={loading || code.length !== 6}>{loading ? 'Verifying…' : 'Verify and continue'}</button>
            <BackButton onClick={back} />
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={confirmReset} className="login-form">
            <Intro title="Reset your password" text="Request a code, then choose a new secure password." />
            <Field icon={Mail} label="Email / Username" inputId="reset-identifier">
              <input id="reset-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
            </Field>
            <button type="button" className="signup-link" onClick={requestReset} disabled={loading}><KeyRound size={16} /> Send reset code</button>
            <Field icon={KeyRound} label="Reset code" inputId="reset-code">
              <input id="reset-code" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />
            </Field>
            <PasswordPair
              password={newPassword}
              confirmPassword={confirmPassword}
              onPasswordChange={setNewPassword}
              onConfirmPasswordChange={setConfirmPassword}
            />
            <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Resetting…' : 'Reset password'}</button>
            <BackButton onClick={back} />
          </form>
        )}

        {mode === 'activate' && (
          <form onSubmit={activate} className="login-form">
            <Intro title="Activate your account" text="Choose your username and a secure password to accept the administrator invitation." />
            <Field icon={User} label="Username" inputId="activation-username">
              <input
                id="activation-username"
                autoComplete="username"
                maxLength={80}
                pattern="[a-z0-9._-]{3,80}"
                placeholder="e.g. clinic.admin"
                value={activationUsername}
                onChange={(event) => {
                  setActivationUsername(normalizeUsername(event.target.value));
                  clearMessages();
                }}
                required
              />
              <p className="field-hint">Spaces become dots. Use letters, numbers, dots, underscores, or dashes.</p>
            </Field>
            <PasswordPair
              password={newPassword}
              confirmPassword={confirmPassword}
              onPasswordChange={(value) => { setNewPassword(value); clearMessages(); }}
              onConfirmPasswordChange={(value) => { setConfirmPassword(value); clearMessages(); }}
              passwordLabel="Password"
            />
            <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Activating…' : 'Activate account'}</button>
          </form>
        )}
        </section>
      </div>
    </main>
  );
}

function Intro({ title, text }) {
  return <div className="login-intro"><h2>{title}</h2><p>{text}</p></div>;
}

function Field({ icon: Icon, label, inputId, children }) {
  return <div className="login-field"><label htmlFor={inputId}><Icon size={16} /> {label}</label>{children}</div>;
}

function PasswordField({ label, value, onChange, autoComplete, visible: controlledVisible, onToggle, showToggle = true }) {
  const inputId = useId();
  const [localVisible, setLocalVisible] = useState(false);
  const visible = controlledVisible ?? localVisible;
  const toggleVisibility = onToggle ?? (() => setLocalVisible((current) => !current));

  return (
    <Field icon={Lock} label={label} inputId={inputId}>
      <div className="password-input">
        <input id={inputId} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required />
        {showToggle && <button type="button" className="password-toggle" onClick={toggleVisibility} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>}
      </div>
    </Field>
  );
}

function PasswordPair({ password, confirmPassword, onPasswordChange, onConfirmPasswordChange, passwordLabel = 'New password' }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-pair">
      <PasswordField label={passwordLabel} value={password} onChange={onPasswordChange} autoComplete="new-password" visible={visible} showToggle={false} />
      <PasswordField label="Confirm password" value={confirmPassword} onChange={onConfirmPasswordChange} autoComplete="new-password" visible={visible} showToggle={false} />
      <button type="button" className="password-pair-toggle" onClick={() => setVisible((current) => !current)} aria-pressed={visible}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        {visible ? 'Hide passwords' : 'Show passwords'}
      </button>
    </div>
  );
}

function normalizeUsername(value) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 80);
}

function BackButton({ onClick }) {
  return <button type="button" className="back-to-signin" onClick={onClick}><ArrowLeft size={16} /> Back to sign in</button>;
}
