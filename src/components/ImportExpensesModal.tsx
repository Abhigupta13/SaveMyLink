'use client';

import React, { useRef, useState } from 'react';
import { X, Upload, Trash2, FileText, AlertCircle } from 'lucide-react';
import { extractExpensesFromFile, importExpensesFromFile } from '@/actions/expense';
import type { ExpenseDraft, ExpenseImportSummary } from '@/lib/expenseDraft';
import { summarizeDrafts } from '@/lib/expenseDraft';
import { ExpenseCategory, ExpenseFlow } from '@/lib/models/Expense';
import { categoryOptionsForFlow, defaultCategoryForFlow, isKnownCategoryForFlow } from '@/lib/expenseCategories';
import { formatLedgerAmount } from '@/lib/expenseFlow';
import { useDialog, dialogProps } from '@/components/ui/useDialog';
import { useFeedback } from '@/components/ui/Feedback';
import { useDriveGate } from '@/components/useDriveGate';
import { goConnectDrive } from '@/lib/driveConnect';

type Step = 'pick' | 'extracting' | 'password' | 'review' | 'importing' | 'done';

interface ImportExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportExpensesModal({
  isOpen,
  onClose,
  onSuccess,
}: ImportExpensesModalProps) {
  const { toast } = useFeedback();
  const ensureDrive = useDriveGate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const [step, setStep] = useState<Step>('pick');
  const [drafts, setDrafts] = useState<ExpenseDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [needsDrive, setNeedsDrive] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; failed: number } | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [summary, setSummary] = useState<ExpenseImportSummary | null>(null);

  const reset = () => {
    setStep('pick');
    setDrafts([]);
    setError(null);
    setWarning(null);
    setNeedsDrive(false);
    setImportResult(null);
    setFileLabel('');
    setPdfPassword('');
    setSummary(null);
    fileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useDialog(isOpen, handleClose);

  if (!isOpen) return null;

  const updateDraft = (index: number, patch: Partial<ExpenseDraft>) => {
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const removeDraft = (index: number) => {
    setDrafts((list) => list.filter((_, i) => i !== index));
  };

  const liveSummary = drafts.length ? summarizeDrafts(drafts) : summary;

  async function runExtract(file: File, password?: string) {
    setError(null);
    setWarning(null);
    setStep('extracting');

    const fd = new FormData();
    fd.append('file', file);
    if (password) fd.append('pdfPassword', password);

    const res = await extractExpensesFromFile(fd);

    if ((res as { needsPassword?: boolean }).needsPassword) {
      const wrong = (res as { wrongPassword?: boolean }).wrongPassword;
      setError(wrong ? (res.error || 'Incorrect PDF password — try again.') : null);
      setStep('password');
      return;
    }

    if (!res.success) {
      const isPdfFile =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const canTryPassword =
        isPdfFile &&
        password === undefined &&
        (res.error === 'Could not read this PDF' ||
          /password|encrypted|protected/i.test(res.error || ''));
      if (canTryPassword) {
        setError(null);
        setStep('password');
        return;
      }
      if (isPdfFile && password !== undefined && res.error === 'Could not read this PDF') {
        setError('Could not unlock this PDF — check the password and try again.');
        setStep('password');
        return;
      }
      setError(res.error || 'No transactions found');
      setStep(password !== undefined ? 'password' : 'pick');
      return;
    }

    const items = res.expenses ?? [];
    if (!items.length) {
      setError('No transactions found in this file');
      setStep(password !== undefined ? 'password' : 'pick');
      return;
    }

    setDrafts(items);
    setSummary(res.summary || summarizeDrafts(items));
    if (res.warning) setWarning(res.warning);
    setStep('review');
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    fileRef.current = file;
    setFileLabel(file.name);
    setPdfPassword('');
    await runExtract(file);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current;
    if (!file) {
      setStep('pick');
      return;
    }
    if (!pdfPassword.trim()) {
      setError('Enter the PDF password');
      return;
    }
    await runExtract(file, pdfPassword.trim());
  }

  async function handleImport() {
    if (!drafts.length) {
      setError('Add at least one expense to import');
      return;
    }
    const file = fileRef.current;
    if (!file) {
      setError('Original file lost — pick the bill again');
      setStep('pick');
      return;
    }

    if (!(await ensureDrive('/expenses'))) return;

    setError(null);
    setNeedsDrive(false);
    setStep('importing');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('expenses', JSON.stringify(drafts));

    const res = await importExpensesFromFile(fd);

    if (!res.success) {
      setError(res.error || 'Import failed');
      setNeedsDrive(!!(res as { needsDrive?: boolean }).needsDrive);
      setStep('review');
      return;
    }

    setImportResult({ created: res.created || 0, failed: res.failed || 0 });
    setStep('done');
    onSuccess();
    if (res.failed && res.failed > 0) {
      toast(`Imported ${res.created} expenses (${res.failed} skipped)`, 'info');
    } else {
      toast(`Imported ${res.created} expense${res.created === 1 ? '' : 's'}`, 'info');
    }
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        {...dialogProps}
        aria-label="Import expenses from file"
        style={{ maxWidth: '560px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">Import from file</h2>
          <button className="modal-close" onClick={handleClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '0 4px 16px', overflowY: 'auto', flex: 1 }}>
          {step === 'done' && importResult ? (
            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✓</div>
              <h3 style={{ fontWeight: 800, marginBottom: '8px' }}>Import complete</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Saved {importResult.created} expense{importResult.created === 1 ? '' : 's'}.
                {importResult.failed > 0 && ` ${importResult.failed} could not be saved.`}
                {' '}Your bill is in Google Drive under <strong>ALL-YOU-NEED/bills</strong>.
              </p>
              <button className="btn-primary" onClick={handleClose} style={{ marginTop: '20px', width: '100%' }}>
                Done
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
                Upload a credit-card statement, bank PDF, CSV export, or receipt photo. We extract line items for you to
                review before saving. Max 4MB. Google Drive must be connected to store the bill.
              </p>

              {error && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: 'var(--accent-text-danger, #ef4444)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    marginBottom: '12px',
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                  }}
                >
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>
                    {error}
                    {needsDrive && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="subtle-link"
                          onClick={() => goConnectDrive('/expenses')}
                          style={{ fontWeight: 800 }}
                        >
                          Connect Google Drive
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )}

              {warning && !error && (
                <p style={{ fontSize: '0.8rem', color: 'var(--accent-color)', marginBottom: '12px', fontWeight: 600 }}>
                  {warning}
                </p>
              )}

              {step === 'password' && (
                <form onSubmit={handlePasswordSubmit} style={{ display: 'grid', gap: '12px' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                    <strong>{fileLabel}</strong> is password-protected. Enter the password to read transactions.
                  </p>
                  <input
                    type="password"
                    className="field"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    placeholder="PDF password"
                    autoFocus
                    autoComplete="off"
                  />
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => { setStep('pick'); setError(null); }} style={{ padding: '9px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: 700 }}>
                      Back
                    </button>
                    <button type="submit" className="btn-primary" style={{ padding: '9px 20px', borderRadius: '12px', fontWeight: 800 }}>
                      Unlock & extract
                    </button>
                  </div>
                </form>
              )}

              {(step === 'pick' || step === 'extracting') && (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                  onClick={() => step !== 'extracting' && fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-color)',
                    borderRadius: '12px',
                    padding: '36px 20px',
                    textAlign: 'center',
                    cursor: step === 'extracting' ? 'wait' : 'pointer',
                    opacity: step === 'extracting' ? 0.7 : 1,
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.csv,.txt,.md,image/jpeg,image/png,image/webp,application/pdf,text/csv"
                    style={{ display: 'none' }}
                    onChange={handleFilePick}
                    disabled={step === 'extracting'}
                  />
                  {step === 'extracting' ? (
                    <>
                      <Upload size={32} style={{ color: 'var(--accent-color)', marginBottom: '10px' }} />
                      <p style={{ fontWeight: 700 }}>Extracting expenses…</p>
                      {fileLabel && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px' }}>{fileLabel}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <FileText size={32} style={{ color: 'var(--accent-color)', marginBottom: '10px' }} />
                      <p style={{ fontWeight: 700 }}>Click to choose PDF, CSV, or receipt image</p>
                      {fileLabel && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px' }}>{fileLabel}</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'review' || step === 'importing' ? (
                <>
                  {fileLabel && (
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-secondary)',
                        marginBottom: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <FileText size={14} /> {fileLabel}
                      <button
                        type="button"
                        className="subtle-link"
                        style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
                        disabled={step === 'importing'}
                        onClick={() => {
                          reset();
                        }}
                      >
                        Change file
                      </button>
                    </div>
                  )}

                  {liveSummary && (
                    <div
                      className="card"
                      style={{
                        padding: '12px 14px',
                        marginBottom: '12px',
                        display: 'grid',
                        gap: '8px',
                        gridTemplateColumns: '1fr 1fr',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Spent (out)</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--accent-text-danger, #ef4444)' }}>
                          −₹{liveSummary.totalOut.toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Received (in)</div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--accent-text-success, #16a34a)' }}>
                          +₹{liveSummary.totalIn.toLocaleString('en-IN')}
                        </div>
                        {liveSummary.cashbackTotal > 0 && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--accent-text-success, #16a34a)', fontWeight: 700, marginTop: '2px' }}>
                            incl. ₹{liveSummary.cashbackTotal.toLocaleString('en-IN')} cashback
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <p style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Review {drafts.length} transaction{drafts.length === 1 ? '' : 's'} — edit before importing
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                    {drafts.map((d, i) => (
                      <div
                        key={i}
                        className="card"
                        style={{
                          padding: '12px',
                          display: 'grid',
                          gap: '8px',
                          borderLeft: `3px solid ${d.flow === 'in' ? 'var(--accent-text-success, #16a34a)' : 'var(--accent-text-danger, #ef4444)'}`,
                        }}
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={d.title}
                            disabled={step === 'importing'}
                            onChange={(e) => updateDraft(i, { title: e.target.value })}
                            className="field"
                            style={{ flex: 1, fontWeight: 700 }}
                            placeholder="Title"
                          />
                          <button
                            type="button"
                            className="icon-btn danger"
                            disabled={step === 'importing'}
                            onClick={() => removeDraft(i)}
                            title="Remove"
                            aria-label="Remove row"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="segmented" role="radiogroup" aria-label="Money direction" style={{ display: 'flex', gap: '6px' }}>
                          {(['out', 'in'] as ExpenseFlow[]).map((f) => (
                            <button
                              key={f}
                              type="button"
                              role="radio"
                              aria-checked={d.flow === f}
                              disabled={step === 'importing'}
                              className={`segment ${d.flow === f ? 'on' : ''}`}
                              style={{ flex: 1, fontSize: '0.78rem', fontWeight: 800 }}
                              onClick={() => {
                                const patch: Partial<ExpenseDraft> = { flow: f };
                                if (!isKnownCategoryForFlow(d.category, f)) {
                                  patch.category = defaultCategoryForFlow(f);
                                }
                                updateDraft(i, patch);
                              }}
                            >
                              {f === 'out' ? 'Spent (−)' : 'Received (+)'}
                            </button>
                          ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            value={d.amount}
                            disabled={step === 'importing'}
                            onChange={(e) => updateDraft(i, { amount: Math.abs(parseFloat(e.target.value) || 0) })}
                            className="field"
                            placeholder="Amount"
                          />
                          <span
                            style={{
                              fontWeight: 900,
                              fontSize: '0.95rem',
                              textAlign: 'right',
                              color: d.flow === 'in' ? 'var(--accent-text-success, #16a34a)' : 'var(--accent-text-danger, #ef4444)',
                            }}
                          >
                            {formatLedgerAmount(d.amount, d.flow)}
                          </span>
                        </div>

                        <input
                          type="date"
                          value={d.date}
                          disabled={step === 'importing'}
                          onChange={(e) => updateDraft(i, { date: e.target.value })}
                          className="field"
                        />

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <input
                            type="text"
                            value={d.merchant || ''}
                            disabled={step === 'importing'}
                            onChange={(e) => updateDraft(i, { merchant: e.target.value })}
                            className="field"
                            placeholder="Merchant (optional)"
                          />
                          <select
                            value={d.category}
                            disabled={step === 'importing'}
                            onChange={(e) => updateDraft(i, { category: e.target.value as ExpenseCategory })}
                            className="field"
                          >
                            {categoryOptionsForFlow(d.flow).map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <input
                          type="text"
                          value={d.notes || ''}
                          disabled={step === 'importing'}
                          onChange={(e) => updateDraft(i, { notes: e.target.value })}
                          className="field"
                          placeholder="Notes (optional)"
                          style={{ fontSize: '0.85rem' }}
                        />
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={handleClose} disabled={step === 'importing'} style={{ padding: '9px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: 700, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={step === 'importing' || !drafts.length}
                      onClick={handleImport}
                      style={{ padding: '9px 20px', borderRadius: '12px', fontWeight: 800 }}
                    >
                      {step === 'importing' ? 'Importing…' : `Import ${drafts.length} expense${drafts.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
