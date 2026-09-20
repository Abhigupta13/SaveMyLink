'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { createExpense, updateExpense, deleteExpense, ExpenseInput } from '@/actions/expense';
import { ExpenseCategory } from '@/lib/models/Expense';
import { useDialog, dialogProps } from '@/components/ui/useDialog';
import { useFeedback } from '@/components/ui/Feedback';

interface ExpenseItem {
  _id: string;
  title: string;
  amount: number;
  currency?: string;
  date: string;
  category: ExpenseCategory;
  merchant?: string;
  notes?: string;
  isPrivate?: boolean;
}

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: ExpenseItem | null;
  projects?: any[];
  defaultProject?: string;
}

const CATEGORIES: { value: string; label: string; icon: string }[] = [
  { value: 'food', label: 'Food & Dining', icon: '🍔' },
  { value: 'grocery', label: 'Grocery', icon: '🛒' },
  { value: 'health', label: 'Health & Care', icon: '🩺' },
  { value: 'gym', label: 'Gym & Fitness', icon: '🏋️‍♂️' },
  { value: 'travel', label: 'Travel & Cab', icon: '✈️' },
  { value: 'shopping', label: 'Shopping', icon: '🛍️' },
  { value: 'bills', label: 'Bills & Utilities', icon: '⚡' },
  { value: 'maintenance', label: 'Maintenance', icon: '🔧' },
  { value: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'other', label: 'Other', icon: '📦' },
];

export default function AddExpenseModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
  projects = [],
  defaultProject = '',
}: AddExpenseModalProps) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('food');
  const [customCategory, setCustomCategory] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState(defaultProject);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, toast } = useFeedback();

  useDialog(isOpen, onClose);

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || '');
      setAmount(initialData.amount ? String(initialData.amount) : '');
      const isKnown = CATEGORIES.some(c => c.value === initialData.category);
      if (isKnown) {
        setCategory(initialData.category || 'food');
        setCustomCategory('');
      } else {
        setCategory('other');
        setCustomCategory(initialData.category || '');
      }
      setMerchant(initialData.merchant || '');
      setDate(
        initialData.date
          ? new Date(initialData.date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
      );
      setNotes(initialData.notes || '');
    } else {
      setTitle('');
      setAmount('');
      setCategory('food');
      setCustomCategory('');
      setMerchant('');
      setDate(new Date().toISOString().split('T')[0]);
      setNotes('');
      setProjectId(defaultProject);
    }
    setError(null);
  }, [initialData, isOpen, defaultProject]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!title.trim()) {
      setError('Please enter an expense title');
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const selectedCategory = (category === 'other' && customCategory.trim()) 
      ? customCategory.trim().toLowerCase() 
      : category;

    setLoading(true);

    try {
      const payload: ExpenseInput = {
        title: title.trim(),
        amount: parsedAmount,
        currency: 'INR',
        category: selectedCategory as ExpenseCategory,
        merchant: merchant.trim() || undefined,
        date,
        notes: notes.trim() || undefined,
        isPrivate: false,
      };

      const res = initialData
        ? await updateExpense(initialData._id, payload)
        : await createExpense(payload);

      if (!res.success) {
        setError(res.error || 'Failed to save expense');
      } else {
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!initialData) return;
    if (!(await confirm({ title: 'Delete this expense entry?', danger: true, confirmLabel: 'Delete' }))) return;
    setLoading(true);
    setError(null);
    try {
      const res = await deleteExpense(initialData._id);
      if (!res.success) {
        setError(res.error || 'Failed to delete expense');
      } else {
        toast('Expense entry deleted', 'info');
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        {...dialogProps}
        aria-label="Add or edit expense"
      >
        <div className="modal-header">
          <h2 className="modal-title">{initialData ? 'Edit Expense' : 'Add Expense Entry'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
              }}
            >
              {error}
            </div>
          )}

          {/* Amount & Title */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Amount (₹)
              </label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="field"
                style={{ fontWeight: 800, fontSize: '1rem' }}
                required
                autoFocus
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Title / Description
              </label>
              <input
                type="text"
                placeholder="e.g. Swiggy Dinner, Groceries..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field"
                required
              />
            </div>
          </div>

          {/* Category Picker */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Category Tag
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid var(--accent-color, #2563eb)' : '1px solid var(--border-color)',
                      background: isSelected ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isSelected ? 800 : 600,
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      justifyContent: 'center',
                    }}
                  >
                    <span>{cat.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cat.label.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
            {category === 'other' && (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="Enter custom category name (e.g. Subscriptions, Pet...)"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="field"
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
            )}
          </div>

          {/* Merchant & Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Merchant / Paid To (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Amazon, Flipkart..."
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="field"
                required
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
              Notes (Optional)
            </label>
            <input
              type="text"
              placeholder="Receipt details, item breakdown..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field"
            />
          </div>



          {/* Submit Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
            {initialData ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                style={{
                  padding: '9px 14px',
                  borderRadius: '12px',
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: 'var(--accent-text-danger, #ef4444)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Trash2 size={15} />
                Delete
              </button>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 16px',
                borderRadius: '12px',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{
                padding: '9px 20px',
                borderRadius: '12px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              <span>{loading ? 'Saving...' : initialData ? 'Update Entry' : 'Save Expense'}</span>
            </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
