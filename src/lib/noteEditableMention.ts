/**
 * Caret-anchored `@` mentions inside a contentEditable note body (see mentionTrigger.ts).
 */

import type { MentionTrigger } from '@/lib/mentionTrigger';

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function escapeHtmlText(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getEditorPlainCaret(editor: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editor.contains(sel.anchorNode)) return null;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.setEnd(sel.anchorNode!, sel.anchorOffset);
  return range.toString().length;
}

function resolvePlainOffset(root: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let n = walker.nextNode() as Text | null;
  while (n) {
    const len = n.data.length;
    if (seen + len >= offset) return { node: n, offset: Math.max(0, offset - seen) };
    seen += len;
  }
  if (offset === seen && root.lastChild) {
    const tail = document.createTextNode('');
    root.appendChild(tail);
    return { node: tail, offset: 0 };
  }
  return null;
}

export function replacePlainRange(editor: HTMLElement, start: number, end: number, html: string) {
  const a = resolvePlainOffset(editor, start);
  const b = resolvePlainOffset(editor, end);
  if (!a || !b) return;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  range.deleteContents();
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  range.insertNode(tpl.content);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function insertMentionHtml(
  editor: HTMLElement,
  open: MentionTrigger,
  caretPlain: number,
  label: string,
) {
  const safeLabel = label.trim();
  if (!safeLabel) return;
  const html =
    `<span class="note-mention" contenteditable="false" data-mention="${escapeAttr(safeLabel)}">@${escapeHtmlText(safeLabel)}</span>&nbsp;`;
  replacePlainRange(editor, open.tokenStart, caretPlain, html);
}

export function plainTextBeforeCaret(editor: HTMLElement, caretPlain: number): string {
  const range = document.createRange();
  range.selectNodeContents(editor);
  const end = resolvePlainOffset(editor, caretPlain);
  if (!end) return editor.innerText.slice(0, caretPlain);
  range.setEnd(end.node, end.offset);
  return range.toString();
}
