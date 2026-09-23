const MOSCOW_UTC_OFFSET_HOURS = 3;
const PHONE_DIGITS_PATTERN = /^\d+$/;

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

export const normalizeCustomerPhone = (input: string): ValidationResult<string> => {
  const compact = input.trim().replace(/[\s()\-]/g, '');
  const withoutPlus = compact.startsWith('+') ? compact.slice(1) : compact;

  if (!PHONE_DIGITS_PATTERN.test(withoutPlus)) {
    return { success: false, error: 'Введите номер только цифрами, например +7 978 123-45-67.' };
  }

  let digits = withoutPlus;
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;

  if (digits.length !== 11 || !digits.startsWith('7')) {
    return { success: false, error: 'Ожидается российский номер из 10 или 11 цифр.' };
  }

  return { success: true, value: `+${digits}` };
};

export const validateAddress = (input: string): ValidationResult<string> => {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 3) return { success: false, error: 'Адрес слишком короткий.' };
  if (value.length > 500) return { success: false, error: 'Адрес должен быть короче 500 символов.' };
  return { success: true, value };
};

export const parsePatientWeight = (input: string): ValidationResult<number> => {
  const normalized = input.trim().replace(/\s*кг\s*$/i, '');
  if (!/^\d{1,3}$/.test(normalized)) {
    return { success: false, error: 'Введите вес целым числом в килограммах, например 85.' };
  }
  const value = Number(normalized);
  if (value < 1 || value > 500) {
    return { success: false, error: 'Вес должен быть от 1 до 500 кг.' };
  }
  return { success: true, value };
};

export const parsePriceRub = (input: string): ValidationResult<number> => {
  const normalized = input.trim()
    .replace(/\s/g, '')
    .replace(/(?:₽|руб(?:\.|лей)?|р\.)$/i, '');
  if (!/^\d{1,8}$/.test(normalized)) {
    return { success: false, error: 'Введите цену целым числом в рублях, например 7500.' };
  }
  const value = Number(normalized);
  if (value > 10_000_000) {
    return { success: false, error: 'Цена не должна превышать 10 000 000 ₽.' };
  }
  return { success: true, value };
};

/** Разбирает ДД.ММ.ГГГГ ЧЧ:ММ как Europe/Moscow (UTC+3). */
export const parseMoscowTripDate = (
  input: string,
  now = new Date(),
): ValidationResult<string> => {
  const match = input.trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    return { success: false, error: 'Введите дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ.' };
  }

  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const validCalendarDate = calendarCheck.getUTCFullYear() === year
    && calendarCheck.getUTCMonth() === month - 1
    && calendarCheck.getUTCDate() === day
    && calendarCheck.getUTCHours() === hour
    && calendarCheck.getUTCMinutes() === minute;
  if (!validCalendarDate) return { success: false, error: 'Такой даты или времени не существует.' };

  const value = new Date(Date.UTC(year, month - 1, day, hour - MOSCOW_UTC_OFFSET_HOURS, minute));
  if (value.getTime() < now.getTime() - 60_000) {
    return { success: false, error: 'Дата поездки должна быть в будущем.' };
  }
  const maxDate = new Date(now);
  maxDate.setUTCFullYear(maxDate.getUTCFullYear() + 2);
  if (value > maxDate) {
    return { success: false, error: 'Поездку можно указать не более чем на два года вперёд.' };
  }

  return { success: true, value: value.toISOString() };
};
