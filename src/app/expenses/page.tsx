'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, Trash2, Edit3, Lock, Wallet, Sparkles, RefreshCw } from 'lucide-react';
import { getExpenses, getExpenseAnalytics, deleteExpense } from '@/actions/expense';
import { getProjects, createProject } from '@/actions/project';
import AddExpenseModal from '@/components/AddExpenseModal';
import ProjectPicker from '@/components/ProjectPicker';
import { SafeBanner, SafeEmpty } from '@/components/PrivateSafe';
import { useFeedback } from '@/components/ui/Feedback';
import Loading from '@/components/ui/Loading';
import LoadError from '@/components/ui/LoadError';
import { useUser } from '@/components/UserContext';
import { hintFor } from '@/lib/nav';
import { formatDay } from '@/lib/time';
import { ExpenseCategory } from '@/lib/models/Expense';

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
  other: { label: 'Other', icon: '📦' },
};

export default function ExpensesPage() {
  const { toast, confirm } = useFeedback();
  const { privateSafe } = useUser();
  const { data: session, status } = useSession();

  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [scope, setScope] = useState<any | null>(null);

  const [analytics, setAnalytics] = useState<{
    totalSpent: number;
    count: number;
    categoryBreakdown: Record<string, number>;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);

  const wantedProject = useSearchParams().get('project');

  const loadData = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      const [expRes, analyticsRes, p] = await Promise.all([
        getExpenses({
          period,
          category: selectedCategory,
          search: searchQuery,
        }),
        getExpenseAnalytics(period === 'all' ? 'month' : period),
        getProjects(),
      ]);

      if (expRes.success && expRes.expenses) {
        setExpenses(expRes.expenses);
      } else {
        setFailed(true);
      }

      if (analyticsRes.success && analyticsRes.analytics) {
        setAnalytics(analyticsRes.analytics);
      }

      if (p.success) {
        setProjects(p.projects || []);
        if (wantedProject) {
          setScope((p.projects || []).find((x: { _id: string }) => String(x._id) === wantedProject) || null);
        }
      }
    } catch (err) {
      console.error('Error loading expense data:', err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [period, selectedCategory, searchQuery, wantedProject]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadData();
    }
  }, [status, period, selectedCategory, loadData]);

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete this expense entry?', danger: true, confirmLabel: 'Delete' }))) return;
    const res = await deleteExpense(id);
    if (res.success) {
      toast('Expense entry deleted', 'info');
      loadData();
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

  // Scope filter
  const inScope = expenses.filter((n) => (scope ? (n as any).projectId?._id === scope._id : !(n as any).projectId));
  const counts = expenses.reduce((acc: Record<string, number>, n: any) => {
    const key = n.projectId?._id || 'personal';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const totalSpent = inScope.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '18px', gap: '12px' }}>
        <div>
          <h1 className="page-title">{scope ? scope.name : 'Expenses'}</h1>
          <p className="page-subtitle">
            {inScope.length
              ? `${inScope.length} entry${inScope.length === 1 ? '' : 'ies'} · Khatabook style expense ledger`
              : 'Log daily spending, food, travel, shopping & track totals'}
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={handleAddClick}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}
        >
          <Plus size={18} /> Add Expense
        </button>
      </header>

      {/* Project Picker */}
      <div style={{ marginBottom: '16px' }}>
        <ProjectPicker
          projects={projects}
          activeId={scope?._id || null}
          counts={counts}
          onSelect={setScope}
          onCreate={async (name) => {
            const res = await createProject(name);
            if (res.success) {
              setProjects((ps) => [...ps, res.project]);
              setScope(res.project);
            } else {
              toast(res.error || 'Something went wrong', 'error');
            }
            return res;
          }}
        />
      </div>

      {/* Safe Banner */}
      {!scope && <SafeBanner noun="expenses" />}

      {/* Khatabook Ledger Total Card */}
      <div
        className="card"
        style={{
          marginBottom: '16px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
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
              Total Expenses ({period === 'all' ? 'All Time' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'This Year'})
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: 'var(--text-primary)' }}>
              ₹{totalSpent.toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        {/* Period Filter Tabs */}
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

      {/* Jarvis Tip Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '12px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          marginBottom: '16px',
        }}
      >
        <Sparkles size={16} style={{ color: 'var(--accent-color, #2563eb)', flexShrink: 0 }} />
        <span>
          Tip: Ask Jarvis <i>"What were my food expenses this month?"</i> or <i>"Add 350 for dinner on Swiggy"</i>
        </span>
      </div>

      {/* Search & Category Chips */}
      <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="field"
            placeholder="Search expenses by title, merchant, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>

        {/* Category Pills */}
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
            All Categories
          </button>
          {Object.entries(CATEGORY_MAP).map(([catKey, catInfo]) => (
            <button
              key={catKey}
              onClick={() => setSelectedCategory(catKey)}
              style={{
                padding: '6px 12px',
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
              <span>{catInfo.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content Rendering */}
      {loading ? (
        <Loading label="Loading expense ledger" />
      ) : failed ? (
        <LoadError what="your expenses" onRetry={loadData} />
      ) : inScope.length === 0 && privateSafe && !scope && !searchQuery ? (
        <SafeEmpty noun="expenses" />
      ) : inScope.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>
            {searchQuery ? 'No matching expenses' : scope ? `No expenses in ${scope.name}` : 'No expenses logged yet'}
          </p>
          {!searchQuery && <p className="empty-hint">{hintFor('/expenses')}</p>}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {searchQuery ? 'Try searching for another keyword.' : 'Tap Add Expense above — or tell Jarvis to record an expense.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {inScope.map((item) => {
            const catInfo = CATEGORY_MAP[item.category] || CATEGORY_MAP.other;
            const formattedDate = formatDay(new Date(item.date));

            return (
              <div
                key={item._id}
                className="card"
                style={{
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '1.4rem',
                      padding: '8px',
                      borderRadius: '12px',
                      background: 'var(--bg-tertiary)',
                      flexShrink: 0,
                    }}
                  >
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
                    <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                      ₹{item.amount.toLocaleString('en-IN')}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="icon-btn"
                      onClick={() => handleEdit(item)}
                      title="Edit expense"
                      aria-label="Edit expense"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => handleDelete(item._id)}
                      title="Delete expense"
                      aria-label="Delete expense"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Expense Modal */}
      <AddExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => loadData()}
        initialData={editingExpense}
        projects={projects}
        defaultProject={scope?._id || ''}
      />
    </div>
  );
}
