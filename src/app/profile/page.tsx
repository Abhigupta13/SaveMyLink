'use client';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, Lock, Unlock, Share2, FileText, BarChart3, Compass, Sparkles, Languages, BellRing } from 'lucide-react';
import { getContacts } from '@/actions/contact';
import { getMyOpenTasks, getReminderDefault, setReminderDefault } from '@/actions/task';
import ReminderPicker from '@/components/ReminderPicker';
import { DEFAULT_CHOICE, type ReminderChoice } from '@/lib/reminderRule';
import { getProjects } from '@/actions/project';
import { useFeedback } from '@/components/ui/Feedback';
import { useUser } from '@/components/UserContext';
import ThemeToggle from '@/components/ThemeToggle';
import SuggestBox from '@/components/SuggestBox';
import DeleteAccountCard from '@/components/DeleteAccountCard';
import Link from 'next/link';
import { appUrl } from '@/lib/url';
import { amIAdmin } from '@/actions/admin';
import { getJarvisConfirm, setJarvisConfirm } from '@/actions/jarvis';

export default function ProfilePage() {
  const { confirm, toast } = useFeedback();
  const { privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<{ tasks: number; projects: number; contacts: number } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [askFirst, setAskFirst] = useState(true);   // Jarvis confirms before writing into a group
  const [remind, setRemind] = useState<ReminderChoice>(DEFAULT_CHOICE);   // what every new task starts on
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

  useEffect(() => {
    if (status !== 'authenticated') return;
    getJarvisConfirm().then(r => setAskFirst(r.on)).catch(() => {});
    getReminderDefault().then(r => setRemind((r.choice as ReminderChoice) || DEFAULT_CHOICE)).catch(() => {});
  }, [status]);

  // Only decides whether the row is drawn; /admin's own actions are what actually gate the data
  useEffect(() => {
    if (status !== 'authenticated') return;
    amIAdmin().then(r => setAdmin(r.admin)).catch(() => {});
  }, [status]);

  // Same fallback ladder MomSection uses: native sheet on the phone, Web Share on a browser that
  // has it, clipboard everywhere else — so the button always does something.
  const shareApp = async () => {
    // The live site, never whatever host this happens to be running on — a shared localhost
    // link is one the person receiving it cannot open.
    const url = `${appUrl()}/download`;
    const text = `I'm using ALL YOU NEED to keep my links, notes, tasks and meetings in one place — for work and everything else. Get it here: ${url}`;
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: 'ALL YOU NEED', text, url });
        return;
      }
    } catch { /* fall through */ }
    if (navigator.share) return void navigator.share({ title: 'ALL YOU NEED', text, url }).catch(() => {});
    await navigator.clipboard.writeText(text);
    toast('Invite link copied', 'success');
  };

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

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px' }}>
        <span className="row-icon"><Sparkles size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Ask before Jarvis posts to a group</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            {askFirst
              ? 'A task or note Jarvis files under a group waits for your yes. Personal ones are saved straight away.'
              : 'Off — Jarvis files things into your groups without asking. Personal ones were never asked about.'}
          </span>
        </span>
        <label className="switch" title={askFirst ? 'Stop asking' : 'Ask me first'}>
          <input type="checkbox" checked={askFirst} onChange={async e => {
            const next = e.target.checked;
            setAskFirst(next);
            const r = await setJarvisConfirm(next);
            if (!r.success) { setAskFirst(!next); toast('Could not save that', 'error'); return; }
            toast(next ? 'Jarvis will ask first' : 'Jarvis will not ask', 'success');
          }} />
          <span className="slider round"></span>
        </label>
      </div>

      {/* The global default, set once. Every "Remind me" picker in the app starts here, and every
          task written before this setting existed answers to it too — which is why changing it
          does NOT re-aim tasks that already carry a choice of their own. */}
      <div className="card" style={{ display: 'grid', gap: '8px', marginTop: '14px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="row-icon"><BellRing size={18} strokeWidth={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700 }}>Remind me about tasks</span>
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              What every new task starts on. You can change it on any one task.
            </span>
          </span>
        </span>
        <ReminderPicker id="default-remind" value={remind} onChange={async next => {
          const was = remind;
          setRemind(next);
          const r = await setReminderDefault(next);
          if (!r.success) { setRemind(was); toast('Could not save that', 'error'); return; }
          toast('Saved', 'success');
        }} />
      </div>

      {/* One line, not three paragraphs: the how-and-what-it-costs explainer lives on /sarvam-key,
          and so does the key field — this row only has to get you there. */}
      <Link href="/sarvam-key" className="card" style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        marginTop: '14px', textDecoration: 'none', color: 'inherit',
      }}>
        <span className="row-icon"><Languages size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Upgraded Hindi transcription</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Bring your own Sarvam key — how to get one, and what it costs
          </span>
        </span>
      </Link>

      {admin && (
        <Link href="/admin" className="card" style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          marginTop: '14px', textDecoration: 'none', color: 'inherit',
        }}>
          <span className="row-icon"><BarChart3 size={18} strokeWidth={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700 }}>Admin</span>
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              How the app is doing, and everything sent through Help us improve
            </span>
          </span>
        </Link>
      )}

      <button onClick={shareApp} className="card" style={{
        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
        marginTop: '14px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
      }}>
        <span className="row-icon"><Share2 size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Share the app</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Send someone the download link and install steps
          </span>
        </span>
      </button>

      {/* One row, not two: the tour explainer and the sharing picture answer the same question. */}
      <Link href="/your-data" className="card" style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        marginTop: '14px', textDecoration: 'none', color: 'inherit',
      }}>
        <span className="row-icon"><Compass size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>How it works, and who sees it</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Take the guided tour, and see what each of your groups can read
          </span>
        </span>
      </Link>

      <Link href="/terms" className="card" style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        marginTop: '10px', marginBottom: '4px', textDecoration: 'none', color: 'inherit',
      }}>
        <span className="row-icon"><FileText size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700 }}>Terms &amp; your data</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            What is stored, who can see it
          </span>
        </span>
      </Link>

      <SuggestBox />

      <button onClick={async () => { if (await confirm({ title: 'Log out?', message: 'You can sign back in anytime.', confirmLabel: 'Log out' })) signOut({ callbackUrl: '/' }); }}
        style={{ marginTop: '18px', width: '100%', height: '48px', borderRadius: '14px', background: 'var(--danger-soft)', color: 'var(--danger-color)', fontWeight: 800, border: '1px solid color-mix(in srgb, var(--danger-color) 25%, transparent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <LogOut size={18} /> Log out
      </button>

      <DeleteAccountCard />
    </div>
  );
}
