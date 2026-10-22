export const LANDING_TIME_ZONE = 'Asia/Manila';
export const LANDING_SECTION_IDS = Object.freeze(['clinic', 'announcements', 'faqs']);

const SECTION_SET = new Set(LANDING_SECTION_IDS);

export const DEFAULT_LANDING_CONTENT = Object.freeze({
  hero: Object.freeze({
    headline: 'School clinic care, connected.',
    introduction: 'A secure clinic workspace for Philippine Tong Ho Institute staff, with linked health records and appointment access for guardians.',
    primaryActionLabel: 'Sign in to HealthMate+',
    secondaryActionLabel: 'How access works',
  }),
  clinic: Object.freeze({ location: '', hours: '', contact: '', services: Object.freeze([]) }),
  announcements: Object.freeze([]),
  faqs: Object.freeze([]),
  sectionOrder: LANDING_SECTION_IDS,
  sectionVisibility: Object.freeze({ clinic: true, announcements: true, faqs: true }),
});

export function createDefaultLandingContent() {
  return {
    hero: { ...DEFAULT_LANDING_CONTENT.hero },
    clinic: { ...DEFAULT_LANDING_CONTENT.clinic, services: [] },
    announcements: [],
    faqs: [],
    sectionOrder: [...DEFAULT_LANDING_CONTENT.sectionOrder],
    sectionVisibility: { ...DEFAULT_LANDING_CONTENT.sectionVisibility },
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validateText(value, field, maxLength, { required = false, singleLine = false } = {}, errors) {
  if (typeof value !== 'string') {
    errors[field] = 'Enter plain text.';
    return '';
  }
  const normalized = value.trim();
  const count = [...normalized].length;
  if ((required && count === 0) || count > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
    || (singleLine && /[\r\n]/u.test(normalized))) {
    errors[field] = required && count === 0 ? 'This field is required.' : `Use plain text with no more than ${maxLength} characters.`;
    return '';
  }
  return normalized;
}

function parseOffsetTimestamp(value, field, errors) {
  if (typeof value !== 'string') {
    errors[field] = 'Enter a date and time in Philippine time.';
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (!match) {
    errors[field] = 'Choose a date and time in Philippine time.';
    return null;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', , zone, sign, offsetHourText = '0', offsetMinuteText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const validOffset = zone === 'Z' || (offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0));
  const parsed = Date.parse(value);
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59 || !validOffset || !Number.isFinite(parsed)) {
    errors[field] = 'Choose a valid date and time in Philippine time.';
    return null;
  }
  return new Date(parsed).toISOString();
}

function assertObjectKeys(value, keys, field, errors) {
  if (!hasOnlyKeys(value, keys)) {
    errors[field] = 'This section has unsupported fields.';
    return false;
  }
  return true;
}

export function validateLandingContent(input) {
  const errors = {};
  const rootKeys = ['hero', 'clinic', 'announcements', 'faqs', 'sectionOrder', 'sectionVisibility'];
  if (!assertObjectKeys(input, rootKeys, 'content', errors)) return { valid: false, errors };

  const hero = {};
  const clinic = {};
  assertObjectKeys(input.hero, ['headline', 'introduction', 'primaryActionLabel', 'secondaryActionLabel'], 'hero', errors);
  hero.headline = validateText(input.hero?.headline, 'hero.headline', 120, { required: true, singleLine: true }, errors);
  hero.introduction = validateText(input.hero?.introduction, 'hero.introduction', 500, { required: true }, errors);
  hero.primaryActionLabel = validateText(input.hero?.primaryActionLabel, 'hero.primaryActionLabel', 60, { required: true, singleLine: true }, errors);
  hero.secondaryActionLabel = validateText(input.hero?.secondaryActionLabel, 'hero.secondaryActionLabel', 60, { required: true, singleLine: true }, errors);

  assertObjectKeys(input.clinic, ['location', 'hours', 'contact', 'services'], 'clinic', errors);
  clinic.location = validateText(input.clinic?.location, 'clinic.location', 160, { singleLine: true }, errors);
  clinic.hours = validateText(input.clinic?.hours, 'clinic.hours', 280, {}, errors);
  clinic.contact = validateText(input.clinic?.contact, 'clinic.contact', 200, {}, errors);
  if (!Array.isArray(input.clinic?.services) || input.clinic.services.length > 8) {
    errors['clinic.services'] = 'Add no more than 8 services.';
    clinic.services = [];
  } else {
    clinic.services = input.clinic.services.map((service, index) => validateText(service, `clinic.services.${index}`, 120, { required: true, singleLine: true }, errors));
  }

  const announcements = [];
  if (!Array.isArray(input.announcements) || input.announcements.length > 6) {
    errors.announcements = 'Add no more than 6 announcements.';
  } else {
    input.announcements.forEach((item, index) => {
      const field = `announcements.${index}`;
      if (!assertObjectKeys(item, ['title', 'body', 'startsAt', 'expiresAt'], field, errors)) return;
      const title = validateText(item.title, `${field}.title`, 100, { required: true, singleLine: true }, errors);
      const body = validateText(item.body, `${field}.body`, 600, { required: true }, errors);
      const startsAt = parseOffsetTimestamp(item.startsAt, `${field}.startsAt`, errors);
      const expiresAt = parseOffsetTimestamp(item.expiresAt, `${field}.expiresAt`, errors);
      if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
        errors[`${field}.expiresAt`] = 'Expiry must be later than the start time.';
      }
      announcements.push({ title, body, startsAt, expiresAt });
    });
  }

  const faqs = [];
  if (!Array.isArray(input.faqs) || input.faqs.length > 12) {
    errors.faqs = 'Add no more than 12 frequently asked questions.';
  } else {
    input.faqs.forEach((item, index) => {
      const field = `faqs.${index}`;
      if (!assertObjectKeys(item, ['question', 'answer'], field, errors)) return;
      faqs.push({
        question: validateText(item.question, `${field}.question`, 180, { required: true }, errors),
        answer: validateText(item.answer, `${field}.answer`, 1200, { required: true }, errors),
      });
    });
  }

  const sectionOrder = Array.isArray(input.sectionOrder) ? [...input.sectionOrder] : [];
  if (sectionOrder.length !== LANDING_SECTION_IDS.length || sectionOrder.some((section) => !SECTION_SET.has(section))
    || new Set(sectionOrder).size !== LANDING_SECTION_IDS.length) {
    errors.sectionOrder = 'Choose each optional section once.';
  }
  const sectionVisibility = {};
  if (!isRecord(input.sectionVisibility) || Object.keys(input.sectionVisibility).length !== LANDING_SECTION_IDS.length
    || Object.keys(input.sectionVisibility).some((section) => !SECTION_SET.has(section))) {
    errors.sectionVisibility = 'Choose visibility for each optional section.';
  } else {
    for (const section of LANDING_SECTION_IDS) {
      if (typeof input.sectionVisibility[section] !== 'boolean') errors[`sectionVisibility.${section}`] = 'Choose whether this section is shown.';
      sectionVisibility[section] = input.sectionVisibility[section];
    }
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: { hero, clinic, announcements, faqs, sectionOrder, sectionVisibility },
    errors: {},
  };
}

export function normalizeStoredLandingContent(value) {
  if (!isRecord(value) || Object.keys(value).length === 0) return createDefaultLandingContent();
  const validation = validateLandingContent(value);
  return validation.valid ? validation.value : createDefaultLandingContent();
}

export function projectPublicLandingContent(value, now = new Date()) {
  const content = normalizeStoredLandingContent(value);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const sectionsById = {
    clinic: {
      id: 'clinic',
      clinic: content.clinic,
    },
    announcements: {
      id: 'announcements',
      announcements: content.announcements
        .filter((item) => Date.parse(item.startsAt) <= nowMs && nowMs < Date.parse(item.expiresAt))
        .map(({ title, body }) => ({ title, body })),
    },
    faqs: {
      id: 'faqs',
      faqs: content.faqs.map(({ question, answer }) => ({ question, answer })),
    },
  };
  const hasContent = {
    clinic: Boolean(content.clinic.location || content.clinic.hours || content.clinic.contact || content.clinic.services.length),
    announcements: sectionsById.announcements.announcements.length > 0,
    faqs: sectionsById.faqs.faqs.length > 0,
  };
  return {
    hero: { ...content.hero },
    sections: content.sectionOrder
      .filter((section) => content.sectionVisibility[section] && hasContent[section])
      .map((section) => sectionsById[section]),
  };
}

export function manilaLocalDateTimeToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(String(value || ''));
  if (!match) return '';
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59) return '';
  return `${value}:00+08:00`;
}

export function isoToManilaLocalDateTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LANDING_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
