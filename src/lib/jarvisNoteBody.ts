import { sanitizeNoteBody, looksLikeNoteHtml } from '@/lib/noteHtml';

/** Horizontal rule — same markup the rich editor inserts. */
export const NOTE_DIVIDER_HTML = '<hr class="note-divider" contenteditable="false" />';

export function escapeNotePlainText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ChecklistItem = { text: string; checked?: boolean };

export function noteChecklistHtml(
  items: ChecklistItem[],
  opts?: { dividerBefore?: boolean; dividerAfter?: boolean },
): string {
  if (!items.length) return '';
  const before = opts?.dividerBefore !== false;
  const after = opts?.dividerAfter !== false;
  const lis = items
    .map(it => {
      const tick = it.checked ? ' checked' : '';
      return `<li><input type="checkbox" contenteditable="false"${tick} /> ${escapeNotePlainText(it.text)}</li>`;
    })
    .join('');
  const list = `<ul class="note-checklist">${lis}</ul>`;
  return [before ? NOTE_DIVIDER_HTML : '', list, after ? NOTE_DIVIDER_HTML : ''].filter(Boolean).join('');
}

export function noteTableHtml(rows: string[][], headerRow = true): string {
  if (!rows.length) return '';
  const bodyRows = headerRow ? rows.slice(1) : rows;
  const head = headerRow && rows[0]?.length
    ? `<thead><tr>${rows[0].map(c => `<th>${escapeNotePlainText(c)}</th>`).join('')}</tr></thead>`
    : '';
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows.map(r => `<tr>${r.map(c => `<td>${escapeNotePlainText(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '<tbody><tr><td> </td><td> </td></tr></tbody>';
  return `<table class="note-table">${head}${tbody}</table>`;
}

const CHECKLIST_LINE =
  /^\s*(?:[-*•]\s*)?(?:\[( |x|X)\]\s*)?(.+)$/;

function parseChecklistLine(line: string): ChecklistItem | null {
  const m = line.match(CHECKLIST_LINE);
  if (!m?.[2]?.trim()) return null;
  const checked = /\[(x|X)\]/.test(line);
  return { text: m[2].trim(), checked };
}

function blockIsChecklist(lines: string[]): ChecklistItem[] | null {
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const item = parseChecklistLine(line);
    if (!item) return null;
    items.push(item);
  }
  return items.length ? items : null;
}

/** GitHub-style pipe table inside one paragraph block. */
function tryMarkdownTable(block: string): string | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  if (!lines.every(l => l.includes('|'))) return null;
  const split = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim());
  if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(lines[1])) return null;
  const rows = [split(lines[0]), ...lines.slice(2).map(split)];
  if (rows.some(r => !r.length || r.every(c => !c))) return null;
  return noteTableHtml(rows, true);
}

function plainParagraphHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return `<p>${escapeNotePlainText(trimmed).replace(/\n/g, '<br>')}</p>`;
}

/**
 * Turn Jarvis note text into stored note HTML: keep model-supplied HTML, or build
 * checklists (with dividers before and after) and tables from plain / markdown shapes.
 */
export function prepareNoteBodyFromJarvis(raw: string): string {
  const t = (raw || '').trim();
  if (!t) return '';

  if (looksLikeNoteHtml(t) || /<(hr|table|ul)\b/i.test(t)) {
    return sanitizeNoteBody(t);
  }

  const blocks = t.split(/\n{2,}/);
  const parts: string[] = [];

  for (const block of blocks) {
    const table = tryMarkdownTable(block);
    if (table) {
      parts.push(table);
      continue;
    }

    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const checklist = blockIsChecklist(lines);
    if (checklist) {
      parts.push(noteChecklistHtml(checklist, { dividerBefore: true, dividerAfter: true }));
      continue;
    }

    parts.push(plainParagraphHtml(block));
  }

  return sanitizeNoteBody(parts.filter(Boolean).join(''));
}
