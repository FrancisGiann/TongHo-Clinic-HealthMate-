import { ArrowRight, CalendarDays, ClipboardList, HeartHandshake, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';

const portalFeatures = [
  {
    icon: ClipboardList,
    title: 'School clinic team',
    text: 'Manage patient profiles, consultations, appointments, clinic supplies, and reports in one secure workspace.',
  },
  {
    icon: UsersRound,
    title: 'Students',
    text: 'Sign in to view the health information and appointments available for your own account.',
  },
  {
    icon: CalendarDays,
    title: 'Parents and guardians',
    text: 'See records and appointments for the student profiles linked to your account.',
  },
];

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
          <h1 id="hm-home-title">A welcoming place for school health.</h1>
          <p>HealthMate+ brings the Philippine Tong Ho Institute school clinic and its community together around secure, role-based access to clinic information.</p>
          <div className="hm-home-actions">
            <Link className="hm-home-primary" to="/login">Sign in to HealthMate+ <ArrowRight size={18} /></Link>
            <a className="hm-home-secondary" href="#portal-access">Explore portal access</a>
          </div>
        </div>
        <figure className="hm-home-seal-panel">
          <div className="hm-home-seal-frame">
            <img src="/Logo.jpg" alt="Philippine Tong Ho Institute seal" />
          </div>
          <figcaption>
            <p>Philippine Tong Ho Institute</p>
            <span>City of Lucena</span>
          </figcaption>
        </figure>
      </section>

      <section className="hm-home-community" id="community" aria-labelledby="hm-home-community-title">
        <div className="hm-home-section-heading">
          <HeartHandshake size={24} aria-hidden="true" />
          <h2 id="hm-home-community-title">One school community, connected with care.</h2>
        </div>
        <p>HealthMate+ supports the school clinic team while giving students and guardians a secure way to reach the records and appointments linked to their accounts.</p>
      </section>

      <section className="hm-home-portals" id="portal-access" aria-labelledby="hm-home-portals-title">
        <div className="hm-home-portals-heading">
          <h2 id="hm-home-portals-title">A portal for each part of the community.</h2>
          <p>Your account determines which tools and records you can access.</p>
        </div>
        <div className="hm-home-portal-list">
          {portalFeatures.map(({ icon: Icon, title, text }) => (
            <article className="hm-home-portal" key={title}>
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="hm-home-access" aria-labelledby="hm-home-access-title">
        <div>
          <h2 id="hm-home-access-title">Your account, your access.</h2>
          <p>Sign in with the account provided by your school clinic administrator. New accounts are activated from an invitation link.</p>
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
