import { chatJSON, getEnvKey, parseLooseJSON } from '@/lib/llm';
import { MAX_DOC_TEXT } from '@/lib/docText';
import type { ExpenseCategory, ExpenseClassification, ExpenseFlow } from '@/lib/models/Expense';
import type { ExpenseDraft } from '@/lib/expenseDraft';

export type { ExpenseDraft, ExpenseImportSummary } from '@/lib/expenseDraft';
export { summarizeDrafts } from '@/lib/expenseDraft';

/** App folder label on Document rows for imported bills (Drive path is `bills/`). */
export const BILLS_DOCUMENT_FOLDER = 'Bills';

export const EXPENSE_IMPORT_MAX = 50;

const KNOWN_CATEGORIES = new Set<string>([
  'food', 'grocery', 'health', 'gym', 'travel', 'shopping', 'bills', 'maintenance', 'entertainment', 'cashback', 'salary', 'other',
]);

const KNOWN_CLASSIFICATIONS = new Set<string>(['expense', 'investment', 'waste']);

const SYSTEM = `You extract money movements from bank statements, credit-card bills (e.g. HDFC), receipts, or spreadsheets.
Return ONLY JSON:
{"expenses":[{"title":"short description","amount":123.45,"currency":"INR","date":"YYYY-MM-DD","flow":"in|out","category":"food|grocery|health|gym|travel|shopping|bills|maintenance|entertainment|cashback|salary|other","classification":"expense|investment|waste","merchant":"optional payee","notes":"optional detail"}]}

Rules:
- One object per distinct transaction line on the statement (purchases, fees, cashback, rewards, refunds).
- flow "out" = charges, purchases, payments you made, money sent to someone.
- flow "in" = cashback, reward points converted to rupees, refunds, salary credits, money received.
- For HDFC-style bills: every retail charge is flow "out"; SmartBuy cashback / CashBack / Reward redemption lines are flow "in" with category "cashback".
- amount is always a positive number (absolute value).
- Skip opening balance, closing balance, total due, and "payment received" toward the card bill (that is paying the card, not a new expense).
- date: transaction date when present; never invent future dates.
- classification: default "expense"; "investment" only for clear investments; "waste" only when clearly discretionary waste.
- Cap at ${EXPENSE_IMPORT_MAX} items; prefer real transaction lines if there are more.
- If nothing valid, return {"expenses":[]}.`;

const VISION_PROMPT = `${SYSTEM}

The user attached a photo or scan of a receipt or bill. Read every line item you can see.`;

const VISION_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const VISION_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cols.push(current.trim());
  return cols.map((col) => col.replace(/^["']|["']$/g, ''));
}

function parseAmount(raw: string): number | null {
  const cleaned = String(raw || '').replace(/[₹,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return !isNaN(n) && n !== 0 ? Math.abs(n) : null;
}

function inferFlow(raw: Record<string, unknown>, title: string): ExpenseFlow {
  const explicit = String(raw.flow || raw.direction || '').trim().toLowerCase();
  if (explicit === 'in' || explicit === 'credit' || explicit === 'income') return 'in';
  if (explicit === 'out' || explicit === 'debit' || explicit === 'expense') return 'out';
  const t = title.toLowerCase();
  if (/cash\s*back|cashback|reward|refund|reversal|credit\s+adj|salary|received|reimbursement/.test(t)) return 'in';
  return 'out';
}

function normalizeDate(raw: string): string {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

export function normalizeExpenseDraft(raw: Record<string, unknown>): ExpenseDraft | null {
  const title = String(raw.title || raw.description || '').trim();
  const amount = typeof raw.amount === 'number' ? raw.amount : parseAmount(String(raw.amount ?? ''));
  if (!title || amount == null || amount <= 0) return null;

  let category = String(raw.category || 'other').trim().toLowerCase();
  if (!KNOWN_CATEGORIES.has(category)) category = 'other';

  let classification = String(raw.classification || 'expense').trim().toLowerCase();
  if (!KNOWN_CLASSIFICATIONS.has(classification)) classification = 'expense';

  const flow = inferFlow(raw, title);
  if (flow === 'in' && category === 'other' && /cash\s*back|cashback|reward/i.test(title)) {
    category = 'cashback';
  }

  const currency = String(raw.currency || 'INR').trim() || 'INR';
  const date = normalizeDate(String(raw.date || ''));

  const merchant = raw.merchant ? String(raw.merchant).trim() : undefined;
  const notes = raw.notes ? String(raw.notes).trim() : undefined;

  return {
    title: title.slice(0, 200),
    amount,
    currency,
    date,
    category: category as ExpenseCategory,
    classification: classification as ExpenseClassification,
    flow,
    merchant: merchant || undefined,
    notes: notes || undefined,
  };
}

/** Deterministic CSV parse when headers match common export shapes. */
export function parseExpensesFromCsv(text: string): ExpenseDraft[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const amountIdx = headers.findIndex((h) => h === 'amount' || h.includes('amount') || h.includes('debit'));
  const titleIdx = headers.findIndex((h) =>
    ['title', 'description', 'desc', 'narration', 'particulars', 'memo'].some((k) => h === k || h.includes(k))
  );
  const dateIdx = headers.findIndex((h) => h === 'date' || h.includes('date'));
  const merchantIdx = headers.findIndex((h) => h === 'merchant' || h.includes('merchant') || h.includes('payee'));
  const categoryIdx = headers.findIndex((h) => h === 'category' || h.includes('category'));
  const flowIdx = headers.findIndex((h) => h === 'flow' || h === 'direction' || h.includes('type'));

  if (amountIdx === -1 || titleIdx === -1) return [];

  const out: ExpenseDraft[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const draft = normalizeExpenseDraft({
      title: cols[titleIdx],
      amount: cols[amountIdx],
      date: dateIdx >= 0 ? cols[dateIdx] : undefined,
      merchant: merchantIdx >= 0 ? cols[merchantIdx] : undefined,
      category: categoryIdx >= 0 ? cols[categoryIdx] : undefined,
      flow: flowIdx >= 0 ? cols[flowIdx] : undefined,
    });
    if (draft) out.push(draft);
    if (out.length >= EXPENSE_IMPORT_MAX) break;
  }
  return out;
}

export async function extractExpensesFromText(text: string): Promise<
  { ok: true; expenses: ExpenseDraft[] } | { ok: false; error: string }
> {
  const slice = text.slice(0, MAX_DOC_TEXT);
  if (!slice.trim()) return { ok: false, error: 'No readable text in this file' };

  const res = await chatJSON([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: slice },
  ]);
  if (!res.ok) return { ok: false, error: res.error };

  const list = Array.isArray(res.data?.expenses) ? res.data.expenses : [];
  const expenses = list
    .map((row: Record<string, unknown>) => normalizeExpenseDraft(row))
    .filter((d: ExpenseDraft | null): d is ExpenseDraft => !!d)
    .slice(0, EXPENSE_IMPORT_MAX);

  return { ok: true, expenses };
}

export async function extractExpensesFromImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ ok: true; expenses: ExpenseDraft[] } | { ok: false; error: string }> {
  const key = getEnvKey('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'GEMINI_API_KEY not configured — cannot read image receipts' };

  const data = buffer.toString('base64');
  const mime = mimeType || 'image/jpeg';
  let lastError = 'Could not read this image';

  for (const model of VISION_MODELS) {
    let res: Response;
    try {
      res = await fetch(`${VISION_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      lastError = 'Image analysis timed out';
      continue;
    }

    if (!res.ok) {
      lastError = res.status === 429 ? 'Assistant quota used up — try again later' : 'Could not analyze this image';
      continue;
    }

    const body = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const rawText = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const parsed = parseLooseJSON(rawText);
    if (!parsed) {
      lastError = 'Assistant returned something unreadable';
      continue;
    }

    const list = Array.isArray(parsed.expenses) ? parsed.expenses : [];
    const expenses = list
      .map((row: Record<string, unknown>) => normalizeExpenseDraft(row))
      .filter((d: ExpenseDraft | null): d is ExpenseDraft => !!d)
      .slice(0, EXPENSE_IMPORT_MAX);

    return { ok: true, expenses };
  }

  return { ok: false, error: lastError };
}
