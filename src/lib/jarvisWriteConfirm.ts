/** Which Jarvis action types change the vault (held until the user confirms). */

export const JARVIS_WRITE_TYPES = new Set([
  'create_task', 'update_task', 'delete_task',
  'create_note', 'update_note', 'delete_note',
  'create_expense', 'update_expense', 'delete_expense',
  'create_contact', 'update_contact',
  'create_project', 'update_project', 'delete_project',
  'delete_link', 'delete_contact', 'delete_document', 'delete_mom',
  'save_link',
]);

export function isJarvisWriteAction(a: unknown): a is { type: string } {
  return !!a && typeof (a as any).type === 'string' && JARVIS_WRITE_TYPES.has((a as any).type);
}

const norm = (text: string) => text.trim().toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ');

/** User accepted the pending change (voice or text). */
export function jarvisIsConfirm(text: string): boolean {
  const t = norm(text);
  if (!t || jarvisIsDecline(text)) return false;
  if (/^(yes|yeah|yep|yup|ok|okay|confirm|confirmed|sure|right)\.?$/.test(t)) return true;
  if (/\bconfirm(ed)?\s*(it|that)?\b/.test(t) && /\b(yes|yeah|yep|go ahead|do it|ok|okay|sure)\b/.test(t)) return true;
  return /\b(yes|yeah|yep|yup|confirm|confirmed|go ahead|do it|okay|ok|correct|right|sounds good|please do|go for it|absolutely|that s right|you re right|you are right)\b/.test(t);
}

/** User cancelled outright (not a revision with new numbers or titles). */
export function jarvisIsDecline(text: string): boolean {
  const raw = text.trim();
  const t = norm(text);
  if (!t) return false;
  if (/^(no|nope|cancel|stop|wait)\.?$/.test(t)) return true;
  if (/\b(never mind|nevermind|don t do|do not do it|that s wrong|that is wrong|not that one)\b/.test(t)) return true;
  // "No." or "No, don't" — but not "No, make it 400" which is a revision.
  if (/^no\b/i.test(raw) && raw.length < 48 && !/\d{3,}/.test(raw)) return true;
  return false;
}

const str = (v: unknown) => String(v ?? '').trim();

function money(amount: unknown, currency = 'INR') {
  const n = Number(amount);
  if (isNaN(n)) return str(amount) || 'that amount';
  const sym = currency === 'INR' ? '₹' : `${currency} `;
  return `${sym}${n.toLocaleString('en-IN')}`;
}

function describeOne(a: any): string {
  switch (a?.type) {
    case 'create_expense':
      return `log ${money(a.amount)} for "${str(a.title) || 'an expense'}"${a.merchant ? ` (${str(a.merchant)})` : ''}`;
    case 'update_expense':
      return `update expense ${str(a.id).slice(-6) || ''}${a.amount ? ` to ${money(a.amount)}` : ''}${a.title ? ` as "${str(a.title)}"` : ''}`.trim();
    case 'delete_expense':
      return `delete expense ${str(a.id).slice(-6) || 'you named'}`;
    case 'create_task':
      return `add the task "${str(a.title)}"${a.dueAt ? ` due ${str(a.dueAt)}` : ''}`;
    case 'update_task':
      return `update task ${str(a.id).slice(-6) || ''}${a.title ? ` to "${str(a.title)}"` : ''}${a.completed === true || a.completed === 'true' ? ' and mark it done' : ''}`;
    case 'delete_task':
      return `delete task ${str(a.id).slice(-6) || ''}`;
    case 'create_note':
      return `save a note${a.title ? ` titled "${str(a.title)}"` : ''}`;
    case 'update_note':
      return `update note ${str(a.id).slice(-6) || ''}`;
    case 'delete_note':
      return `delete note ${str(a.id).slice(-6) || ''}`;
    case 'save_link':
      return `save the link ${str(a.url) || 'you gave'}`;
    case 'create_contact':
      return `save contact "${str(a.name)}"`;
    case 'update_contact':
      return `update contact ${str(a.id).slice(-6) || ''}`;
    case 'delete_contact':
      return `delete contact ${str(a.id).slice(-6) || ''}`;
    case 'delete_link':
      return `delete link ${str(a.id).slice(-6) || ''}`;
    case 'delete_document':
      return `delete document ${str(a.id).slice(-6) || ''}`;
    case 'delete_mom':
      return `delete meeting ${str(a.id).slice(-6) || ''}${a.alsoDeleteWork ? ' and its tasks/notes' : ''}`;
    case 'create_project':
      return `create project "${str(a.name)}"`;
    case 'update_project':
      return `update project ${str(a.id).slice(-6) || ''}`;
    case 'delete_project':
      return `delete project ${str(a.id).slice(-6) || ''}`;
    default:
      return 'make that change';
  }
}

/** Client cancels this countdown on speech, typing, or revision (see JarvisWidget heldAutoEpoch). */
const CONFIRM_TAIL = 'Confirming in 5 seconds. Interrupt to change.';

export const HELD_NUDGE = 'Still on that — say yes, or say your change.';

/** True when the user is revising a pending write, not apologizing or making small talk. */
export function jarvisLooksLikeRevision(text: string): boolean {
  const t = norm(text);
  if (!t || t.length < 4) return false;
  if (/\d/.test(t)) return true;
  if (/\b(instead|rather|change|make it|call it|rename|correct|wrong|update to|should be|not that|different)\b/.test(t)) return true;
  if (/\b(rupee|rupees|rs\b|inr)\b/.test(t)) return true;
  return false;
}

/** Spoken confirmation before any write runs. Keep it short; this is read aloud. */
export function jarvisConfirmPrompt(actions: unknown[]): string {
  const list = (actions || []).filter(isJarvisWriteAction).map(describeOne);
  if (!list.length) return CONFIRM_TAIL;
  if (list.length === 1) return `${list[0]}. ${CONFIRM_TAIL}`;
  return `${list.join('; ')}. ${CONFIRM_TAIL}`;
}

export function jarvisDoneLine(created: { detail?: string; title?: string }[]): string {
  if (!created.length) return 'Done — I couldn’t apply that after all.';
  const bits = created.map(c => c.detail || c.title).filter(Boolean);
  if (bits.length === 1) return `Yes — ${bits[0]}.`;
  return `Yes — done: ${bits.join('; ')}.`;
}
