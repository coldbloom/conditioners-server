import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeCustomerPhone,
  parseMoscowTripDate,
  parsePatientWeight,
  parsePriceRub,
} from './validation';

test('normalizes common Russian phone formats', () => {
  assert.deepEqual(normalizeCustomerPhone('8 (978) 123-45-67'), {
    success: true,
    value: '+79781234567',
  });
  assert.deepEqual(normalizeCustomerPhone('9781234567'), {
    success: true,
    value: '+79781234567',
  });
  assert.equal(normalizeCustomerPhone('not a phone').success, false);
});

test('parses Moscow trip date into UTC and rejects past or impossible dates', () => {
  const now = new Date('2026-09-22T09:00:00.000Z');
  assert.deepEqual(parseMoscowTripDate('23.09.2026 09:30', now), {
    success: true,
    value: '2026-09-23T06:30:00.000Z',
  });
  assert.equal(parseMoscowTripDate('31.02.2026 09:30', now).success, false);
  assert.equal(parseMoscowTripDate('21.09.2026 09:30', now).success, false);
});

test('validates weight and integer ruble price', () => {
  assert.deepEqual(parsePatientWeight('85 кг'), { success: true, value: 85 });
  assert.equal(parsePatientWeight('0').success, false);
  assert.deepEqual(parsePriceRub('7 500 ₽'), { success: true, value: 7500 });
  assert.equal(parsePriceRub('7.5').success, false);
});
