'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Expense, { ExpenseCategory, ExpenseClassification } from "@/lib/models/Expense";
import { privateFilter, privacyOnWrite } from "@/lib/privacy";
import { hasSafe } from "@/lib/safeCookie";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

export interface ExpenseInput {
  title: string;
  amount: number;
  currency?: string;
  date?: string;
  category?: ExpenseCategory;
  classification?: ExpenseClassification;
  merchant?: string;
  notes?: string;
  isPrivate?: boolean;
  projectId?: string;
}

export async function createExpense(data: ExpenseInput) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const title = String(data.title || '').trim();
    const amount = Number(data.amount);
    if (!title) return { success: false, error: 'Title is required' };
    if (isNaN(amount) || amount <= 0) return { success: false, error: 'Valid amount is required' };

    const validCategories: ExpenseCategory[] = ['food', 'health', 'gym', 'travel', 'shopping', 'bills', 'entertainment', 'other'];
    const validClassifications: ExpenseClassification[] = ['expense', 'investment', 'waste'];

    const category = validCategories.includes(data.category as any) ? data.category : 'other';
    const classification = validClassifications.includes(data.classification as any) ? data.classification : 'expense';

    const isPrivate = privacyOnWrite(data.isPrivate, data.projectId);
    const date = data.date ? new Date(data.date) : new Date();

    const expense = await Expense.create({
      title,
      amount,
      currency: data.currency || 'INR',
      date,
      category,
      classification,
      merchant: data.merchant ? String(data.merchant).trim() : undefined,
      notes: data.notes ? String(data.notes).trim() : undefined,
      userId: session.user.id,
      projectId: data.projectId || undefined,
      isPrivate
    });

    revalidatePath('/expenses');
    return { success: true, expense: JSON.parse(JSON.stringify(expense)) };
  } catch (error) {
    console.error('Failed to create expense:', error);
    return { success: false, error: 'Failed to create expense' };
  }
}

export async function updateExpense(id: string, data: Partial<ExpenseInput>) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const expense = await Expense.findOne({ _id: id, userId: session.user.id });
    if (!expense) return { success: false, error: 'Expense not found' };

    if (data.title !== undefined) expense.title = String(data.title).trim();
    if (data.amount !== undefined) {
      const amt = Number(data.amount);
      if (!isNaN(amt) && amt > 0) expense.amount = amt;
    }
    if (data.currency !== undefined) expense.currency = String(data.currency).trim();
    if (data.date !== undefined) expense.date = new Date(data.date);
    if (data.category !== undefined) expense.category = data.category as any;
    if (data.classification !== undefined) expense.classification = data.classification as any;
    if (data.merchant !== undefined) expense.merchant = String(data.merchant).trim();
    if (data.notes !== undefined) expense.notes = String(data.notes).trim();
    if (data.isPrivate !== undefined) {
      expense.isPrivate = privacyOnWrite(data.isPrivate, expense.projectId ? String(expense.projectId) : undefined);
    }

    await expense.save();
    revalidatePath('/expenses');
    return { success: true, expense: JSON.parse(JSON.stringify(expense)) };
  } catch (error) {
    console.error('Failed to update expense:', error);
    return { success: false, error: 'Failed to update expense' };
  }
}

export async function deleteExpense(id: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const result = await Expense.deleteOne({ _id: id, userId: session.user.id });
    if (result.deletedCount === 0) return { success: false, error: 'Expense not found' };

    revalidatePath('/expenses');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete expense:', error);
    return { success: false, error: 'Failed to delete expense' };
  }
}

export async function getExpenses(opts?: {
  period?: 'week' | 'month' | 'year' | 'all';
  category?: string;
  classification?: string;
  search?: string;
  projectId?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const query: any = { userId: session.user.id };

    // Private safe filtering
    if (!opts?.projectId) {
      const unlocked = await hasSafe(session.user.id);
      Object.assign(query, privateFilter(unlocked));
    }

    if (opts?.projectId) {
      query.projectId = opts.projectId;
    }

    if (opts?.category && opts.category !== 'all') {
      query.category = opts.category;
    }

    if (opts?.classification && opts.classification !== 'all') {
      query.classification = opts.classification;
    }

    if (opts?.search) {
      const s = opts.search.trim();
      if (s) {
        query.$or = [
          { title: { $regex: s, $options: 'i' } },
          { merchant: { $regex: s, $options: 'i' } },
          { notes: { $regex: s, $options: 'i' } },
        ];
      }
    }

    if (opts?.period && opts.period !== 'all') {
      const now = new Date();
      let startDate = new Date();

      if (opts.period === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
        startDate = new Date(now.setDate(diff));
        startDate.setHours(0, 0, 0, 0);
      } else if (opts.period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (opts.period === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
      }

      query.date = { $gte: startDate };
    }

    const expenses = await Expense.find(query).sort({ date: -1, createdAt: -1 }).limit(300).lean();

    return { success: true, expenses: JSON.parse(JSON.stringify(expenses)) };
  } catch (error) {
    console.error('Failed to get expenses:', error);
    return { success: false, error: 'Failed to fetch expenses' };
  }
}

export async function getExpenseAnalytics(period: 'week' | 'month' | 'year' = 'month') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const unlocked = await hasSafe(session.user.id);
    const query: any = { userId: session.user.id, ...privateFilter(unlocked) };

    const now = new Date();
    let startDate = new Date();

    if (period === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(now.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    query.date = { $gte: startDate };

    const expenses = await Expense.find(query).lean();

    let totalSpent = 0;
    let totalInvested = 0;
    let totalWasted = 0;
    let totalRegular = 0;

    const categoryBreakdown: Record<string, number> = {
      food: 0,
      health: 0,
      gym: 0,
      travel: 0,
      shopping: 0,
      bills: 0,
      entertainment: 0,
      other: 0,
    };

    const merchantBreakdown: Record<string, number> = {};

    for (const e of expenses) {
      const amt = e.amount || 0;
      totalSpent += amt;

      if (e.classification === 'investment') totalInvested += amt;
      else if (e.classification === 'waste') totalWasted += amt;
      else totalRegular += amt;

      if (categoryBreakdown[e.category] !== undefined) {
        categoryBreakdown[e.category] += amt;
      } else {
        categoryBreakdown.other += amt;
      }

      if (e.merchant) {
        const m = e.merchant.trim();
        merchantBreakdown[m] = (merchantBreakdown[m] || 0) + amt;
      }
    }

    const topMerchants = Object.entries(merchantBreakdown)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      success: true,
      analytics: {
        period,
        count: expenses.length,
        totalSpent,
        totalInvested,
        totalWasted,
        totalRegular,
        categoryBreakdown,
        topMerchants
      }
    };
  } catch (error) {
    console.error('Failed to get expense analytics:', error);
    return { success: false, error: 'Failed to compute analytics' };
  }
}
