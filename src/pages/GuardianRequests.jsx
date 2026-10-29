import { Link, useLocation } from 'react-router-dom';
import GuardianSignupRequests from '../components/GuardianSignupRequests';

export default function GuardianRequests({ data }) {
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const usersUrl = typeof returnTo === 'string' && /^\/users(?:\?.*)?$/.test(returnTo) ? returnTo : '/users';
  return <div className="form-page">
    <div className="page-intro"><div><p className="section-kicker">Administration</p><h2>Guardian registration requests</h2><p>Find applications and verify guardian relationships against school records.</p></div><Link className="secondary-btn" to={usersUrl}>User accounts</Link></div>
    <section className="panel settings-tab-panel"><GuardianSignupRequests students={data.students || []} standalone /></section>
  </div>;
}
