import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, Shield, User, UserCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  activateAccount,
  authenticateUser,
  requestPasswordReset,
  requestGuardianSignup,
  resetPassword,
  validatePasswordStrength,
  verifyMfaCode,
  verifyGuardianSignup,
} from '../utils/auth';
import { getSafeReturnPath } from '../utils/navigation';
import { useBranding } from '../hooks/useBranding.js';

export default function Login({ onLogin, authError = '' }) {
  const branding = useBranding();
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
  const [guardianSignup, setGuardianSignup] = useState({ name: '', email: '', username: '', password: '', confirmPassword: '', studentId: '', relationship: 'Parent' });
  const [guardianSignupChallengeId, setGuardianSignupChallengeId] = useState('');
  const [guardianSignupResendSeconds, setGuardianSignupResendSeconds] = useState(0);
  const [guardianSignupStep, setGuardianSignupStep] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const guardianSignupFormRef = useRef(null);
  const guardianSignupHeadingRef = useRef(null);
  const signupErrorRef = useRef(null);
  const guardianSignupCurrentStep = mode === 'guardian-signup-verify' ? 4 : guardianSignupStep;
  const isGuardianSignup = mode === 'guardian-signup' || mode === 'guardian-signup-verify';

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

  useEffect(() => {
    if (guardianSignupResendSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => setGuardianSignupResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [guardianSignupResendSeconds]);

  useEffect(() => {
    if (!isGuardianSignup) return;
    guardianSignupFormRef.current?.scrollIntoView({ block: 'start' });
    guardianSignupHeadingRef.current?.focus({ preventScroll: true });
  }, [guardianSignupCurrentStep, isGuardianSignup]);

  const reportSignupError = (message, fieldId = '') => {
    setError(message);
    window.requestAnimationFrame(() => {
      const target = (fieldId ? guardianSignupFormRef.current?.querySelector(`#${fieldId}`) : null) || signupErrorRef.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center' });
    });
  };

  const startGuardianSignup = () => {
    clearMessages();
    setGuardianSignup({ name: '', email: '', username: '', password: '', confirmPassword: '', studentId: '', relationship: 'Parent' });
    setGuardianSignupChallengeId('');
    setCode('');
    setGuardianSignupStep(1);
    setMode('guardian-signup');
  };

  const exitGuardianSignup = () => {
    clearMessages();
    setGuardianSignup({ name: '', email: '', username: '', password: '', confirmPassword: '', studentId: '', relationship: 'Parent' });
    setGuardianSignupChallengeId('');
    setCode('');
    setGuardianSignupStep(1);
    setMode('signin');
  };

  const moveGuardianSignupBack = () => {
    clearMessages();
    setGuardianSignupStep((step) => Math.max(1, step - 1));
  };

  const editGuardianSignupDetails = () => {
    clearMessages();
    setGuardianSignupChallengeId('');
    setCode('');
    setGuardianSignupStep(1);
    setMode('guardian-signup');
  };

  const sendGuardianSignupCode = async () => {
    clearMessages();
    if (guardianSignup.password !== guardianSignup.confirmPassword) return reportSignupError('Passwords do not match.', 'guardian-confirm-password');
    const strength = validatePasswordStrength(guardianSignup.password);
    if (!strength.valid) return reportSignupError(strength.error, 'guardian-password');
    setLoading(true);
    const result = await requestGuardianSignup({
      ...guardianSignup,
      name: guardianSignup.name.trim(),
      email: guardianSignup.email.trim(),
      username: normalizeUsername(guardianSignup.username),
      studentId: guardianSignup.studentId.trim(),
    });
    setLoading(false);
    if (!result.success) {
      reportSignupError(result.error);
      if (/wait before requesting another verification code/i.test(result.error || '')) setGuardianSignupResendSeconds(60);
      return;
    }
    setGuardianSignupChallengeId(result.challengeId);
    setSuccess(result.message || 'A verification code was sent if this email can register.');
    setCode('');
    setGuardianSignupResendSeconds(60);
    setGuardianSignupStep(4);
    setMode('guardian-signup-verify');
  };

  const submitGuardianSignupStep = async (event) => {
    event.preventDefault();
    clearMessages();
    if (guardianSignupStep === 1) {
      if (!guardianSignup.name.trim()) return reportSignupError('Enter your full name.', 'guardian-name');
      setGuardianSignup((current) => ({ ...current, name: current.name.trim(), email: current.email.trim() }));
      setGuardianSignupStep(2);
      return;
    }
    if (guardianSignupStep === 2) {
      if (guardianSignup.password !== guardianSignup.confirmPassword) return reportSignupError('Passwords do not match.', 'guardian-confirm-password');
      const strength = validatePasswordStrength(guardianSignup.password);
      if (!strength.valid) return reportSignupError(strength.error, 'guardian-password');
      const username = normalizeUsername(guardianSignup.username);
      if (!username) return reportSignupError('Enter a username using letters, numbers, dots, underscores, or dashes.', 'guardian-username');
      setGuardianSignup((current) => ({ ...current, username }));
      setGuardianSignupStep(3);
      return;
    }
    if (!guardianSignup.studentId.trim()) return reportSignupError('Enter the student ID provided by the school.', 'guardian-student-id');
    setGuardianSignup((current) => ({ ...current, studentId: current.studentId.trim() }));
    await sendGuardianSignupCode();
  };

  const verifyGuardianSignupCode = async (event) => {
    event.preventDefault();
    clearMessages();
    setLoading(true);
    const result = await verifyGuardianSignup(guardianSignupChallengeId, code);
    setLoading(false);
    if (!result.success) return reportSignupError(result.error);
    setIdentifier(guardianSignup.email.trim());
    setPassword('');
    setGuardianSignup({ name: '', email: '', username: '', password: '', confirmPassword: '', studentId: '', relationship: 'Parent' });
    setCode('');
    setGuardianSignupChallengeId('');
    setGuardianSignupStep(1);
    setSuccess(result.message || 'Your email is verified. Your guardian account request is awaiting administrator review. You can sign in after approval.');
    setMode('signin');
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
          <img src={branding.applicationLogo} alt="" onError={(event) => { event.currentTarget.src = '/healthmate-mark.svg'; }} />
          <span>HealthMate+</span>
        </Link>
        <Link className="hm-login-back" to="/"><ArrowLeft size={17} /> Back to home</Link>
      </header>
      <div className={`hm-login-layout${isGuardianSignup ? ' is-guardian-signup' : ''}`}>
        <section className="hm-login-welcome" aria-labelledby="hm-login-welcome-title">
          <div className="hm-login-welcome-seal"><img src={branding.schoolSeal} alt="Philippine Tong Ho Institute seal" onError={(event) => { event.currentTarget.src = '/Logo.jpg'; }} /></div>
          <h1 id="hm-login-welcome-title">Welcome to your school clinic portal.</h1>
          <p>Sign in to reach the tools and records available for your account.</p>
          <div className="hm-login-identity">Philippine Tong Ho Institute <span>City of Lucena</span></div>
        </section>
        <section className={`hm-login-card${isGuardianSignup ? ' is-guardian-signup' : ''}`} aria-labelledby="hm-login-title">
          <div className="hm-login-card-heading">
            <h2 id="hm-login-title">HealthMate+</h2>
            <p>{isGuardianSignup ? 'Request a parent or guardian account.' : 'Sign in securely to continue.'}</p>
          </div>

        {authError && <div className="hm-login-connection-error" role="alert">{authError}</div>}
        {error && <div className="login-error" role="alert" tabIndex={-1} ref={signupErrorRef}><AlertTriangle size={18} /><p>{error}</p></div>}
        {success && <div className="login-success" role="status"><UserCheck size={18} /><p>{success}</p></div>}

        {mode === 'signin' && (
          <form onSubmit={signIn} className="login-form">
            <Intro title="Welcome back" text="Use your registered email or username." />
            <Field icon={User} label="Email / Username" inputId="login-identifier">
              <input id="login-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required autoFocus />
            </Field>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="login-options-row">
              <label className="remember-me"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Keep me signed in on this browser for up to 12 hours</label>
              <button type="button" className="text-link-button" onClick={() => { clearMessages(); setMode('forgot'); }}>Forgot password?</button>
            </div>
            <button type="submit" className="login-btn" disabled={loading}>{loading ? 'Signing in…' : <><Shield size={16} /> Sign in securely</>}</button>
            <p className="login-help">Staff accounts are issued by the clinic administrator.</p>
            <button type="button" className="signup-link" onClick={startGuardianSignup} disabled={loading}>Create a parent or guardian account</button>
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

        {isGuardianSignup && (
          <form
            ref={guardianSignupFormRef}
            onSubmit={mode === 'guardian-signup-verify' ? verifyGuardianSignupCode : submitGuardianSignupStep}
            className="login-form guardian-signup-form"
          >
            <SignupProgress step={guardianSignupCurrentStep} />
            {mode === 'guardian-signup' && guardianSignupStep === 1 && (
              <>
                <Intro headingRef={guardianSignupHeadingRef} title="Your details" text="Start with the name and email address you want to use for your guardian account." />
                <Field icon={User} label="Full name" inputId="guardian-name"><input id="guardian-name" maxLength={160} autoComplete="name" value={guardianSignup.name} onChange={(event) => setGuardianSignup((current) => ({ ...current, name: event.target.value }))} required /></Field>
                <Field icon={Mail} label="Email" inputId="guardian-email"><input id="guardian-email" type="email" maxLength={254} autoComplete="email" value={guardianSignup.email} onChange={(event) => setGuardianSignup((current) => ({ ...current, email: event.target.value }))} required /></Field>
                <div className="signup-step-actions">
                  <button type="button" className="back-to-signin" onClick={exitGuardianSignup} disabled={loading}><ArrowLeft size={16} /> Back to sign in</button>
                  <button type="submit" className="login-btn" disabled={loading}>Continue</button>
                </div>
              </>
            )}
            {mode === 'guardian-signup' && guardianSignupStep === 2 && (
              <>
                <Intro headingRef={guardianSignupHeadingRef} title="Account security" text="Choose a username and secure password for your account." />
                <Field icon={User} label="Username" inputId="guardian-username"><input id="guardian-username" autoComplete="username" minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]{3,80}" value={guardianSignup.username} onChange={(event) => setGuardianSignup((current) => ({ ...current, username: normalizeUsername(event.target.value) }))} required /><p className="field-hint">Use letters, numbers, dots, underscores, or dashes.</p></Field>
                <PasswordPair
                  password={guardianSignup.password}
                  confirmPassword={guardianSignup.confirmPassword}
                  onPasswordChange={(password) => setGuardianSignup((current) => ({ ...current, password }))}
                  onConfirmPasswordChange={(confirmPassword) => setGuardianSignup((current) => ({ ...current, confirmPassword }))}
                  passwordLabel="Password"
                  passwordId="guardian-password"
                  confirmPasswordId="guardian-confirm-password"
                />
                <div className="signup-step-actions">
                  <button type="button" className="back-to-signin" onClick={moveGuardianSignupBack} disabled={loading}><ArrowLeft size={16} /> Back</button>
                  <button type="submit" className="login-btn" disabled={loading}>Continue</button>
                </div>
                <button type="button" className="signup-link" onClick={exitGuardianSignup} disabled={loading}>Back to sign in</button>
              </>
            )}
            {mode === 'guardian-signup' && guardianSignupStep === 3 && (
              <>
                <Intro headingRef={guardianSignupHeadingRef} title="Student link" text="Enter one student ID provided by the school and your relationship to that student." />
                <Field icon={KeyRound} label="Student ID" inputId="guardian-student-id"><input id="guardian-student-id" maxLength={80} value={guardianSignup.studentId} onChange={(event) => setGuardianSignup((current) => ({ ...current, studentId: event.target.value }))} required /></Field>
                <Field icon={UserCheck} label="Relationship to student" inputId="guardian-relationship"><select id="guardian-relationship" value={guardianSignup.relationship} onChange={(event) => setGuardianSignup((current) => ({ ...current, relationship: event.target.value }))} required><option>Parent</option><option>Mother</option><option>Father</option><option>Guardian</option><option>Grandparent</option><option>Other relative</option></select></Field>
                <p className="field-hint">After email verification, an administrator checks the relationship against school records before approving your account. No account or student link is active before approval.</p>
                {guardianSignupResendSeconds > 0 && <p className="field-hint" role="status">Wait for the current verification-code cooldown before requesting a new code.</p>}
                <div className="signup-step-actions">
                  <button type="button" className="back-to-signin" onClick={moveGuardianSignupBack} disabled={loading}><ArrowLeft size={16} /> Back</button>
                  <button type="submit" className="login-btn" disabled={loading || guardianSignupResendSeconds > 0}>{loading ? 'Sending code…' : guardianSignupResendSeconds > 0 ? `Wait ${guardianSignupResendSeconds}s` : 'Send code'}</button>
                </div>
                <button type="button" className="signup-link" onClick={exitGuardianSignup} disabled={loading}>Back to sign in</button>
              </>
            )}
            {mode === 'guardian-signup-verify' && (
              <>
                <Intro headingRef={guardianSignupHeadingRef} title="Verify email" text={`Enter the six-digit code sent to ${guardianSignup.email}.`} />
                <Field icon={KeyRound} label="Verification code" inputId="guardian-signup-code"><input id="guardian-signup-code" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required /></Field>
                <button type="submit" className="login-btn" disabled={loading || code.length !== 6}>{loading ? 'Verifying…' : 'Verify email and submit request'}</button>
                <button type="button" className="signup-link" onClick={sendGuardianSignupCode} disabled={loading || guardianSignupResendSeconds > 0}>{loading ? 'Sending code…' : guardianSignupResendSeconds > 0 ? `Resend code in ${guardianSignupResendSeconds}s` : 'Resend code'}</button>
                {guardianSignupResendSeconds > 0 && <p className="field-hint" role="status">You can request another code when the timer ends. If you already have an account, sign in or use your school invitation.</p>}
                <button type="button" className="signup-link" onClick={editGuardianSignupDetails} disabled={loading}>Edit signup details</button>
                <button type="button" className="signup-link" onClick={exitGuardianSignup} disabled={loading}>Back to sign in</button>
              </>
            )}
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

function Intro({ title, text, headingRef }) {
  return <div className="login-intro"><h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h2><p>{text}</p></div>;
}

function SignupProgress({ step }) {
  const labels = ['Your details', 'Account security', 'Student link', 'Verify email'];
  return (
    <div className="guardian-signup-progress-wrap">
      <p className="guardian-signup-step-count">Step {step} of 4</p>
      <ol className="guardian-signup-progress" aria-label="Registration steps">
        {labels.map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? 'step' : undefined}>{label}</li>
        ))}
      </ol>
    </div>
  );
}

function Field({ icon: Icon, label, inputId, children }) {
  return <div className="login-field"><label htmlFor={inputId}><Icon size={16} /> {label}</label>{children}</div>;
}

function PasswordField({ label, value, onChange, autoComplete, visible: controlledVisible, onToggle, showToggle = true, id: suppliedId }) {
  const generatedId = useId();
  const inputId = suppliedId || generatedId;
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

function PasswordPair({ password, confirmPassword, onPasswordChange, onConfirmPasswordChange, passwordLabel = 'New password', passwordId, confirmPasswordId }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-pair">
      <PasswordField label={passwordLabel} value={password} onChange={onPasswordChange} autoComplete="new-password" visible={visible} showToggle={false} id={passwordId} />
      <PasswordField label="Confirm password" value={confirmPassword} onChange={onConfirmPasswordChange} autoComplete="new-password" visible={visible} showToggle={false} id={confirmPasswordId} />
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
