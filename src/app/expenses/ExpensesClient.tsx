'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Search, Trash2, Edit3, Lock, Wallet, Upload, Info, X, ChevronDown } from 'lucide-react';
import { formatCompactINR, formatLedgerAmount } from '@/lib/expenseFlow';
import { getExpensesLedger, deleteExpense } from '@/actions/expense';
import {
  expenseLedgerCacheKey,
  getCachedExpenseLedger,
  isLedgerCacheFresh,
  setCachedExpenseLedger,
} from '@/lib/expenseLedgerCache';
import { invalidateExpensesCache } from '@/lib/appDataCache';
import AddExpenseModal from '@/components/AddExpenseModal';
import ImportExpensesModal from '@/components/ImportExpensesModal';
import { SafeBanner, SafeEmpty } from '@/components/PrivateSafe';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';
import { useUser } from '@/components/UserContext';
import { hintFor } from '@/lib/nav';
import { formatDay } from '@/lib/time';
import { ExpenseCategory, ExpenseFlow } from '@/lib/models/Expense';

interface ExpenseItem {
  _id: string;
  title: string;
  amount: number;
  currency?: string;
  date: string;
  category: ExpenseCategory;
  flow?: ExpenseFlow;
  merchant?: string;
  notes?: string;
  isPrivate?: boolean;
}

const CATEGORY_MAP: Record<string, { label: string; icon: string }> = {
  food: { label: 'Food & Dining', icon: '🍔' },
  grocery: { label: 'Grocery', icon: '🛒' },
  health: { label: 'Health & Medical', icon: '🩺' },
  gym: { label: 'Gym & Fitness', icon: '🏋️‍♂️' },
  travel: { label: 'Travel & Transport', icon: '✈️' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  bills: { label: 'Bills & Utilities', icon: '⚡' },
  maintenance: { label: 'Maintenance', icon: '🔧' },
  entertainment: { label: 'Entertainment', icon: '🎬' },
  cashback: { label: 'Cashback', icon: '💚' },
  salary: { label: 'Salary', icon: '💰' },
  other: { label: 'Other', icon: '📦' },
};

function filterLedgerExpenses(
  list: ExpenseItem[],
  category: string,
  search: string,
): ExpenseItem[] {
  let out = list;
  if (category !== 'all') out = out.filter((e) => e.category === category);
  const s = search.trim().toLowerCase();
  if (!s) return out;
  return out.filter(
    (e) =>
      e.title?.toLowerCase().includes(s) ||
      (e.merchant && e.merchant.toLowerCase().includes(s)) ||
      (e.notes && e.notes.toLowerCase().includes(s)),
  );
}

export default function ExpensesClient() {
  const { toast, confirm } = useFeedback();
  const { privateSafe } = useUser();
  const { status } = useSession();

  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [ledgerExpenses, setLedgerExpenses] = useState<ExpenseItem[]>([]);

  const [analytics, setAnalytics] = useState<{
    totalSpent: number;
    totalReceived: number;
    net: number;
    count: number;
    categoryBreakdown: Record<string, number>;
    incomeBreakdown?: Record<string, number>;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [jarvisTipOpen, setJarvisTipOpen] = useState(false);
  const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);

  const visibleExpenses = useMemo(
    () => filterLedgerExpenses(ledgerExpenses, selectedCategory, searchQuery),
    [ledgerExpenses, selectedCategory, searchQuery],
  );

  const applyLedgerPayload = useCallback((expenses: ExpenseItem[], nextAnalytics: NonNullable<typeof analytics>) => {
    setLedgerExpenses(expenses);
    setAnalytics(nextAnalytics);
    setFailed(false);
  }, []);

  const loadData = useCallback(async (opts?: { force?: boolean }) => {
    const cacheKey = expenseLedgerCacheKey(period, privateSafe);
    const cached = getCachedExpenseLedger(cacheKey);

    if (cached && !opts?.force) {
      applyLedgerPayload(cached.expenses as ExpenseItem[], cached.analytics);
      setLoading(false);
      if (isLedgerCacheFresh(cached)) return;
      setRefreshing(true);
    } else if (cached) {
      applyLedgerPayload(cached.expenses as ExpenseItem[], cached.analytics);
      setLoading(false);
      setRefreshing(true);
    } else {
      setFailed(false);
      setLoading(true);
    }

    try {
      const res = await getExpensesLedger(period);
      if (res.success && res.expenses && res.analytics) {
        applyLedgerPayload(res.expenses as ExpenseItem[], res.analytics);
        setCachedExpenseLedger(cacheKey, { expenses: res.expenses, analytics: res.analytics });
      } else if (!cached) {
        setFailed(true);
      }
    } catch (err) {
      console.error('Error loading expense data:', err);
      if (!cached) setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, privateSafe, applyLedgerPayload]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadData();
    }
  }, [status, period, privateSafe, loadData]);

  const reloadLedger = useCallback(() => {
    invalidateExpensesCache();
    loadData({ force: true });
  }, [loadData]);

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete this expense entry?', danger: true, confirmLabel: 'Delete' }))) return;
    const res = await deleteExpense(id);
    if (res.success) {
      toast('Expense entry deleted', 'info');
      reloadLedger();
    } else {
      toast(res.error || 'Failed to delete expense', 'error');
    }
  };

  const handleEdit = (item: ExpenseItem) => {
    setEditingExpense(item);
    setIsModalOpen(true);
  };

  const handleAddClick = () => {
    setEditingExpense(null);
    setIsModalOpen(true);
  };

  const periodLabel = period === 'all' ? 'All Time' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'This Year';

  const spentByCategory = analytics?.categoryBreakdown ?? {};
  const categorySpendRows = Object.entries(spentByCategory)
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxCategorySpend = categorySpendRows[0]?.[1] ?? 0;

  const incomeByCategory = analytics?.incomeBreakdown ?? {};
  const incomeRows = Object.entries(incomeByCategory)
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <h1 className="page-title" style={{ marginBottom: 0 }}>Expenses</h1>
            <button
              type="button"
              className="icon-btn"
              aria-label="Jarvis tips for expenses"
              aria-expanded={jarvisTipOpen}
              title="Tips"
              onClick={() => setJarvisTipOpen((o) => !o)}
              style={{ width: 34, height: 34 }}
            >
              <Info size={17} />
            </button>
          </div>
          {jarvisTipOpen && (
            <div
              className="card"
              style={{
                marginTop: '10px',
                padding: '12px 14px',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                position: 'relative',
              }}
            >
              <button
                type="button"
                className="icon-btn"
                aria-label="Close tips"
                onClick={() => setJarvisTipOpen(false)}
                style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28 }}
              >
                <X size={14} />
              </button>
              <p style={{ margin: 0, paddingRight: '28px' }}>
                Ask Jarvis <strong>&quot;What were my food expenses this month?&quot;</strong> or{' '}
                <strong>&quot;Add 350 for dinner on Swiggy&quot;</strong>
              </p>
            </div>
          )}
          <p className="page-subtitle" style={{ marginTop: '4px' }}>
            {ledgerExpenses.length
              ? `${visibleExpenses.length === ledgerExpenses.length ? ledgerExpenses.length : `${visibleExpenses.length} of ${ledgerExpenses.length}`} personal entr${visibleExpenses.length === 1 ? 'y' : 'ies'} · Khatabook style ledger`
              : 'Personal spending & income — not tied to project groups'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Search expenses"
            aria-pressed={searchOpen}
            title="Search"
            onClick={() => {
              setSearchOpen((o) => {
                if (o) setSearchQuery('');
                return !o;
              });
            }}
            style={{
              width: 42,
              height: 42,
              borderRadius: '12px',
              border: searchOpen ? '2px solid var(--accent-color, #2563eb)' : '1px solid var(--border-color)',
              background: searchOpen ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
            }}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 14px',
              borderRadius: '12px',
              fontWeight: 700,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <Upload size={17} /> Import
          </button>
          <button
            className="btn-primary"
            onClick={handleAddClick}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}
          >
            <Plus size={18} /> Add Expense
          </button>
        </div>
      </header>

      <SafeBanner noun="expenses" />

      {/* Ledger summary */}
      <div
        className="card"
        style={{
          marginBottom: '16px',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                padding: '10px',
                borderRadius: '12px',
                background: 'var(--bg-tertiary)',
                color: 'var(--accent-color, #2563eb)',
              }}
            >
              <Wallet size={24} />
            </div>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Money ledger ({periodLabel})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '6px' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Received</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-text-success, #16a34a)' }}>
                    +₹{(analytics?.totalReceived ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Spent</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-text-danger, #ef4444)' }}>
                    −₹{(analytics?.totalSpent ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Net</div>
                  <div
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 900,
                      color: (analytics?.net ?? 0) >= 0 ? 'var(--text-primary)' : 'var(--accent-text-danger, #ef4444)',
                    }}
                  >
                    ₹{(analytics?.net ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-end', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {refreshing && (
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)' }} aria-live="polite">
              Syncing…
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            {(['week', 'month', 'year', 'all'] as const).map((p) => {
              const labels = { week: 'Week', month: 'Month', year: 'Year', all: 'All' };
              const isActive = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      </div>

      {searchOpen && (
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="field"
            placeholder="Search title, merchant, notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1 }}
            autoFocus
          />
          <button type="button" className="icon-btn" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>
            <X size={16} />
          </button>
        </div>
      )}

      {!loading && !failed && (categorySpendRows.length > 0 || incomeRows.length > 0) && (
        <div className="card" style={{ marginBottom: '16px', padding: '14px 16px' }}>
          <button
            type="button"
            onClick={() => setCategoryPanelOpen((o) => !o)}
            aria-expanded={categoryPanelOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              width: '100%',
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: categoryPanelOpen ? '10px' : 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                By category ({periodLabel})
              </div>
              {!categoryPanelOpen && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '4px', fontWeight: 600 }}>
                  {categorySpendRows.length > 0 && (
                    <span style={{ color: 'var(--accent-text-danger, #ef4444)' }}>
                      Spent −{formatCompactINR(analytics?.totalSpent ?? 0)}
                    </span>
                  )}
                  {categorySpendRows.length > 0 && incomeRows.length > 0 && ' · '}
                  {incomeRows.length > 0 && (
                    <span style={{ color: 'var(--accent-text-success, #16a34a)' }}>
                      Received +{formatCompactINR(analytics?.totalReceived ?? 0)}
                    </span>
                  )}
                  {(categorySpendRows.length > 0 || incomeRows.length > 0) && (
                    <span> · Tap to expand</span>
                  )}
                </div>
              )}
            </div>
            <ChevronDown
              size={18}
              style={{
                flexShrink: 0,
                color: 'var(--text-tertiary)',
                transform: categoryPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
              aria-hidden
            />
          </button>
          {categoryPanelOpen && categorySpendRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: incomeRows.length ? '12px' : 0 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Spent
              </div>
              {categorySpendRows.map(([catKey, amt]) => {
                const catInfo = CATEGORY_MAP[catKey] || { label: catKey, icon: '📦' };
                const pct = maxCategorySpend ? Math.max(4, (amt / maxCategorySpend) * 100) : 0;
                const isActive = selectedCategory === catKey;
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setSelectedCategory(isActive ? 'all' : catKey)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: '10px',
                      border: isActive ? '2px solid var(--accent-color, #2563eb)' : '1px solid transparent',
                      background: isActive ? 'var(--bg-secondary)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem' }}>{catInfo.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>{catInfo.label}</div>
                      <div style={{ marginTop: '4px', height: '6px', borderRadius: '4px', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '4px', background: 'var(--accent-text-danger, #ef4444)', opacity: 0.85 }} />
                      </div>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--accent-text-danger, #ef4444)', whiteSpace: 'nowrap' }}>
                      −{formatCompactINR(amt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {categoryPanelOpen && incomeRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Received
              </div>
              {incomeRows.map(([catKey, amt]) => {
                const catInfo = CATEGORY_MAP[catKey] || { label: catKey, icon: '📥' };
                return (
                  <div
                    key={`in-${catKey}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '0.78rem', padding: '4px 8px' }}
                  >
                    <span>{catInfo.icon} {catInfo.label}</span>
                    <span style={{ fontWeight: 800, color: 'var(--accent-text-success, #16a34a)' }}>+{formatCompactINR(amt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '6px' }}>Filter list</div>
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
          <button
            onClick={() => setSelectedCategory('all')}
            style={{
              padding: '6px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: selectedCategory === 'all' ? 'var(--accent-color, #2563eb)' : 'var(--bg-tertiary)',
              color: selectedCategory === 'all' ? '#fff' : 'var(--text-secondary)',
              fontWeight: selectedCategory === 'all' ? 800 : 600,
              fontSize: '0.75rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            All
          </button>
          {Object.entries(CATEGORY_MAP).map(([catKey, catInfo]) => {
            const catTotal = spentByCategory[catKey] || 0;
            return (
              <button
                key={catKey}
                onClick={() => setSelectedCategory(catKey)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: selectedCategory === catKey ? 'var(--accent-color, #2563eb)' : 'var(--bg-tertiary)',
                  color: selectedCategory === catKey ? '#fff' : 'var(--text-secondary)',
                  fontWeight: selectedCategory === catKey ? 800 : 600,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>{catInfo.icon}</span>
                <span>{catInfo.label.split(' ')[0]}</span>
                {catTotal > 0 && (
                  <span style={{ fontSize: '0.65rem', opacity: selectedCategory === catKey ? 0.95 : 0.75 }}>
                    {formatCompactINR(catTotal)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading && ledgerExpenses.length === 0 ? (
        <Loading label="Loading expense ledger" />
      ) : failed && ledgerExpenses.length === 0 ? (
        <LoadError what="your expenses" onRetry={reloadLedger} />
      ) : visibleExpenses.length === 0 && ledgerExpenses.length === 0 && privateSafe && !searchQuery ? (
        <SafeEmpty noun="expenses" />
      ) : visibleExpenses.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>
            {searchQuery ? 'No matching expenses' : 'No expenses logged yet'}
          </p>
          {!searchQuery && <p className="empty-hint">{hintFor('/expenses')}</p>}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {searchQuery ? 'Try searching for another keyword.' : 'Tap Add Expense above — or tell Jarvis to record an expense.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: refreshing ? 0.92 : 1, transition: 'opacity 0.15s ease' }}>
          {visibleExpenses.map((item) => {
            const catInfo = CATEGORY_MAP[item.category] || CATEGORY_MAP.other;
            const formattedDate = formatDay(new Date(item.date));

            return (
              <div
                key={item._id}
                className="card"
                style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1.4rem', padding: '8px', borderRadius: '12px', background: 'var(--bg-tertiary)', flexShrink: 0 }}>
                    {catInfo.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </span>
                      {item.isPrivate && (
                        <span title="Private Safe"><Lock size={14} style={{ color: 'var(--accent-text-warning, #f59e0b)' }} /></span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-tertiary)' }}>{catInfo.label}</span>
                      {item.merchant && (
                        <span style={{ padding: '2px 6px', borderRadius: '6px', background: 'var(--bg-tertiary)', fontWeight: 600 }}>
                          {item.merchant}
                        </span>
                      )}
                      <span>· {formattedDate}</span>
                    </div>
                    {item.notes && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                        {item.notes}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: item.flow === 'in' ? 'var(--accent-text-success, #16a34a)' : 'var(--accent-text-danger, #ef4444)' }}>
                      {formatLedgerAmount(item.amount, item.flow || 'out')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="icon-btn" onClick={() => handleEdit(item)} title="Edit expense" aria-label="Edit expense">
                      <Edit3 size={15} />
                    </button>
                    <button className="icon-btn danger" onClick={() => handleDelete(item._id)} title="Delete expense" aria-label="Delete expense">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={reloadLedger}
        initialData={editingExpense}
        ledgerProjectId={null}
      />

      <ImportExpensesModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={reloadLedger} />
    </div>
  );
}
