/** Expenses ledger keys + types (storage via clientQueryCache). */

import {
  cacheGet,
  cacheInvalidateNamespace,
  cacheIsFresh,
  cacheSet,
  CLIENT_CACHE,
} from '@/lib/clientQueryCache';
import { AppCacheNs } from '@/lib/appDataCache';

export type ExpensePeriod = 'week' | 'month' | 'year' | 'all';

export type CachedExpenseAnalytics = {
  period: ExpensePeriod;
  count: number;
  totalSpent: number;
  totalReceived: number;
  net: number;
  categoryBreakdown: Record<string, number>;
  incomeBreakdown?: Record<string, number>;
};

export type CachedExpenseLedger = {
  expenses: unknown[];
  analytics: CachedExpenseAnalytics;
  fetchedAt: number;
};

export const LEDGER_FRESH_MS = CLIENT_CACHE.freshMs;

const NS = AppCacheNs.expensesLedger;

export function expenseLedgerCacheKey(period: ExpensePeriod, privateSafe: boolean): string {
  return `${period}:${privateSafe ? '1' : '0'}`;
}

export function getCachedExpenseLedger(key: string): CachedExpenseLedger | null {
  const hit = cacheGet<CachedExpenseLedger>(NS, key);
  if (!hit) return null;
  return { ...hit.data, fetchedAt: hit.fetchedAt };
}

export function setCachedExpenseLedger(
  key: string,
  payload: Pick<CachedExpenseLedger, 'expenses' | 'analytics'>,
): void {
  cacheSet(NS, key, payload);
}

export function invalidateExpenseLedgerCache(): void {
  cacheInvalidateNamespace(NS);
}

export function isLedgerCacheFresh(entry: CachedExpenseLedger): boolean {
  return cacheIsFresh(entry.fetchedAt);
}
