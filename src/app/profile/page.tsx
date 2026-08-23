'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, Lock, Unlock } from 'lucide-react';
import { getContacts } from '@/actions/contact';
import { getMyOpenTasks } from '@/actions/task';
import { getProjects } from '@/actions/project';
import { useFeedback } from '@/components/ui/Feedback';
import { useUser } from '@/components/UserContext';
import ThemeToggle from '@/components/ThemeToggle';
import SuggestBox from '@/components/SuggestBox';

export default function ProfilePage() {
  const { confirm, toast } = useFeedback();
  const { privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
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
    <div className="page narrow">
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

      <div className="card" style={{ marginBottom: '14px' }}>
        <span style={{ display: 'block', fontWeight: 700, marginBottom: '10px' }}>Appearance</span>
        <ThemeToggle />
      </div>

      {/* Private Safe: unlocking needs the PIN, locking never does */}
      <div className="card safe-row">
        <span className={`safe-icon ${privateSafe ? 'on' : ''}`}>
          {privateSafe ? <Unlock size={18} /> : <Lock size={18} />}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Private Safe</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {privateSafe ? 'Unlocked — private links are visible' : 'Locked — enter your PIN to view private links'}
          </span>
        </span>
        <label className="switch" title={privateSafe ? 'Lock the safe' : 'Unlock with PIN'}>
          <input type="checkbox" checked={privateSafe} onChange={() => {
            if (privateSafe) { setPrivateSafe(false); toast('Private Safe locked', 'success'); }
            else setPinModalOpen(true);          // PIN required only to turn it on
          }} />
          <span className="slider round"></span>
        </label>
      </div>

      <SuggestBox />

      <button onClick={async () => { if (await confirm({ title: 'Log out?', message: 'You can sign back in anytime.', confirmLabel: 'Log out' })) signOut({ callbackUrl: '/' }); }}
        style={{ marginTop: '18px', width: '100%', height: '48px', borderRadius: '14px', background: 'var(--danger-soft)', color: 'var(--danger-color)', fontWeight: 800, border: '1px solid color-mix(in srgb, var(--danger-color) 25%, transparent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <LogOut size={18} /> Log out
      </button>
    </div>
  );
}
