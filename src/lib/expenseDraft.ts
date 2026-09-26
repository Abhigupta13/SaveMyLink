/**
 * Client-safe expense import types and helpers — no Node fs, no LLM imports.
 */
import type { ExpenseCategory, ExpenseClassification, ExpenseFlow } from '@/lib/models/Expense';

export type ExpenseDraft = {
  title: string;
  amount: number;
  currency: string;
  date: string;
  category: ExpenseCategory;
  classification: ExpenseClassification;
  flow: ExpenseFlow;
  merchant?: string;
  notes?: string;
};

export type ExpenseImportSummary = {
  totalOut: number;
  totalIn: number;
  cashbackTotal: number;
};

export function summarizeDrafts(expenses: ExpenseDraft[]): ExpenseImportSummary {
  let totalOut = 0;
  let totalIn = 0;
  let cashbackTotal = 0;
  for (const e of expenses) {
    if (e.flow === 'in') {
      totalIn += e.amount;
      if (e.category === 'cashback' || /cash\s*back|cashback|reward/i.test(e.title)) {
        cashbackTotal += e.amount;
      }
    } else {
      totalOut += e.amount;
    }
  }
  return { totalOut, totalIn, cashbackTotal };
}
