import { useState, useEffect, useRef } from 'react';
import { Lock, User, Eye, EyeOff, Shield, AlertTriangle, Mail, UserCheck, ArrowLeft, KeyRound, Phone } from 'lucide-react';
import {
  authenticateUser,
  createMfaChallenge,
  createNurseAccount,
  createSession,
  logSecurityEvent,
  getRemainingLockoutTime,
  requestPasswordReset,
  requestSignupOtp,
  resetPassword,
  verifyMfaCode,
  verifySignupOtp
} from '../utils/auth';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('signin'); // 'signin' or 'signup' or 'forgot'
  
  // Sign in state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  
  // Sign up state
  const [signupSchoolId, setSignupSchoolId] = useState('');
  const [signupPrcLicenseNumber, setSignupPrcLicenseNumber] = useState('');
  const [signupContactNumber, setSignupContactNumber] = useState('');
  const [signupSchoolName, setSignupSchoolName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupFullName, setSignupFullName] = useState('');
  const [signupOtp, setSignupOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpMethod, setOtpMethod] = useState('email');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const signupOtpRefs = useRef([]);

  // Password reset state
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaUsername, setMfaUsername] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [pendingMfaUser, setPendingMfaUser] = useState(null);
  
  // Common state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [success, setSuccess] = useState('');

  // Check for existing lockout on mount
  useEffect(() => {
    const storedUsername = localStorage.getItem('last-login-username');
    if (storedUsername) {
      setUsername(storedUsername);
      const lockoutTime = getRemainingLockoutTime(storedUsername);
      if (lockoutTime > 0) {
        setIsLocked(true);
        setError(`Account locked. Try again in ${lockoutTime} minutes.`);
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setAttemptsRemaining(null);
    setLoading(true);

    try {
      // Remember username for lockout checking
      localStorage.setItem('last-login-username', username);

      // Authenticate user with new secure system
      const result = await authenticateUser(username, password);

      if (result.success) {
        if (result.user.mfaEnabled) {
          const challenge = createMfaChallenge(result.user);
          setPendingMfaUser(result.user);
          setMfaRequired(true);
          setMfaUsername(result.user.username);
          setMode('mfa');
          setSuccess(challenge.message);
          setLoading(false);
          return;
        }

        // Log successful login
        logSecurityEvent('LOGIN_SUCCESS', { username: result.user.username });

        // Create session
        const session = createSession(result.user);
        
        // Call parent handler
        onLogin(session, rememberMe);
      } else {
        // Log failed login attempt
        logSecurityEvent('LOGIN_FAILED', { username, reason: result.error });

        setError(result.error);
        
        if (result.locked) {
          setIsLocked(true);
        } else if (result.attemptsRemaining !== undefined) {
          setAttemptsRemaining(result.attemptsRemaining);
        }
        
        setLoading(false);
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
      
      logSecurityEvent('LOGIN_ERROR', { username, error: err.message });
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const verification = verifyMfaCode(mfaUsername, mfaCode);

      if (!verification.success) {
        setError(verification.error);
        setLoading(false);
        return;
      }

      if (!pendingMfaUser) {
        setError('MFA verification session expired. Please sign in again.');
        setLoading(false);
        return;
      }

      logSecurityEvent('LOGIN_SUCCESS', { username: pendingMfaUser.username });
      const session = createSession(pendingMfaUser);
      onLogin(session, rememberMe);
    } catch (err) {
      console.error('MFA error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    setError('');
    setSuccess('');

    const otpDestination = signupEmail;
    const result = await requestSignupOtp(otpDestination, otpMethod);
    if (!result.success) {
      setError(result.error);
      return;
    }

    setOtpSent(true);
    setSignupOtp('');
    setSuccess(result.message);
    logSecurityEvent('OTP_SENT', { email: signupEmail });
  };

  const handleSignupOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const nextOtp = signupOtp.split('');
    nextOtp[index] = digit;
    const updatedOtp = nextOtp.join('').slice(0, 6);
    setSignupOtp(updatedOtp);

    if (digit && index < 5) {
      signupOtpRefs.current[index + 1]?.focus();
    }
  };

  const handleSignupOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !signupOtp[index] && index > 0) {
      signupOtpRefs.current[index - 1]?.focus();
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const otpDestination = signupEmail;
      const verification = !otpSent
        ? { success: false, error: 'Please request a verification code first.' }
        : await verifySignupOtp(otpDestination, signupOtp);
      if (!verification.success) {
        setError(verification.error);
        setLoading(false);
        return;
      }

      if (signupPassword !== signupConfirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      const result = await createNurseAccount({
        fullName: signupFullName,
        schoolId: signupSchoolId,
        prcLicenseNumber: signupPrcLicenseNumber,
        email: signupEmail,
        contactNumber: signupContactNumber,
        schoolName: signupSchoolName,
        username: signupUsername,
        password: signupPassword
      });

      if (result.success) {
        setSuccess(result.message);
        
        setSignupUsername('');
        setSignupPassword('');
        setSignupConfirmPassword('');
        setSignupEmail('');
        setSignupFullName('');
        setSignupSchoolId('');
        setSignupPrcLicenseNumber('');
        setSignupContactNumber('');
        setSignupSchoolName('');
        setSignupOtp('');
        setOtpSent(false);
        setOtpMethod('email');
        
        setTimeout(() => {
          setMode('signin');
          setUsername(result.user.username);
          setSuccess('');
        }, 2000);
      } else {
        setError(result.error);
        setLoading(false);
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
      
      logSecurityEvent('SIGNUP_ERROR', { username: signupUsername, error: err.message });
    }
  };

  const handleResetRequest = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const result = await requestPasswordReset(resetIdentifier);
      setSuccess(result.message);
      setLoading(false);
    } catch (err) {
      console.error('Password reset request error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (newResetPassword !== resetConfirmPassword) {
        setError('Passwords do not match');
        setLoading(false);
        return;
      }

      const result = await resetPassword(resetIdentifier, resetToken, newResetPassword);
      if (!result.success) {
        setError(result.error);
        setLoading(false);
        return;
      }

      setSuccess(result.message);
      setResetIdentifier('');
      setResetToken('');
      setNewResetPassword('');
      setResetConfirmPassword('');
      setTimeout(() => {
        setMode('signin');
        setSuccess('');
      }, 2200);
      setLoading(false);
    } catch (err) {
      console.error('Password reset error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const resetForm = () => {
    setError('');
    setSuccess('');
    setAttemptsRemaining(null);
    setIsLocked(false);
    setMfaRequired(false);
    setMfaUsername('');
    setMfaCode('');
    setPendingMfaUser(null);
    setResetIdentifier('');
    setResetToken('');
    setNewResetPassword('');
    setResetConfirmPassword('');
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="orbit-ring" />
        <div className="hero-cross">✚</div>
        <span className="orbit-dot one" />
        <span className="orbit-dot two" />
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="brand-mark">
            <img src="/Logo.jpg" alt="Tong Ho Academy seal" />
          </div>
          <div className="login-branding">
            <h1>HealthMate+</h1>
          </div>
          <p className="login-subtitle">Secure client access portal</p>
        </div>

        {mode === 'forgot' ? (
          <form onSubmit={handlePasswordReset} className="login-form">
            <div className="login-intro">
              <h2>Reset your password</h2>
              <p>Use your email or username, then enter the reset token and choose a new secure password.</p>
            </div>

            {error && (
              <div className="login-error">
                <AlertTriangle size={18} />
                <div>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {success && (
              <div className="login-success">
                <UserCheck size={18} />
                <div>
                  <p>{success}</p>
                </div>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="reset-identifier">
                <Mail size={16} />
                Email / Username
              </label>
              <input
                id="reset-identifier"
                type="text"
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                placeholder="Enter your email or username"
                required
              />
            </div>

            <button type="button" className="signup-link" onClick={handleResetRequest} disabled={loading}>
              <KeyRound size={16} /> Generate reset token
            </button>

            <div className="login-field">
              <label htmlFor="reset-token">
                <KeyRound size={16} />
                Reset Token
              </label>
              <input
                id="reset-token"
                type="text"
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="Enter the reset token"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="reset-password">
                <Lock size={16} />
                New Password
              </label>
              <div className="password-input">
                <input
                  id="reset-password"
                  type={showResetPassword ? 'text' : 'password'}
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  placeholder="Use a strong password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                >
                  {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="reset-confirm-password">
                <Lock size={16} />
                Confirm New Password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                required
              />
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Resetting password...
                </>
              ) : (
                <>
                  <KeyRound size={16} /> Reset password
                </>
              )}
            </button>

            <button
              type="button"
              className="back-to-signin"
              onClick={() => {
                resetForm();
                setMode('signin');
              }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </button>
          </form>
        ) : mode === 'signin' ? (
          // SIGN IN FORM
          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-intro">
              <h2>Welcome back</h2>
              <p>Sign in to access your secure client portal.</p>
            </div>

            {error && (
              <div className={`login-error ${isLocked ? 'login-locked' : ''}`}>
                {isLocked ? <Shield size={18} /> : <AlertTriangle size={18} />}
                <div>
                  <p>{error}</p>
                  {attemptsRemaining !== null && attemptsRemaining > 0 && (
                    <small>{attemptsRemaining} {attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining before lockout</small>
                  )}
                </div>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="username">
                <User size={16} />
                Email / Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your email or username"
                required
                autoComplete="username"
                autoFocus
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">
                <Lock size={16} />
                Password
              </label>
              <div className="password-input">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-options-row">
              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me
              </label>

              <button type="button" className="text-link-button" onClick={() => {
                resetForm();
                setMode('forgot');
              }}>
                Forgot Password?
              </button>
            </div>

            <button type="submit" className="login-btn" disabled={loading || isLocked}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Signing in...
                </>
              ) : isLocked ? (
                <>
                  <Shield size={16} /> Account Locked
                </>
              ) : (
                <>
                  <Lock size={16} /> Sign in securely
                </>
              )}
            </button>

            <div className="login-help">
              <p>Need access? Contact your account administrator for your client credentials.</p>
            </div>

            <div className="login-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="signup-link"
              onClick={() => {
                resetForm();
                setMode('signup');
              }}
            >
              <UserCheck size={16} /> Request client access
            </button>

            <div className="login-security-info">
              <Shield size={14} />
              <span>Secure authentication with rate limiting and session management</span>
            </div>
          </form>
        ) : mode === 'mfa' ? (
          <form onSubmit={handleMfaSubmit} className="login-form">
            <div className="login-intro">
              <h2>Verify your identity</h2>
              <p>Complete the MFA challenge to continue securely.</p>
            </div>

            {error && (
              <div className="login-error">
                <AlertTriangle size={18} />
                <div>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {success && (
              <div className="login-success">
                <UserCheck size={18} />
                <div>
                  <p>{success}</p>
                </div>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="mfa-code">
                <Shield size={16} />
                MFA Code
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter the 6-digit MFA code"
                required
                autoFocus
              />
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Verifying...
                </>
              ) : (
                <>
                  <Shield size={16} /> Verify MFA
                </>
              )}
            </button>

            <button
              type="button"
              className="back-to-signin"
              onClick={() => {
                resetForm();
                setMode('signin');
              }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </button>
          </form>
        ) : (
          // SIGN UP FORM
          <form onSubmit={handleSignup} className="login-form">
            <div className="login-intro">
              <h2>Register School Nurse Account</h2>
              <p>Complete the required nurse profile details below. Your account will be created as Pending Verification until the school administrator reviews your credentials.</p>
            </div>

            {error && (
              <div className="login-error">
                <AlertTriangle size={18} />
                <div>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {success && (
              <div className="login-success">
                <UserCheck size={18} />
                <div>
                  <p>{success}</p>
                </div>
              </div>
            )}

            <div className="login-field">
              <label htmlFor="signup-fullname">
                <User size={16} />
                Full Name
              </label>
              <input
                id="signup-fullname"
                type="text"
                value={signupFullName}
                onChange={(e) => setSignupFullName(e.target.value)}
                placeholder="Enter your full name"
                required
                autoFocus
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-school-id">
                <Shield size={16} />
                School ID / Employee ID
              </label>
              <input
                id="signup-school-id"
                type="text"
                value={signupSchoolId}
                onChange={(e) => setSignupSchoolId(e.target.value)}
                placeholder="Enter your school or employee ID"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-prc-license">
                <Shield size={16} />
                PRC License Number
              </label>
              <input
                id="signup-prc-license"
                type="text"
                value={signupPrcLicenseNumber}
                onChange={(e) => setSignupPrcLicenseNumber(e.target.value)}
                placeholder="Enter your PRC license number"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-email">
                <Mail size={16} />
                Email Address
              </label>
              <input
                id="signup-email"
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="Use your work email"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-contact-number">
                <Phone size={16} />
                Contact Number
              </label>
              <input
                id="signup-contact-number"
                type="tel"
                value={signupContactNumber}
                onChange={(e) => setSignupContactNumber(e.target.value)}
                placeholder="Enter your contact number"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-school-name">
                <Shield size={16} />
                School / Clinic Name
              </label>
              <input
                id="signup-school-name"
                type="text"
                value={signupSchoolName}
                onChange={(e) => setSignupSchoolName(e.target.value)}
                placeholder="Enter your school or clinic name"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="signup-username">
                <User size={16} />
                Username
              </label>
              <input
                id="signup-username"
                type="text"
                value={signupUsername}
                onChange={(e) => setSignupUsername(e.target.value.toLowerCase())}
                placeholder="Choose a username (e.g., nurse.john)"
                required
              />
            </div>

            <div className="otp-field">
              <div className="otp-heading">
                <label htmlFor="signup-otp-0">
                  <KeyRound size={16} />
                  Verify your email
                </label>
                <span>{signupOtp.length}/6</span>
              </div>
              <p className="otp-description">
                {otpSent ? 'Enter the six-digit code sent to your work email.' : 'Send a one-time verification code to your work email.'}
              </p>
              <div className="otp-inputs" role="group" aria-label="Six-digit OTP code">
                {Array.from({ length: 6 }, (_, index) => (
                  <input
                    key={index}
                    ref={(element) => { signupOtpRefs.current[index] = element; }}
                    id={`signup-otp-${index}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={signupOtp[index] || ''}
                    onChange={(event) => handleSignupOtpChange(index, event.target.value)}
                    onKeyDown={(event) => handleSignupOtpKeyDown(index, event)}
                    aria-label={`OTP digit ${index + 1}`}
                    required
                  />
                ))}
              </div>
              <div className="otp-actions">
                <span className={otpSent ? 'otp-status sent' : 'otp-status'}>
                  <span className="otp-status-dot" />
                  {otpSent ? 'Code ready' : 'Not verified'}
                </span>
                <button type="button" className="otp-resend" onClick={handleSendOtp}>
                  <Mail size={14} />
                  {otpSent ? 'Resend code' : 'Send code'}
                </button>
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="signup-password">
                <Lock size={16} />
                Password
              </label>
              <div className="password-input">
                <input
                  id="signup-password"
                  type={showSignupPassword ? 'text' : 'password'}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="At least 12 chars with uppercase, lowercase, number, and special char"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowSignupPassword(!showSignupPassword)}
                  aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                >
                  {showSignupPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="signup-confirm">
                <Lock size={16} />
                Confirm Password
              </label>
              <input
                id="signup-confirm"
                type="password"
                value={signupConfirmPassword}
                onChange={(e) => setSignupConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
              />
            </div>

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Creating account...
                </>
              ) : (
                <>
                  <UserCheck size={16} /> Request Client Access
                </>
              )}
            </button>

            <button
              type="button"
              className="back-to-signin"
              onClick={() => {
                resetForm();
                setMode('signin');
              }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </button>

            <div className="login-security-info">
              <Shield size={14} />
              <span>Required details: full name, school ID, PRC license, email, contact number, school name, username, and a secure password.</span>
            </div>
          </form>
        )}

        <footer className="login-footer">
          <p>© 2026 HealthMate+ • Client portal</p>
        </footer>
      </div>
    </div>
  );
}
