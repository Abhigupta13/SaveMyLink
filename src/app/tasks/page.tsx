'use client';

import { useState, useEffect, useTransition } from 'react';
import { getTasks, createTask, toggleTask, deleteTask } from '@/actions/task';
import { useSession } from 'next-auth/react';

export default function TasksPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<any[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const fetchTasks = async () => {
    const res = await getTasks();
    if (res.success) {
      setTasks(res.tasks || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (session) {
      fetchTasks();
    }
  }, [session]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const title = newTaskTitle;
    setNewTaskTitle('');
    
    const tempId = Date.now().toString();
    const tempTask = { _id: tempId, title, completed: false, isTemp: true };
    setTasks([tempTask, ...tasks]);

    const res = await createTask(title);
    if (res.success) {
      fetchTasks();
    } else {
      setTasks(tasks.filter(t => t._id !== tempId));
      alert(res.error);
    }
  };

  const handleToggle = async (id: string) => {
    setTasks(tasks.map(t => t._id === id ? { ...t, completed: !t.completed } : t));
    const res = await toggleTask(id);
    if (!res.success) {
      fetchTasks();
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this task?')) {
      setTasks(tasks.filter(t => t._id !== id));
      const res = await deleteTask(id);
      if (!res.success) {
        fetchTasks();
      }
    }
  };

  if (!session) {
    return (
      <div className="container" style={{ padding: '80px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: '4.5rem', marginBottom: '24px', opacity: 0.8 }}>📋</div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '16px', letterSpacing: '-0.02em' }}>Personal Companion Tasks</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto 32px', lineHeight: 1.6 }}>
          Stay organized and productive. Sign in to sync your tasks across all your devices and keep your daily life in check.
        </p>
        <a href="/auth/signin" className="btn-primary" style={{ display: 'inline-block', padding: '14px 40px', borderRadius: '16px', fontWeight: 800 }}>Sign In Now</a>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '32px', textAlign: 'left' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: '4px' }}>
          Tasks
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-color)' }}></div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
            {tasks.filter(t => !t.completed).length} active duties
          </p>
        </div>
      </header>
      
      <form onSubmit={handleCreate} style={{ marginBottom: '40px' }}>
        <div style={{ 
          display: 'flex', background: 'var(--bg-secondary)', padding: '6px', 
          borderRadius: '30px', border: '1px solid var(--border-color)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
          transition: 'var(--transition)', alignItems: 'center'
        }} className="task-input-wrapper">
          <input 
            type="text" 
            placeholder="I need to..." 
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            style={{ 
              flex: 1, padding: '12px 20px', borderRadius: '24px', border: 'none', 
              background: 'transparent', color: 'var(--text-primary)', outline: 'none',
              fontSize: '1rem', fontWeight: 600
            }}
          />
          <button 
            type="submit" 
            className="btn-primary" 
            style={{ padding: '12px 32px', borderRadius: '24px', fontWeight: 800, height: '48px' }}
            disabled={!newTaskTitle.trim()}
          >
            Add
          </button>
        </div>
      </form>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
          <div className="loading-spinner"></div>
        </div>
      ) : (
        <div className="task-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {tasks.length === 0 ? (
            <div style={{ 
              textAlign: 'center', padding: '80px 24px', background: 'var(--bg-secondary)', 
              borderRadius: '32px', border: '1px dashed var(--border-color)', opacity: 0.9 
            }}>
              <span style={{ fontSize: '3.5rem', display: 'block', marginBottom: '20px' }}>🌈</span>
              <p style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '8px' }}>Clean Slate!</p>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '280px', margin: '0 auto', lineHeight: 1.5 }}>
                No pending tasks found. Time to relax or start something new.
              </p>
            </div>
          ) : (
            tasks.map(task => (
              <div 
                key={task._id} 
                className={`task-card ${task.completed ? 'completed' : ''}`}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '16px', padding: '22px', 
                  background: task.completed ? 'rgba(30, 41, 59, 0.4)' : 'var(--bg-secondary)', 
                  borderRadius: '24px', border: '1px solid',
                  borderColor: task.completed ? 'transparent' : 'var(--border-color)',
                  transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)', 
                  opacity: task.isTemp ? 0.6 : 1,
                  boxShadow: task.completed ? 'none' : '0 8px 30px rgba(0,0,0,0.08)'
                }}
              >
                <button 
                  onClick={() => handleToggle(task._id)}
                  style={{ 
                    width: '28px', height: '28px', borderRadius: '10px', 
                    border: '2.5px solid', borderColor: task.completed ? 'var(--accent-color)' : 'var(--text-tertiary)',
                    background: task.completed ? 'var(--accent-color)' : 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.3s ease'
                  }}
                  className="task-check-btn"
                >
                  {task.completed && (
                    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1.5 5L5.5 9L12.5 1.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                
                <span style={{ 
                  flex: 1, fontSize: '1.05rem', fontWeight: 600, color: task.completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  textDecoration: task.completed ? 'line-through' : 'none',
                  transition: 'all 0.3s ease'
                }}>
                  {task.title}
                </span>

                <button 
                  onClick={() => handleDelete(task._id)} 
                  className="task-delete-btn"
                  style={{ 
                    width: '36px', height: '36px', borderRadius: '12px', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)',
                    fontSize: '1.4rem', border: 'none', cursor: 'pointer',
                    transition: 'var(--transition)'
                  }}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <style jsx>{`
        .task-card:hover {
          border-color: var(--accent-color) !important;
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(99, 102, 241, 0.15) !important;
        }
        .task-input-wrapper:focus-within {
          border-color: var(--accent-color) !important;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1) !important;
        }
        @media (min-width: 768px) {
          .task-delete-btn { opacity: 0; }
          .task-card:hover .task-delete-btn { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
