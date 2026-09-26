'use server';

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/mongodb";
import Expense, { ExpenseCategory, ExpenseClassification, ExpenseFlow } from "@/lib/models/Expense";
import { privateFilter, privacyOnWrite } from "@/lib/privacy";
import { hasSafe } from "@/lib/safeCookie";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { extractText } from "@/lib/docText";
import {
  BILLS_DOCUMENT_FOLDER,
  type ExpenseDraft,
  extractExpensesFromImage,
  extractExpensesFromText,
  normalizeExpenseDraft,
  parseExpensesFromCsv,
  summarizeDrafts,
} from "@/lib/expenseExtract";
import { extractPdfText, isPdf, pdfBufferLooksEncrypted } from "@/lib/pdfText";
import { Document } from "@/lib/models/Document";
import { Project } from "@/lib/models/Project";
import { projectForWriter } from "@/lib/projectAccess";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/storage";
import { grantProjectReaders } from "@/lib/driveGrants";

const VALID_CLASSIFICATIONS: ExpenseClassification[] = ['expense', 'investment', 'waste'];

const KNOWN_CATEGORIES = new Set([
  'food', 'grocery', 'health', 'gym', 'travel', 'shopping', 'bills', 'maintenance', 'entertainment', 'other',
]);

function normalizeCategory(category?: string): ExpenseCategory {
  const c = String(category || 'other').trim().toLowerCase();
  if (KNOWN_CATEGORIES.has(c)) return c as ExpenseCategory;
  return c ? (c as ExpenseCategory) : 'other';
}

function normalizeClassification(classification?: string): ExpenseClassification {
  const c = String(classification || 'expense').trim().toLowerCase();
  return VALID_CLASSIFICATIONS.includes(c as ExpenseClassification) ? (c as ExpenseClassification) : 'expense';
}

function normalizeFlow(flow?: string): ExpenseFlow {
  return String(flow || 'out').trim().toLowerCase() === 'in' ? 'in' : 'out';
}

/** Shared validation for create + bulk import. */
function validatedExpensePayload(
  data: ExpenseInput,
  userId: string,
  opts?: { receiptDocumentId?: string; projectId?: string },
):
  | { ok: true; doc: Record<string, unknown> }
  | { ok: false; error: string } {
  const title = String(data.title || '').trim();
  const amount = Number(data.amount);
  if (!title) return { ok: false, error: 'Title is required' };
  if (isNaN(amount) || amount <= 0) return { ok: false, error: 'Valid amount is required' };

  const isPrivate = privacyOnWrite(data.isPrivate, opts?.projectId ?? data.projectId);
  const date = data.date ? new Date(data.date) : new Date();

  return {
    ok: true,
    doc: {
      title,
      amount,
      currency: data.currency || 'INR',
      date,
      category: normalizeCategory(data.category),
      classification: normalizeClassification(data.classification),
      flow: normalizeFlow(data.flow),
      merchant: data.merchant ? String(data.merchant).trim() : undefined,
      notes: data.notes ? String(data.notes).trim() : undefined,
      userId,
      projectId: opts?.projectId ?? data.projectId ?? undefined,
      receiptDocumentId: opts?.receiptDocumentId ?? undefined,
      isPrivate,
    },
  };
}

export interface ExpenseInput {
  title: string;
  amount: number;
  currency?: string;
  date?: string;
  category?: ExpenseCategory;
  classification?: ExpenseClassification;
  merchant?: string;
  notes?: string;
  flow?: ExpenseFlow;
  isPrivate?: boolean;
  projectId?: string;
}

export async function createExpense(data: ExpenseInput) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const payload = validatedExpensePayload(data, session.user.id);
    if (!payload.ok) return { success: false, error: payload.error };

    const expense = await Expense.create(payload.doc);

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
    if (data.flow !== undefined) expense.flow = normalizeFlow(data.flow);
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

type ExpensePeriod = 'week' | 'month' | 'year' | 'all';

function periodStartDate(period: ExpensePeriod, now = new Date()): Date | null {
  if (period === 'all') return null;
  let startDate = new Date(now);
  if (period === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(now.getFullYear(), now.getMonth(), diff);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    startDate = new Date(now.getFullYear(), 0, 1);
  }
  return startDate;
}

function analyticsFromLedgerRows(expenses: { amount?: number; flow?: ExpenseFlow; category?: string; classification?: string; merchant?: string }[], period: ExpensePeriod) {
  let totalSpent = 0;
  let totalReceived = 0;
  let totalInvested = 0;
  let totalWasted = 0;
  let totalRegular = 0;
  const categoryBreakdown: Record<string, number> = {};
  const incomeBreakdown: Record<string, number> = {};
  const merchantBreakdown: Record<string, number> = {};

  for (const e of expenses) {
    const amt = e.amount || 0;
    const flow = (e.flow as ExpenseFlow) || 'out';
    const cat = String(e.category || 'other');
    if (flow === 'in') {
      totalReceived += amt;
      incomeBreakdown[cat] = (incomeBreakdown[cat] || 0) + amt;
    } else {
      totalSpent += amt;
      if (e.classification === 'investment') totalInvested += amt;
      else if (e.classification === 'waste') totalWasted += amt;
      else totalRegular += amt;
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + amt;
      if (e.merchant) {
        const m = e.merchant.trim();
        merchantBreakdown[m] = (merchantBreakdown[m] || 0) + amt;
      }
    }
  }

  const topMerchants = Object.entries(merchantBreakdown)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    period,
    count: expenses.length,
    totalSpent,
    totalReceived,
    net: totalReceived - totalSpent,
    totalInvested,
    totalWasted,
    totalRegular,
    categoryBreakdown,
    incomeBreakdown,
    topMerchants,
  };
}

/** One DB round-trip for the personal ledger page (list + analytics for a period). */
export async function getExpensesLedger(period: ExpensePeriod = 'month') {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const unlocked = await hasSafe(session.user.id);
    const query: Record<string, unknown> = {
      userId: session.user.id,
      ...privateFilter(unlocked),
      $and: [{ $or: [{ projectId: { $exists: false } }, { projectId: null }] }],
    };

    const startDate = periodStartDate(period);
    if (startDate) query.date = { $gte: startDate };

    const expenses = await Expense.find(query).sort({ date: -1, createdAt: -1 }).limit(500).lean();
    const analytics = analyticsFromLedgerRows(expenses, period);

    return {
      success: true,
      expenses: JSON.parse(JSON.stringify(expenses)),
      analytics,
    };
  } catch (error) {
    console.error('Failed to get expense ledger:', error);
    return { success: false, error: 'Failed to fetch expenses' };
  }
}

export async function getExpenses(opts?: {
  period?: 'week' | 'month' | 'year' | 'all';
  category?: string;
  classification?: string;
  search?: string;
  projectId?: string;
  /** Personal ledger only — excludes expenses filed under a project group. */
  personalOnly?: boolean;
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

    if (opts?.personalOnly) {
      query.$and = [
        ...(Array.isArray(query.$and) ? query.$and : []),
        { $or: [{ projectId: { $exists: false } }, { projectId: null }] },
      ];
    } else if (opts?.projectId) {
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
        query.$and = [
          ...(Array.isArray(query.$and) ? query.$and : []),
          {
            $or: [
              { title: { $regex: s, $options: 'i' } },
              { merchant: { $regex: s, $options: 'i' } },
              { notes: { $regex: s, $options: 'i' } },
            ],
          },
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

export async function getExpenseAnalytics(
  period: 'week' | 'month' | 'year' | 'all' = 'month',
  opts?: { projectId?: string | null },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const unlocked = await hasSafe(session.user.id);
    const query: Record<string, unknown> = { userId: session.user.id, ...privateFilter(unlocked) };

    const projectId = opts?.projectId?.trim();
    if (projectId) {
      query.projectId = projectId;
    } else if (opts?.projectId !== undefined) {
      query.$or = [{ projectId: { $exists: false } }, { projectId: null }];
    }

    const now = new Date();
    let startDate = new Date();

    if (period !== 'all') {
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
    }

    const expenses = await Expense.find(query).lean();

    let totalSpent = 0;
    let totalReceived = 0;
    let totalInvested = 0;
    let totalWasted = 0;
    let totalRegular = 0;

    const categoryBreakdown: Record<string, number> = {};
    const incomeBreakdown: Record<string, number> = {};

    const merchantBreakdown: Record<string, number> = {};

    for (const e of expenses) {
      const amt = e.amount || 0;
      const flow = (e.flow as ExpenseFlow) || 'out';
      const cat = String(e.category || 'other');
      if (flow === 'in') {
        totalReceived += amt;
        incomeBreakdown[cat] = (incomeBreakdown[cat] || 0) + amt;
      } else {
        totalSpent += amt;
        if (e.classification === 'investment') totalInvested += amt;
        else if (e.classification === 'waste') totalWasted += amt;
        else totalRegular += amt;

        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + amt;

        if (e.merchant) {
          const m = e.merchant.trim();
          merchantBreakdown[m] = (merchantBreakdown[m] || 0) + amt;
        }
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
        totalReceived,
        net: totalReceived - totalSpent,
        totalInvested,
        totalWasted,
        totalRegular,
        categoryBreakdown,
        incomeBreakdown,
        topMerchants
      }
    };
  } catch (error) {
    console.error('Failed to get expense analytics:', error);
    return { success: false, error: 'Failed to compute analytics' };
  }
}

export type CategoryPeriodTotals = { month: number; allTime: number };
export type CategoryTotalsByFlow = {
  out: Record<string, CategoryPeriodTotals>;
  in: Record<string, CategoryPeriodTotals>;
};

/** Month + all-time totals per category for the add-expense picker (respects ledger scope). */
export async function getCategoryTotalsForPicker(opts?: { projectId?: string | null }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    await connectToDatabase();

    const unlocked = await hasSafe(session.user.id);
    const query: Record<string, unknown> = { userId: session.user.id, ...privateFilter(unlocked) };

    const projectId = opts?.projectId?.trim();
    if (projectId) {
      query.projectId = projectId;
    } else {
      query.$or = [{ projectId: { $exists: false } }, { projectId: null }];
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const rows = await Expense.aggregate<{
      _id: { category: string; flow: string };
      month: number;
      allTime: number;
    }>([
      { $match: query },
      {
        $group: {
          _id: {
            category: { $ifNull: ['$category', 'other'] },
            flow: { $ifNull: ['$flow', 'out'] },
          },
          month: {
            $sum: {
              $cond: [{ $gte: ['$date', monthStart] }, '$amount', 0],
            },
          },
          allTime: { $sum: '$amount' },
        },
      },
    ]);

    const out: Record<string, CategoryPeriodTotals> = {};
    const inn: Record<string, CategoryPeriodTotals> = {};

    for (const row of rows) {
      const cat = String(row._id.category || 'other');
      const flow = row._id.flow === 'in' ? 'in' : 'out';
      const bucket = flow === 'in' ? inn : out;
      bucket[cat] = {
        month: (bucket[cat]?.month || 0) + (row.month || 0),
        allTime: (bucket[cat]?.allTime || 0) + (row.allTime || 0),
      };
    }

    return { success: true, totals: { out, in: inn } as CategoryTotalsByFlow };
  } catch (error) {
    console.error('Failed to get category totals:', error);
    return { success: false, error: 'Could not load category totals' };
  }
}

export async function extractExpensesFromFile(formData: FormData) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const file = formData.get('file') as File | null;
    if (!file || !(file instanceof File) || file.size === 0) {
      return { success: false, error: 'Choose a file to import' };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { success: false, error: 'File is too large (max 4MB)' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || '';
    const name = file.name || 'upload';
    const ext = name.toLowerCase();
    const isCsv = mime === 'text/csv' || ext.endsWith('.csv');
    const pdfPassword = String(formData.get('pdfPassword') || '').trim() || undefined;

    let expenses: ExpenseDraft[] = [];
    let warning: string | undefined;

    if (isCsv) {
      const text = buffer.toString('utf8');
      expenses = parseExpensesFromCsv(text);
      if (!expenses.length) {
        const fromLlm = await extractExpensesFromText(text);
        if (!fromLlm.ok) return { success: false, error: fromLlm.error };
        expenses = fromLlm.expenses;
      }
    } else if (isPdf(mime, name)) {
      const pdf = await extractPdfText(buffer, pdfPassword);
      if (!pdf.ok) {
        if (pdf.reason === 'needs_password') {
          return { success: false, needsPassword: true, error: 'This PDF is password-protected. Enter the password to continue.' };
        }
        if (pdf.reason === 'wrong_password') {
          return { success: false, needsPassword: true, wrongPassword: true, error: 'Incorrect PDF password — try again.' };
        }
        if (pdfPassword && pdfBufferLooksEncrypted(buffer)) {
          return {
            success: false,
            needsPassword: true,
            wrongPassword: true,
            error: 'Incorrect PDF password — try again.',
          };
        }
        if (!pdfPassword && pdfBufferLooksEncrypted(buffer)) {
          return {
            success: false,
            needsPassword: true,
            error: 'This PDF is password-protected. Enter the password to continue.',
          };
        }
        return { success: false, error: 'Could not read this PDF' };
      }
      if (!pdf.text.trim()) {
        if (!pdfPassword && pdfBufferLooksEncrypted(buffer)) {
          return {
            success: false,
            needsPassword: true,
            error: 'This PDF is password-protected. Enter the password to continue.',
          };
        }
        return { success: false, error: 'No readable text in this PDF — try a clearer export or enter the password if it is locked.' };
      }
      const fromLlm = await extractExpensesFromText(pdf.text);
      if (!fromLlm.ok) return { success: false, error: fromLlm.error };
      expenses = fromLlm.expenses;
    } else {
      const text = await extractText(buffer, mime, name);
      if (text.trim()) {
        const fromLlm = await extractExpensesFromText(text);
        if (!fromLlm.ok) return { success: false, error: fromLlm.error };
        expenses = fromLlm.expenses;
      } else if (mime.startsWith('image/')) {
        const fromVision = await extractExpensesFromImage(buffer, mime);
        if (!fromVision.ok) return { success: false, error: fromVision.error };
        expenses = fromVision.expenses;
      } else {
        return { success: false, error: 'Could not read this file — try PDF, CSV, text, or a photo of the bill' };
      }
    }

    if (!expenses.length) {
      return { success: false, error: 'No transactions found in this file' };
    }

    if (expenses.length >= 50) warning = 'Showing up to 50 items — review before importing.';

    const summary = summarizeDrafts(expenses);

    return { success: true, expenses, summary, warning };
  } catch (error) {
    console.error('Failed to extract expenses from file:', error);
    return { success: false, error: 'Could not extract expenses from this file' };
  }
}

export async function importExpensesFromFile(formData: FormData) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
    const userId = session.user.id;

    const file = formData.get('file') as File | null;
    const rawExpenses = formData.get('expenses') as string | null;
    const projectId = ((formData.get('projectId') as string) || '').trim();

    if (!file || !(file instanceof File) || file.size === 0) {
      return { success: false, error: 'File missing — pick the bill again and retry' };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { success: false, error: 'File is too large (max 4MB)' };
    }

    let drafts: ExpenseDraft[] = [];
    try {
      const parsed = JSON.parse(rawExpenses || '[]');
      if (!Array.isArray(parsed) || !parsed.length) {
        return { success: false, error: 'No expenses selected to import' };
      }
      drafts = parsed
        .map((row: Record<string, unknown>) => normalizeExpenseDraft(row))
        .filter((d): d is ExpenseDraft => !!d);
    } catch {
      return { success: false, error: 'Invalid expense data' };
    }

    if (!drafts.length) return { success: false, error: 'No valid expenses to import' };

    await connectToDatabase();

    if (projectId && !(await projectForWriter(projectId, userId, session.user.email))) {
      return { success: false, error: 'Not a member of that project' };
    }

    const projectName = projectId
      ? (await Project.findById(projectId).select('name').lean<{ name?: string } | null>())?.name
      : null;

    const saved = await saveUpload(userId, file, { source: 'expense', projectName });
    if (!saved.ok) {
      return {
        success: false,
        error: saved.message,
        needsDrive: saved.reason === 'no_drive' || saved.reason === 'drive_revoked',
      };
    }

    const docText = await extractText(saved.buffer, saved.mimeType, file.name);

    const doc = await Document.create({
      user: userId,
      projectId: projectId || undefined,
      name: file.name,
      folder: BILLS_DOCUMENT_FOLDER,
      type: 'file',
      url: saved.url,
      key: saved.key,
      mimeType: saved.mimeType,
      size: saved.size,
      text: docText,
      isPrivate: false,
    });

    grantProjectReaders({
      projectId,
      uploaderId: userId,
      uploaderEmail: session.user.email,
      keys: [saved.key],
    });

    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const draft of drafts) {
      const input: ExpenseInput = {
        title: draft.title,
        amount: draft.amount,
        currency: draft.currency,
        date: draft.date,
        category: draft.category,
        classification: draft.classification,
        flow: draft.flow,
        merchant: draft.merchant,
        notes: draft.notes,
        isPrivate: false,
        projectId: projectId || undefined,
      };
      const payload = validatedExpensePayload(input, userId, {
        receiptDocumentId: String(doc._id),
        projectId: projectId || undefined,
      });
      if (!payload.ok) {
        failed++;
        errors.push(payload.error);
        continue;
      }
      try {
        await Expense.create(payload.doc);
        created++;
      } catch {
        failed++;
        errors.push(`Could not save "${draft.title}"`);
      }
    }

    revalidatePath('/expenses');
    revalidatePath('/d-locker');

    if (created === 0) {
      return { success: false, error: errors[0] || 'Import failed', failed, documentId: String(doc._id) };
    }

    return {
      success: true,
      created,
      failed,
      documentId: String(doc._id),
      errors: errors.length ? errors : undefined,
    };
  } catch (error) {
    console.error('Failed to import expenses from file:', error);
    return { success: false, error: 'Failed to import expenses' };
  }
}
