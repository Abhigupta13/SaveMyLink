import type { ExpenseCategory, ExpenseFlow } from '@/lib/models/Expense';

export type CategoryOption = { value: ExpenseCategory; label: string; icon: string };

/** Tags for money going out — purchases, bills, transfers paid. */
export const SPEND_CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'food', label: 'Food & Dining', icon: '🍔' },
  { value: 'grocery', label: 'Grocery', icon: '🛒' },
  { value: 'health', label: 'Health & Care', icon: '🩺' },
  { value: 'gym', label: 'Gym & Fitness', icon: '🏋️‍♂️' },
  { value: 'travel', label: 'Travel & Cab', icon: '✈️' },
  { value: 'shopping', label: 'Shopping', icon: '🛍️' },
  { value: 'bills', label: 'Bills & Utilities', icon: '⚡' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { value: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'other', label: 'Other', icon: '📦' },
];

/** Tags for money coming in — salary, rewards, refunds. */
export const RECEIVE_CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'salary', label: 'Salary', icon: '💰' },
  { value: 'cashback', label: 'Cashback & rewards', icon: '💚' },
  { value: 'bills', label: 'Refund / reimbursement', icon: '↩️' },
  { value: 'other', label: 'Other income', icon: '📥' },
];

export function categoryOptionsForFlow(flow: ExpenseFlow): CategoryOption[] {
  return flow === 'in' ? RECEIVE_CATEGORY_OPTIONS : SPEND_CATEGORY_OPTIONS;
}

export function defaultCategoryForFlow(flow: ExpenseFlow): ExpenseCategory {
  return flow === 'in' ? 'salary' : 'food';
}

export function isKnownCategoryForFlow(value: string, flow: ExpenseFlow): boolean {
  return categoryOptionsForFlow(flow).some((c) => c.value === value);
}
