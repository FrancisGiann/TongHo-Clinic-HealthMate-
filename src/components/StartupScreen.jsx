import { CircleAlert, HeartPulse, LogOut, RotateCw, ShieldCheck } from 'lucide-react';
import './StartupScreen.css';

const roleCopy = {
  guardian: {
    message: 'Loading the student records linked to your account.',
  },
  school_nurse: {
    message: 'Loading clinic records and operations data.',
  },
  system_administrator: {
    message: 'Loading workspace settings and student roster details.',
  },
};

export default function StartupScreen({
  state = 'session',
  user = null,
  dark = false,
  slow = false,
  error = '',
  logoutError = '',
  signingOut = false,
  onRetry,
  onSignOut,
}) {
  const isUnsupported = state === 'unsupported';
  const isError = state === 'error' || isUnsupported;
  const role = roleCopy[user?.role];
  const title = state === 'session'
    ? 'Checking your secure session'
    : isUnsupported
      ? 'This account cannot open the clinic workspace'
      : state === 'error'
        ? 'Clinic data did not load'
        : 'Preparing your clinic workspace';
  const message = state === 'session'
    ? 'Confirming your HealthMate+ access.'
    : isUnsupported
      ? 'Contact your clinic administrator for an account with a supported HealthMate+ role.'
      : state === 'error'
        ? `Authorized clinic records could not be loaded. ${error}`.trim()
        : role?.message || 'Loading the information available to your account.';

  return (
    <main className={`hm-startup${dark ? ' dark' : ''}`}>
      <section className="hm-startup-frame" aria-labelledby="hm-startup-title">
        <header className="hm-startup-header">
          <div className="hm-startup-brand">
            <img src="/Logo.jpg" alt="" width="44" height="44" />
            <div>
              <strong>HealthMate+</strong>
              <span>Philippine Tong Ho Institute</span>
            </div>
          </div>
          {user && (
            <button
              type="button"
              className="hm-startup-signout"
              onClick={onSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              <LogOut size={16} aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </header>

        <div className={`hm-startup-content${isError ? ' is-error' : ''}`}>
          <div className="hm-startup-status">
            <div className={`hm-startup-status-icon${isError ? ' is-error' : ''}`} aria-hidden="true">
              {isError ? <CircleAlert size={24} /> : state === 'session' ? <ShieldCheck size={24} /> : <HeartPulse size={24} />}
            </div>
            <h1 id="hm-startup-title">{title}</h1>
            <p className={isError ? 'hm-startup-error-copy' : 'hm-startup-copy'} aria-live={isError ? undefined : 'polite'} role={isError ? 'alert' : 'status'}>
              {message}
            </p>
            {slow && !isError && (
              <p className="hm-startup-slow" role="status">
                This is taking longer than usual. A retry option will appear if loading cannot finish.
              </p>
            )}
            {logoutError && <p className="hm-startup-signout-error" role="alert">{logoutError}</p>}
            {state === 'error' && (
              <button type="button" className="hm-startup-retry" onClick={onRetry}>
                <RotateCw size={16} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>

          {!isError && (
            <aside className="hm-startup-preview" aria-hidden="true">
              <div className="hm-startup-preview-heading"><span /><i /></div>
              <div className="hm-startup-preview-summary"><span /><span /><span /></div>
              <div className="hm-startup-preview-list">
                <span /><span /><span />
              </div>
              <div className="hm-startup-preview-footer"><span /><span /></div>
            </aside>
          )}
        </div>

        <footer className="hm-startup-footer">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Clinic information is protected by role-based access.</span>
        </footer>
      </section>
    </main>
  );
}
