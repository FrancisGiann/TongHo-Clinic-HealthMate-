import { useEffect, useRef, useState } from 'react';
import { ArrowRight, HeartHandshake, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useBranding } from '../hooks/useBranding.js';
import { createDefaultLandingContent, projectPublicLandingContent } from '../../shared/landingContent.js';
import { api } from '../utils/api';

const COMMUNITY_ILLUSTRATION = '/illustrations/guardian-care.webp';

function fallbackImageOnce(event, fallback, fallbackAlt, fallbackCaption) {
  const image = event.currentTarget;
  if (image.dataset.fallbackAttempted) {
    image.hidden = true;
    return;
  }
  image.dataset.fallbackAttempted = 'true';
  if (image.getAttribute('src') === fallback) {
    image.hidden = true;
    return;
  }
  image.src = fallback;
  if (fallbackAlt) {
    image.alt = fallbackAlt;
    const caption = image.closest('figure')?.querySelector('figcaption');
    if (caption && fallbackCaption) caption.textContent = fallbackCaption;
  }
}

export default function Home({ authError = '' }) {
  const headerRef = useRef(null);
  const branding = useBranding();
  const communityPhoto = branding.landingCommunityPhoto;
  const location = useLocation();
  const draftPreview = new URLSearchParams(location.search).get('preview') === 'draft';
  const [landingContent, setLandingContent] = useState(() => projectPublicLandingContent(createDefaultLandingContent()));
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    const header = headerRef.current;
    const updateOffset = () => header.parentElement.style.setProperty('--hm-header-offset', `${header.getBoundingClientRect().height + 16}px`);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const data = draftPreview
          ? await api.get('/api/admin/landing-content').then((result) => projectPublicLandingContent(result.draftContent, new Date()))
          : await api.get('/api/landing-content');
        if (active) {
          setLandingContent(data);
          setPreviewError('');
        }
      } catch {
        if (active && draftPreview) {
          setLandingContent(projectPublicLandingContent(createDefaultLandingContent()));
          setPreviewError('The saved draft preview is unavailable. Sign in as a system administrator and reopen it from Content management. No draft content is shown.');
        }
      } finally {
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [draftPreview]);

  const renderLandingSection = (section) => {
    if (section.id === 'clinic') {
      const clinic = section.clinic;
      return <section className="hm-home-clinic" key={section.id} aria-labelledby="hm-home-clinic-title">
        <h2 id="hm-home-clinic-title">Clinic information</h2>
        <div className="hm-home-clinic-layout">
          <dl className="hm-home-clinic-details">
            {clinic.location && <div><dt>Location</dt><dd>{clinic.location}</dd></div>}
            {clinic.hours && <div><dt>Hours</dt><dd>{clinic.hours}</dd></div>}
            {clinic.contact && <div><dt>Contact</dt><dd>{clinic.contact}</dd></div>}
          </dl>
          {clinic.services.length > 0 && <div className="hm-home-clinic-services"><h3>Services</h3><ul>{clinic.services.map((service, index) => <li key={`${index}-${service}`}>{service}</li>)}</ul></div>}
        </div>
      </section>;
    }
    if (section.id === 'announcements') {
      return <section className="hm-home-announcements" key={section.id} aria-labelledby="hm-home-announcements-title">
        <h2 id="hm-home-announcements-title">Announcements</h2>
        <ul>{section.announcements.map((announcement, index) => <li key={`${index}-${announcement.title}`}><article><h3>{announcement.title}</h3><p>{announcement.body}</p></article></li>)}</ul>
      </section>;
    }
    if (section.id === 'faqs') {
      return <section className="hm-home-faqs" key={section.id} aria-labelledby="hm-home-faqs-title">
        <h2 id="hm-home-faqs-title">Frequently asked questions</h2>
        <div>{section.faqs.map((faq, index) => <details key={`${index}-${faq.question}`}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
      </section>;
    }
    return null;
  };

  return (
    <main className="hm-home">
      {draftPreview && <div className="hm-home-preview-banner" role="status">
        <span>{previewError ? 'Draft preview unavailable' : 'Previewing the saved draft. Only a signed-in system administrator can view this version.'}</span>
      </div>}
      <header className="hm-home-header" ref={headerRef}>
        <Link className="hm-home-brand" to="/" aria-label="HealthMate+ home">
          <img src={branding.applicationLogo} alt="" onError={(event) => { event.currentTarget.src = '/healthmate-mark.svg'; }} />
          <span>HealthMate+</span>
        </Link>
        <nav className="hm-home-nav" aria-label="Main navigation">
          <a href="#community">Our community</a>
          <a href="#portal-access">Portal access</a>
          <Link className="hm-home-nav-signin" to="/login">Sign in <ArrowRight size={16} /></Link>
        </nav>
      </header>

      {authError && <div className="hm-home-error" role="alert">{authError}</div>}
      {previewError && <div className="hm-home-error" role="alert">{previewError}</div>}

      <section className="hm-home-hero" aria-labelledby="hm-home-title">
        <div className="hm-home-hero-copy">
          <h1 id="hm-home-title">{landingContent.hero.headline}</h1>
          <p>{landingContent.hero.introduction}</p>
          <div className="hm-home-actions">
            <Link className="hm-home-primary" to="/login">{landingContent.hero.primaryActionLabel} <ArrowRight size={18} /></Link>
            <a className="hm-home-secondary" href="#portal-access">{landingContent.hero.secondaryActionLabel}</a>
          </div>
        </div>
        <div className="hm-home-showcase">
          <div className="hm-home-seal-panel">
            <div className="hm-home-seal-frame">
              <img src={branding.schoolSeal} alt="Philippine Tong Ho Institute seal" onError={(event) => fallbackImageOnce(event, '/Logo.jpg')} />
            </div>
            <div className="hm-home-seal-copy">
              <strong>Philippine Tong Ho Institute</strong>
              <span>City of Lucena</span>
              <p>HealthMate+</p>
              <small>School clinic care, connected.</small>
            </div>
          </div>
        </div>
      </section>

      <section className="hm-home-community" id="community" aria-labelledby="hm-home-community-title">
        <div className="hm-home-community-copy">
          <div className="hm-home-section-heading">
            <HeartHandshake size={24} aria-hidden="true" />
            <h2 id="hm-home-community-title">One school community, connected with care.</h2>
          </div>
          <p>Clinic staff can manage health records and visits in one workspace. Guardians can follow information shared for linked students and request clinic appointments.</p>
        </div>
        <figure className="hm-home-community-art">
          <img
            src={communityPhoto || COMMUNITY_ILLUSTRATION}
            alt={communityPhoto ? 'School community image for Philippine Tong Ho Institute' : 'Illustration of a guardian and student reviewing a health record together'}
            width="600"
            height="400"
            loading="lazy"
            onError={(event) => fallbackImageOnce(event, COMMUNITY_ILLUSTRATION, 'Illustration of a guardian and student reviewing a health record together', 'Family and student illustration')}
          />
          <figcaption>{communityPhoto ? 'School community photo' : 'Family and student illustration'}</figcaption>
        </figure>
      </section>

      {landingContent.sections.map(renderLandingSection)}

      <section className="hm-home-portals" id="portal-access" aria-labelledby="hm-home-portals-title">
        <div className="hm-home-portals-heading">
          <h2 id="hm-home-portals-title">A clear place for every role.</h2>
          <p>Clinic staff and guardians use accounts with access shaped around their responsibilities.</p>
        </div>
        <div className="hm-home-portal-list">
          <article className="hm-home-portal hm-home-role-nurse">
            <Stethoscope className="hm-home-role-icon" size={24} aria-hidden="true" />
            <h3>School nurse</h3>
            <p>Nurses manage student profiles, consultations, appointment requests, supplies, and reports.</p>
          </article>
          <article className="hm-home-portal hm-home-role-admin">
            <ShieldCheck className="hm-home-role-icon" size={24} aria-hidden="true" />
            <h3>System administrator</h3>
            <p>System administrators manage account access and system activity.</p>
          </article>
          <article className="hm-home-portal hm-home-role-guardians">
            <Users className="hm-home-role-icon" size={24} aria-hidden="true" />
            <h3>Parents and guardians</h3>
            <p>Create a guardian account request, then follow records for linked students and request clinic appointments after an administrator verifies your relationship.</p>
          </article>
        </div>
        <p className="hm-home-student-note">Students are school-managed patient records. They do not have accounts or sign in.</p>
      </section>

      <section className="hm-home-access" aria-labelledby="hm-home-access-title">
        <div>
          <h2 id="hm-home-access-title">Request a guardian account.</h2>
          <p>Verify your email and submit one student ID. A school administrator reviews the relationship against school records before activating your account. Staff accounts continue to use administrator invitations.</p>
        </div>
        <Link className="hm-home-access-link" to="/login">Sign in or create an account <ArrowRight size={17} /></Link>
      </section>

      <footer className="hm-home-footer">
        <div className="hm-home-footer-heading">
          <span>HealthMate+ · Philippine Tong Ho Institute</span>
          <Link to="/login">Sign in</Link>
        </div>
        <div className="hm-home-policies">
          <details>
            <summary>Terms and Conditions</summary>
            <div className="hm-home-policy-copy">
              <h2>Using HealthMate+</h2>
              <p>HealthMate+ supports school clinic records, consultations, and appointment requests. Access depends on your account role and, for guardians, your verified relationship with a student.</p>
              <p>Use only your own account. Keep your password and verification codes private, provide accurate information, and access or share records only when you are authorized to do so. Sign out when using a shared device.</p>
              <p>An appointment request is subject to clinic review. Information in HealthMate+ supports clinic care; it does not replace a consultation or provide an emergency response service. For urgent concerns, contact the clinic directly or seek emergency assistance.</p>
              <p>For account access, incorrect records, or questions about using the system, contact the school clinic or system administrator through the school’s established contact channels.</p>
            </div>
          </details>
          <details>
            <summary>Cookies and browser storage</summary>
            <div className="hm-home-policy-copy">
              <h2>What this application stores in your browser</h2>
              <p>The <code>healthmate_session</code> cookie keeps you signed in. It contains a session identifier, not your clinic record, and is restricted from access by page scripts. Signing out clears this cookie. Sessions also expire automatically; choosing “Remember me” affects how long the browser keeps the cookie.</p>
              <p>Browser storage remembers display preferences such as your theme and collapsed sidebar. Some account-settings state is kept temporarily for the current browser tab.</p>
              <p>You can clear cookies and site storage in your browser settings. Clearing or blocking the sign-in cookie means you will need to sign in again or may be unable to use account features. Clearing preferences resets them on that browser.</p>
              <p>Fonts are requested from Google Fonts, so your browser connects to that service when loading them.</p>
            </div>
          </details>
        </div>
        <p className="hm-home-cookie-note">This application uses a cookie for sign-in and browser storage for preferences. See the details above.</p>
      </footer>
    </main>
  );
}
