import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandingEditor from '../components/BrandingEditor.jsx';
import LandingContentEditor from '../components/LandingContentEditor.jsx';

export default function ContentManagement() {
  return (
    <div className="form-page content-management-page">
      <header className="page-intro content-management-intro">
        <div>
          <h2>Content management</h2>
          <p>Edit visitor-facing page copy and manage school identity images.</p>
        </div>
        <Link className="secondary-btn" to="/landing-preview" target="_blank" rel="noopener noreferrer">View landing page <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </header>
      <nav className="cms-section-nav" aria-label="Content management sections">
        <a href="#cms-landing-content">Landing page content</a>
        <a href="#cms-school-identity">School identity and images</a>
      </nav>
      <p className="disabled-note cms-publish-note"><strong>Publishing:</strong> Copy is saved as a private draft until you publish it. School identity images publish immediately when saved.</p>
      <LandingContentEditor />
      <p className="disabled-note cms-public-image-note"><strong>Public image guidance:</strong> Landing-page photos are visible before sign-in. Upload only school-approved images; never upload medical records or sensitive student information.</p>
      <section className="panel settings-tab-panel cms-image-panel" id="cms-school-identity" aria-label="School identity and landing page images">
        <BrandingEditor />
      </section>
    </div>
  );
}
