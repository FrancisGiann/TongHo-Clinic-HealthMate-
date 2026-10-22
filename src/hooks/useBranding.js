import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export const DEFAULT_APPLICATION_LOGO = '/healthmate-mark.svg';
export const DEFAULT_SCHOOL_SEAL = '/Logo.jpg';
export const DEFAULT_LANDING_COMMUNITY_PHOTO = null;

export function useBranding() {
  const [branding, setBranding] = useState({
    version: 1,
    applicationLogo: DEFAULT_APPLICATION_LOGO,
    schoolSeal: DEFAULT_SCHOOL_SEAL,
    landingCommunityPhoto: DEFAULT_LANDING_COMMUNITY_PHOTO,
  });
  useEffect(() => {
    let active = true;
    const load = () => api.get('/api/branding').then((result) => {
      if (!active) return;
      setBranding({
        version: result.version || 1,
        applicationLogo: result.applicationLogo?.url || DEFAULT_APPLICATION_LOGO,
        schoolSeal: result.schoolSeal?.url || DEFAULT_SCHOOL_SEAL,
        landingCommunityPhoto: result.landingCommunityPhoto?.url || DEFAULT_LANDING_COMMUNITY_PHOTO,
      });
    }).catch(() => {
      if (active) setBranding({ version: 1, applicationLogo: DEFAULT_APPLICATION_LOGO, schoolSeal: DEFAULT_SCHOOL_SEAL, landingCommunityPhoto: DEFAULT_LANDING_COMMUNITY_PHOTO });
    });
    window.addEventListener('healthmate-branding-updated', load);
    load();
    return () => { active = false; window.removeEventListener('healthmate-branding-updated', load); };
  }, []);
  return branding;
}
