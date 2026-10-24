'use client';

import { useMemo, useState } from 'react';
import { createNote } from '@/actions/note';
import { createTask } from '@/actions/task';
import { createExpense } from '@/actions/expense';
import { createContact } from '@/actions/contact';
import { useFeedback } from '@/components/ui/Feedback';
import { firstLine, phonesMatch, suggestAmountFromSms } from '@/lib/smsParse';
import { markSmsSaved, type SmsSavedKind } from '@/lib/smsSavedLocal';
import type { SmsInboxRow } from '@/lib/native/smsInbox';
import { formatDay } from '@/lib/time';
import { X } from 'lucide-react';

type ContactHint = { _id?: string; name: string; phone?: string; email?: string };

export default function SmsSaveReviewSheet({
  message,
  saveAs,
  senderLabel,
  contact,
  queueIndex,
  queueTotal,
  onDone,
  onCancel,
}: {
  message: SmsInboxRow;
  saveAs: SmsSavedKind;
  senderLabel: string;
  contact?: ContactHint | null;
  queueIndex: number;
  queueTotal: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [addContact, setAddContact] = useState(!contact);

  const when = useMemo(
    () => formatDay(new Date(message.date).toISOString()),
    [message.date],
  );

  const [noteTitle, setNoteTitle] = useState(senderLabel);
  const [noteBody, setNoteBody] = useState(
    `${message.body.trim()}\n\n— From SMS · ${senderLabel} · ${when}`,
  );

  const [taskTitle, setTaskTitle] = useState(firstLine(message.body) || senderLabel);
  const [taskDesc, setTaskDesc] = useState(message.body.trim());

  const suggestedAmount = useMemo(() => suggestAmountFromSms(message.body), [message.body]);
  const [expTitle, setExpTitle] = useState(senderLabel);
  const [expAmount, setExpAmount] = useState(suggestedAmount != null ? String(suggestedAmount) : '');
  const [expNotes, setExpNotes] = useState(message.body.trim());
  const [expMerchant, setExpMerchant] = useState(senderLabel);

  const [newContactName, setNewContactName] = useState(senderLabel);

  const save = async () => {
    setSaving(true);
    try {
      if (addContact && !contact && message.address) {
        const name = newContactName.trim() || senderLabel;
        const cr = await createContact({ name, phone: message.address, isPrivate });
        if (!cr.success) {
          toast(cr.error || 'Could not add contact', 'error');
          setSaving(false);
          return;
        }
      }

      if (saveAs === 'note') {
        const res = await createNote({
          title: noteTitle.trim() || senderLabel,
          body: noteBody.trim(),
          isPrivate,
        });
        if (!res.success) {
          toast(res.error || 'Could not save note', 'error');
          setSaving(false);
          return;
        }
      } else if (saveAs === 'task') {
        if (!taskTitle.trim()) {
          toast('Task title is required', 'error');
          setSaving(false);
          return;
        }
        const res = await createTask(taskTitle.trim(), {
          description: taskDesc.trim() || undefined,
          isPrivate,
        });
        if (!res.success) {
          toast(res.error || 'Could not save task', 'error');
          setSaving(false);
          return;
        }
      } else {
        const amount = Number(expAmount.replace(/,/g, ''));
        if (!Number.isFinite(amount) || amount <= 0) {
          toast('Enter a valid amount', 'error');
          setSaving(false);
          return;
        }
        const res = await createExpense({
          title: expTitle.trim() || senderLabel,
          amount,
          merchant: expMerchant.trim() || undefined,
          notes: expNotes.trim() || undefined,
          isPrivate,
        });
        if (!res.success) {
          toast(res.error || 'Could not save expense', 'error');
          setSaving(false);
          return;
        }
      }

      await markSmsSaved(message.id, saveAs);
      toast('Saved', 'success');
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = saveAs === 'note' ? 'Note' : saveAs === 'task' ? 'Task' : 'Expense';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal sheet"
        role="dialog"
        aria-labelledby="sms-review-title"
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: '90vh', overflow: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 id="sms-review-title" className="modal-title" style={{ margin: 0 }}>
              Save as {kindLabel}
            </h2>
            {queueTotal > 1 && (
              <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Message {queueIndex + 1} of {queueTotal}
              </p>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>

        {contact ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Matched contact: <strong style={{ color: 'var(--text-primary)' }}>{contact.name}</strong>
          </p>
        ) : message.address && (
          <label className="set-row" style={{ marginBottom: 12, padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span className="set-row-text">
              <span className="set-row-title">Add {senderLabel} to contacts</span>
              <span className="set-row-sub">{message.address}</span>
            </span>
            <span className="switch">
              <input type="checkbox" checked={addContact} onChange={e => setAddContact(e.target.checked)} />
              <span className="slider round" />
            </span>
          </label>
        )}

        {addContact && !contact && message.address && (
          <input
            className="input"
            value={newContactName}
            onChange={e => setNewContactName(e.target.value)}
            placeholder="Contact name"
            style={{ marginBottom: 12, width: '100%' }}
          />
        )}

        <label className="set-row" style={{ marginBottom: 16 }}>
          <span className="set-row-text">
            <span className="set-row-title">Private Safe</span>
            <span className="set-row-sub">Keep this record behind your PIN</span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
            <span className="slider round" />
          </span>
        </label>

        {saveAs === 'note' && (
          <>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Title</label>
            <input className="input" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Body</label>
            <textarea
              value={noteBody}
              onChange={e => setNoteBody(e.target.value)}
              rows={8}
              style={{
                width: '100%', padding: '14px', borderRadius: '14px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.92rem',
              }}
            />
          </>
        )}

        {saveAs === 'task' && (
          <>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Title</label>
            <input className="input" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Description</label>
            <textarea
              value={taskDesc}
              onChange={e => setTaskDesc(e.target.value)}
              rows={6}
              style={{
                width: '100%', padding: '14px', borderRadius: '14px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.92rem',
              }}
            />
          </>
        )}

        {saveAs === 'expense' && (
          <>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Title</label>
            <input className="input" value={expTitle} onChange={e => setExpTitle(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Amount (INR)</label>
            <input
              className="input"
              inputMode="decimal"
              value={expAmount}
              onChange={e => setExpAmount(e.target.value)}
              placeholder={suggestedAmount != null ? String(suggestedAmount) : 'Required'}
              style={{ width: '100%', marginBottom: 12 }}
            />
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Merchant</label>
            <input className="input" value={expMerchant} onChange={e => setExpMerchant(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, marginBottom: 6 }}>Notes</label>
            <textarea
              value={expNotes}
              onChange={e => setExpNotes(e.target.value)}
              rows={4}
              style={{
                width: '100%', padding: '14px', borderRadius: '14px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.92rem',
              }}
            />
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button type="button" className="btn secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Save ${kindLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function findContactByPhone(
  contacts: ContactHint[],
  address: string,
): ContactHint | null {
  for (const c of contacts) {
    if (c.phone && phonesMatch(c.phone, address)) return c;
  }
  return null;
}
