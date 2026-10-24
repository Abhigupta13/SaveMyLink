import { describe, expect, test } from 'vitest';
import { normalizePhoneDigits, phonesMatch, suggestAmountFromSms } from '@/lib/smsParse';

describe('smsParse', () => {
  test('phonesMatch on last ten digits', () => {
    expect(phonesMatch('+91 98765 43210', '9876543210')).toBe(true);
    expect(phonesMatch('123', '456')).toBe(false);
  });

  test('normalizePhoneDigits', () => {
    expect(normalizePhoneDigits('+91-9876543210')).toBe('9876543210');
  });

  test('suggestAmountFromSms', () => {
    expect(suggestAmountFromSms('Debited Rs. 1,250.50 from A/c')).toBe(1250.5);
    expect(suggestAmountFromSms('Hello there')).toBe(null);
  });
});
