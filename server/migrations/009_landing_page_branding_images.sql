ALTER TABLE branding_assets DROP CONSTRAINT IF EXISTS branding_assets_slot_check;
ALTER TABLE branding_assets
  ADD CONSTRAINT branding_assets_slot_check
  CHECK (slot IN ('applicationLogo', 'schoolSeal', 'landingHeroPhoto', 'landingCommunityPhoto'));
