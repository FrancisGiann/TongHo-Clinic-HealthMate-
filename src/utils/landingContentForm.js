import { isoToManilaLocalDateTime, manilaLocalDateTimeToIso } from '../../shared/landingContent.js';

export function announcementToForm(item) {
  const startsAtLocal = isoToManilaLocalDateTime(item.startsAt);
  const expiresAtLocal = isoToManilaLocalDateTime(item.expiresAt);
  return {
    ...item,
    startsAt: startsAtLocal,
    expiresAt: expiresAtLocal,
    sourceStartsAt: item.startsAt,
    sourceStartsAtLocal: startsAtLocal,
    sourceExpiresAt: item.expiresAt,
    sourceExpiresAtLocal: expiresAtLocal,
  };
}

function exactOrMinutePrecision(value, source, sourceLocal) {
  if (source && value === sourceLocal) return source;
  return manilaLocalDateTimeToIso(value);
}

export function announcementFromForm(item) {
  return {
    title: item.title,
    body: item.body,
    startsAt: exactOrMinutePrecision(item.startsAt, item.sourceStartsAt, item.sourceStartsAtLocal),
    expiresAt: exactOrMinutePrecision(item.expiresAt, item.sourceExpiresAt, item.sourceExpiresAtLocal),
  };
}
