import type { ExpenseFlow } from '@/lib/models/Expense';

/** Signed ledger amount: inflows positive, outflows negative. Amount in DB is always absolute. */
export function signedAmount(amount: number, flow: ExpenseFlow = 'out'): number {
  const n = Math.abs(Number(amount) || 0);
  return flow === 'in' ? n : -n;
}

export function formatLedgerAmount(amount: number, flow: ExpenseFlow = 'out', currency = 'INR'): string {
  const signed = signedAmount(amount, flow);
  const prefix = currency === 'INR' ? '₹' : `${currency} `;
  const abs = Math.abs(signed).toLocaleString('en-IN');
  if (signed > 0) return `+${prefix}${abs}`;
  if (signed < 0) return `−${prefix}${abs}`;
  return `${prefix}0`;
}

/** Short rupee label for category chips (e.g. ₹1.2k, ₹3.4L). */
export function formatCompactINR(n: number): string {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return '₹0';
  if (v >= 100_000) {
    const l = v / 100_000;
    return `₹${l >= 10 ? Math.round(l) : l.toFixed(1).replace(/\.0$/, '')}L`;
  }
  if (v >= 1000) {
    const k = v / 1000;
    return `₹${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}
