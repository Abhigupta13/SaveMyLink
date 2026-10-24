'use client';

export type SmsSavedKind = 'note' | 'task' | 'expense';

export type SmsSavedRecord = {
  smsId: string;
  savedAs: SmsSavedKind;
  savedAt: string;
};

const KEY = 'sms_saved_records';
const MAX = 500;

async function readAll(): Promise<SmsSavedRecord[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return [];
    const parsed = JSON.parse(value) as SmsSavedRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SmsSavedRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

async function writeAll(rows: SmsSavedRecord[]): Promise<void> {
  const trimmed = rows.slice(-MAX);
  const payload = JSON.stringify(trimmed);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: KEY, value: payload });
  } catch {
    try {
      localStorage.setItem(KEY, payload);
    } catch { /* private mode */ }
  }
}

export async function getSavedSmsIdSet(): Promise<Set<string>> {
  const rows = await readAll();
  return new Set(rows.map(r => r.smsId));
}

export async function markSmsSaved(smsId: string, savedAs: SmsSavedKind): Promise<void> {
  const rows = await readAll();
  const next = rows.filter(r => r.smsId !== smsId);
  next.push({ smsId, savedAs, savedAt: new Date().toISOString() });
  await writeAll(next);
}

export async function clearSavedSmsMarks(): Promise<void> {
  await writeAll([]);
}
