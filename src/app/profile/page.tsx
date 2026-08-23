'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { getContacts } from '@/actions/contact';
import { getMyOpenTasks } from '@/actions/task';
import { getProjects } from '@/actions/project';

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<{ tasks: number; projects: number; contacts: number } | null>(null);
  const user = session?.user;
  const initial = (user?.name || user?.email || 'U')[0].toUpperCase();

  useEffect(() => {
    if (status !== 'authenticated') return;
    Promise.all([getMyOpenTasks(), getProjects(), getContacts()]).then(([t, p, c]) => {
      setStats({
        tasks: t.success ? (t.tasks || []).length : 0,
        projects: p.success ? (p.projects || []).length : 0,
        contacts: c.success ? (c.contacts || []).length : 0,
      });
    });
  }, [status]);

  return (
    <div className="container" style={{ maxWidth: '520px', padding: '32px 16px 120px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '28px' }}>
        <div className="user-avatar-large" style={{ width: '86px', height: '86px', fontSize: '2.1rem', marginBottom: '14px' }}>{initial}</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '2px' }}>{user?.name || 'You'}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{user?.email}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '28px' }}>
        {[
          { label: 'Open tasks', value: stats?.tasks },
          { label: 'Projects', value: stats?.projects },
          { label: 'Contacts', value: stats?.contacts },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '16px 8px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{s.value ?? '—'}</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <button onClick={() => { if (window.confirm('Log out?')) signOut({ callbackUrl: '/' }); }}
        style={{ width: '100%', height: '48px', borderRadius: '14px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontWeight: 800, border: '1px solid rgba(239, 68, 68, 0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <LogOut size={18} /> Log out
      </button>
    </div>
  );
}
