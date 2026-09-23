import type { CallClickInput, CallClickUtm } from './types';

/** После проверки data содержит только явно разрешённые поля. */
type ValidationResult =
  | { success: true; data: CallClickInput }
  | { success: false; errors: string[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const PHONE_PATTERN = /^\+?[1-9]\d{6,19}$/;
const PAGE_PATTERN = /^\/[^\s?#]*$/;
const YCLID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const TOP_LEVEL_KEYS = new Set([
  'eventId',
  'trackingId',
  'phone',
  'page',
  'referrer',
  'utm',
  'yclid',
  'sessionId',
  'clientTimestamp',
]);
const UTM_KEYS = new Set(['source', 'medium', 'campaign', 'content', 'term']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const findUnknownKeys = (value: Record<string, unknown>, allowed: Set<string>): string[] =>
  Object.keys(value).filter((key) => !allowed.has(key));

/** Общие ограничения строк: тип, длина, управляющие символы и формат. */
const readString = (
  value: unknown,
  field: string,
  errors: string[],
  options: { required?: boolean; maxLength: number; pattern?: RegExp } = { maxLength: 255 },
): string | undefined => {
  if (value === undefined || value === null || value === '') {
    if (options.required) errors.push(`${field} is required`);
    return undefined;
  }

  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return undefined;
  }

  if (value.length > options.maxLength) {
    errors.push(`${field} is too long`);
    return undefined;
  }

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    errors.push(`${field} contains control characters`);
    return undefined;
  }

  if (options.pattern && !options.pattern.test(value)) {
    errors.push(`${field} has an invalid format`);
    return undefined;
  }

  return value;
};

/** Принимаем только пять известных UTM-полей, без произвольного metadata. */
const readUtm = (value: unknown, errors: string[]): CallClickUtm | undefined => {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push('utm must be an object');
    return undefined;
  }

  const unknownKeys = findUnknownKeys(value, UTM_KEYS);
  if (unknownKeys.length > 0) errors.push(`utm contains unknown fields: ${unknownKeys.join(', ')}`);

  const utm: CallClickUtm = {
    source: readString(value.source, 'utm.source', errors, { maxLength: 255 }),
    medium: readString(value.medium, 'utm.medium', errors, { maxLength: 255 }),
    campaign: readString(value.campaign, 'utm.campaign', errors, { maxLength: 255 }),
    content: readString(value.content, 'utm.content', errors, { maxLength: 255 }),
    term: readString(value.term, 'utm.term', errors, { maxLength: 255 }),
  };

  const presentEntries = Object.entries(utm).filter(([, item]) => item !== undefined);
  return presentEntries.length > 0 ? Object.fromEntries(presentEntries) : undefined;
};

/** Runtime-проверка необходима: типы TypeScript не проверяют входящий HTTP JSON. */
export const validateCallClickPayload = (value: unknown): ValidationResult => {
  if (!isObject(value)) {
    return { success: false, errors: ['body must be an object'] };
  }

  const errors: string[] = [];
  const unknownKeys = findUnknownKeys(value, TOP_LEVEL_KEYS);
  if (unknownKeys.length > 0) errors.push(`body contains unknown fields: ${unknownKeys.join(', ')}`);

  const eventId = readString(value.eventId, 'eventId', errors, {
    required: true,
    maxLength: 36,
    pattern: UUID_PATTERN,
  });
  const trackingId = readString(value.trackingId, 'trackingId', errors, {
    required: true,
    maxLength: 64,
    pattern: TRACKING_ID_PATTERN,
  });
  const phone = readString(value.phone, 'phone', errors, {
    required: true,
    maxLength: 21,
    pattern: PHONE_PATTERN,
  });
  const page = readString(value.page, 'page', errors, {
    required: true,
    maxLength: 512,
    pattern: PAGE_PATTERN,
  });
  const referrer = readString(value.referrer, 'referrer', errors, { maxLength: 2048 });
  const yclid = readString(value.yclid, 'yclid', errors, {
    maxLength: 255,
    pattern: YCLID_PATTERN,
  });
  const sessionId = readString(value.sessionId, 'sessionId', errors, {
    maxLength: 36,
    pattern: UUID_PATTERN,
  });
  const clientTimestamp = readString(value.clientTimestamp, 'clientTimestamp', errors, {
    maxLength: 40,
    pattern: ISO_TIMESTAMP_PATTERN,
  });
  const utm = readUtm(value.utm, errors);

  if (referrer) {
    try {
      const parsed = new URL(referrer);
      if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('referrer must use http or https');
    } catch {
      errors.push('referrer must be a valid URL');
    }
  }

  if (clientTimestamp && Number.isNaN(Date.parse(clientTimestamp))) {
    errors.push('clientTimestamp must be a valid ISO timestamp');
  }

  if (errors.length > 0 || !eventId || !trackingId || !phone || !page) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      eventId,
      trackingId,
      phone,
      page,
      ...(referrer ? { referrer } : {}),
      ...(utm ? { utm } : {}),
      ...(yclid ? { yclid } : {}),
      ...(sessionId ? { sessionId } : {}),
      clientTimestamp,
    },
  };
};
