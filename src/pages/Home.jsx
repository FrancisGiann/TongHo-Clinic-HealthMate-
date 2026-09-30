import { ArrowRight, HeartHandshake } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Home({ authError = '' }) {
  return (
    <main className="hm-home">
      <header className="hm-home-header">
        <Link className="hm-home-brand" to="/" aria-label="HealthMate+ home">
          <img src="/Logo.jpg" alt="" />
          <span>HealthMate+</span>
        </Link>
        <nav className="hm-home-nav" aria-label="Main navigation">
          <a href="#community">Our community</a>
          <a href="#portal-access">Portal access</a>
          <Link className="hm-home-nav-signin" to="/login">Sign in <ArrowRight size={16} /></Link>
        </nav>
      </header>

      {authError && <div className="hm-home-error" role="alert">{authError}</div>}

      <section className="hm-home-hero" aria-labelledby="hm-home-title">
        <div className="hm-home-hero-copy">
          <h1 id="hm-home-title">School clinic care, connected.</h1>
          <p>A secure clinic workspace for Philippine Tong Ho Institute staff, with linked health records and appointment access for guardians.</p>
          <div className="hm-home-actions">
            <Link className="hm-home-primary" to="/login">Sign in to HealthMate+ <ArrowRight size={18} /></Link>
            <a className="hm-home-secondary" href="#portal-access">How access works</a>
          </div>
        </div>
        <div className="hm-home-scene" aria-hidden="true">
          <img src="/illustrations/school-clinic.webp" alt="" width="1200" height="800" fetchPriority="high" />
        </div>
      </section>

      <section className="hm-home-community" id="community" aria-labelledby="hm-home-community-title">
        <div className="hm-home-section-heading">
          <HeartHandshake size={24} aria-hidden="true" />
          <h2 id="hm-home-community-title">One school community, connected with care.</h2>
        </div>
        <p>Clinic staff can manage health records and visits in one workspace. Guardians can follow information shared for linked students and request clinic appointments.</p>
      </section>

      <section className="hm-home-portals" id="portal-access" aria-labelledby="hm-home-portals-title">
        <div className="hm-home-portals-heading">
          <h2 id="hm-home-portals-title">A clear place for every role.</h2>
          <p>Clinic staff and guardians use accounts with access shaped around their responsibilities.</p>
        </div>
        <div className="hm-home-portal-list">
          <article className="hm-home-portal hm-home-portal-staff">
            <h3>For school clinic staff</h3>
            <p>Nurses manage student profiles, consultations, appointment requests, supplies, and reports. System administrators manage accounts and clinic settings.</p>
          </article>
          <article className="hm-home-portal hm-home-portal-guardians">
            <h3>For parents and guardians</h3>
            <p>View records for linked students, submit health information for nurse review, and request clinic appointments for those students.</p>
          </article>
        </div>
        <p className="hm-home-student-note">Students are school-managed patient records. They do not have accounts or sign in.</p>
      </section>

      <section className="hm-home-access" aria-labelledby="hm-home-access-title">
        <div>
          <h2 id="hm-home-access-title">Your account starts with an invitation.</h2>
          <p>Ask your school clinic administrator for an account invitation. Follow its link to activate your account, then sign in to HealthMate+.</p>
        </div>
        <Link className="hm-home-access-link" to="/login">Go to sign in <ArrowRight size={17} /></Link>
      </section>

      <footer className="hm-home-footer">
        <span>HealthMate+ · Philippine Tong Ho Institute</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </main>
  );
}
