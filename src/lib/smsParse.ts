/** Last significant digits for matching Indian numbers in contacts. */
export function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
}

export function phonesMatch(a: string, b: string): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (da.length < 6 || db.length < 6) return false;
  return da === db;
}

/** Suggest an INR amount from bank/payment SMS wording. User must still confirm. */
export function suggestAmountFromSms(body: string): number | null {
  const patterns = [
    /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:debited|credited|paid|received)\s*(?:by|for|of)?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\b(?:₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m?.[1]) {
      const n = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

export function firstLine(text: string, max = 80): string {
  const line = text.split(/\r?\n/)[0]?.trim() || text.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
