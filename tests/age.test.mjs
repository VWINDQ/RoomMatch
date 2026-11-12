import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAge } from '../src/lib/age.ts';

test('age changes on the birthday, including across the year boundary', () => {
  assert.equal(calculateAge('2002-12-07', new Date(2026, 11, 6)), 23);
  assert.equal(calculateAge('2002-12-07', new Date(2026, 11, 7)), 24);
  assert.equal(calculateAge('2002-12-07', new Date(2026, 11, 8)), 24);
  assert.equal(calculateAge('2002-12-31', new Date(2026, 0, 1)), 23);
  assert.equal(calculateAge('2002-01-01', new Date(2026, 0, 1)), 24);
});

test('leap-day birthdays reach the next full year on March 1 in non-leap years', () => {
  assert.equal(calculateAge('2004-02-29', new Date(2025, 1, 28)), 20);
  assert.equal(calculateAge('2004-02-29', new Date(2025, 2, 1)), 21);
  assert.equal(calculateAge('2004-02-29', new Date(2024, 1, 29)), 20);
});

test('missing, invalid, and future birth dates have no age; newborn age is zero', () => {
  const today = new Date(2026, 10, 12);
  for (const value of ['', 'invalid', '2002-13-01', '2002-02-29', '2026-11-13']) {
    assert.equal(calculateAge(value, today), null, value);
  }
  assert.equal(calculateAge('2026-11-12', today), 0);
});
