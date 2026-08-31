'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Lock, Unlock, Share2, FileText, BarChart3, Compass, Sparkles, Languages, BellRing, ChevronRight, ChevronDown, Smartphone } from 'lucide-react';
import { getReminderDefault, setReminderDefault } from '@/actions/task';
import ReminderPicker from '@/components/ReminderPicker';
import { DEFAULT_CHOICE, type ReminderChoice } from '@/lib/reminderRule';
import { useFeedback } from '@/components/ui/Feedback';
import { useUser } from '@/components/UserContext';
import ThemeToggle from '@/components/ThemeToggle';
import SuggestBox from '@/components/SuggestBox';
import DeleteAccountCard from '@/components/DeleteAccountCard';
import DriveCard from '@/components/DriveCard';
import AccountSwitcher from '@/components/AccountSwitcher';
import Link from 'next/link';
import { shareUrl } from '@/lib/url';
import { isNativeApp } from '@/lib/nativeBridge';
import { amIAdmin } from '@/actions/admin';
import { getJarvisConfirm, setJarvisConfirm } from '@/actions/jarvis';

/**
 * Settings, grouped. It used to be thirteen full-width cards in one flat scroll — everything the
 * same size, so nothing read as more or less important than anything else, and "Delete my account"
 * sat one thumb-width under a full-width "Log out".
 *
 * Now: related rows share one `.set-card` with hairlines between them, under a quiet section
 * label. Identity moved out entirely — tapping the header opens the accounts sheet, and Log out
 * lives in there with the other ways of ceasing to be this person. Deleting the account is the
 * only thing left alone in a card of its own.
 */
export default function ProfilePage() {
  const { toast } = useFeedback();
  const { privateSafe, setPrivateSafe, setPinModalOpen } = useUser();
  const { status } = useSession();
  const [admin, setAdmin] = useState(false);
  const [askFirst, setAskFirst] = useState(true);   // Jarvis confirms before writing into a group
  const [remind, setRemind] = useState<ReminderChoice>(DEFAULT_CHOICE);   // what every new task starts on
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [native, setNative] = useState(false);      // running inside the Android app already

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

  // "Get the Android app" is noise to somebody reading it inside the Android app. Defaulting to
  // false rather than true on purpose: the web is the case that matters here, and it must not
  // flicker the row in and out on every profile open. The app briefly shows a row it then hides,
  // which is the cheaper of the two wrong-for-a-moment states.
  useEffect(() => {
    isNativeApp().then(setNative).catch(() => {});
  }, []);

  // Same fallback ladder MomSection uses: native sheet on the phone, Web Share on a browser that
  // has it, clipboard everywhere else — so the button always does something.
  const shareApp = async () => {
    // The live site, never whatever host this happens to be running on — a shared localhost
    // link is one the person receiving it cannot open.
    const url = shareUrl('/download');
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
      {/* The visible identity block is a <button>, which cannot contain a heading, so the page's
          one h1 is here for screen readers — the section labels below are h2s under it. */}
      <h1 className="sr-only">Profile and settings</h1>

      {/* The header is the trigger for the accounts sheet, where every identity control now lives.
          The theme pill is its SIBLING, not its child: a button cannot contain a button, and a tap
          on the pill must not open the sheet underneath it. */}
      <div className="profile-head">
        <AccountSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
        {/* Both controls on one line, because they answer the same kind of question: who you are,
            and how this looks. Floating the theme pill in the corner beside the avatar read as
            decoration rather than something you could press. A real button, not a nested one —
            the header above is itself a button, and a button cannot contain one. */}
        <div className="profile-actions">
          <button className="profile-cue" onClick={() => setSwitcherOpen(true)}>
            Switch account <ChevronDown size={14} strokeWidth={2.6} />
          </button>
          <ThemeToggle />
        </div>
      </div>

      {admin && (
        <section className="set-group">
          <h2 className="set-label">Admin</h2>
          <div className="set-card">
            <Link href="/admin" className="set-row">
              <span className="row-icon"><BarChart3 size={18} strokeWidth={2.2} /></span>
              <span className="set-row-text">
                <span className="set-row-title">Admin</span>
                <span className="set-row-sub">How the app is doing, and everything sent through Help us improve</span>
              </span>
              <ChevronRight className="set-row-go" size={18} />
            </Link>
          </div>
        </section>
      )}

      <section className="set-group">
        {/* One honest heading over everything that answers "where does my stuff live, and who can
            read it" — the safe, the file store, the tour, and the terms. */}
        <h2 className="set-label">Data security</h2>
        <div className="set-card">
          {/* Private Safe: unlocking needs the PIN, locking never does. The whole row is the
              label — a 24px slider is not a tap target on a phone, the 56px row is. */}
          <label className="set-row">
            <span className={`safe-icon ${privateSafe ? 'on' : ''}`}>
              {privateSafe ? <Unlock size={18} /> : <Lock size={18} />}
            </span>
            <span className="set-row-text">
              <span className="set-row-title">Private Safe</span>
              <span className="set-row-sub">
                {privateSafe ? 'Unlocked — private links are visible' : 'Locked — enter your PIN to view private links'}
              </span>
            </span>
            <span className="switch">
              <input type="checkbox" aria-label="Private Safe" checked={privateSafe} onChange={() => {
                if (privateSafe) { setPrivateSafe(false); toast('Private Safe locked', 'success'); }
                else setPinModalOpen(true);          // PIN required only to turn it on
              }} />
              <span className="slider round"></span>
            </span>
          </label>

          {/* One row that names the account and the space left, expanding in place for the
              explanation and the two controls. Disconnect is destructive and stays inside. */}
          <DriveCard returnTo="/profile" />

          {/* Moved out of About: "who can read this" is a data-security question, not a
              here-is-our-app one. */}


        </div>
      </section>

      <section className="set-group">
        <h2 className="set-label">How the app behaves</h2>
        <div className="set-card">
          <label className="set-row">
            <span className="row-icon"><Sparkles size={18} strokeWidth={2.2} /></span>
            <span className="set-row-text">
              <span className="set-row-title">Ask before Jarvis posts to a group</span>
              <span className="set-row-sub">
                {askFirst
                  ? 'A task or note Jarvis files under a group waits for your yes. Personal ones are saved straight away.'
                  : 'Off — Jarvis files things into your groups without asking. Personal ones were never asked about.'}
              </span>
            </span>
            <span className="switch">
              <input type="checkbox" aria-label="Ask before Jarvis posts to a group" checked={askFirst} onChange={async e => {
                const next = e.target.checked;
                setAskFirst(next);
                const r = await setJarvisConfirm(next);
                if (!r.success) { setAskFirst(!next); toast('Could not save that', 'error'); return; }
                toast(next ? 'Jarvis will ask first' : 'Jarvis will not ask', 'success');
              }} />
              <span className="slider round"></span>
            </span>
          </label>

          {/* The global default, set once. Every "Remind me" picker in the app starts here, and every
              task written before this setting existed answers to it too — which is why changing it
              does NOT re-aim tasks that already carry a choice of their own. */}
          <div className="set-row stack">
            <span className="set-row-head">
              <span className="row-icon"><BellRing size={18} strokeWidth={2.2} /></span>
              <span className="set-row-text">
                <span className="set-row-title">Remind me about tasks</span>
                <span className="set-row-sub">What every new task starts on. You can change it on any one task.</span>
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

          {/* One line, not three paragraphs: the how-and-what-it-costs explainer lives on
              /sarvam-key, and so does the key field — this row only has to get you there. */}
          <Link href="/sarvam-key" className="set-row">
            <span className="row-icon"><Languages size={18} strokeWidth={2.2} /></span>
            <span className="set-row-text">
              <span className="set-row-title">Upgraded Hindi transcription</span>
              <span className="set-row-sub">Bring your own Sarvam key — how to get one, and what it costs</span>
            </span>
            <ChevronRight className="set-row-go" size={18} />
          </Link>
        </div>
      </section>


      <section className="set-group">
        <h2 className="set-label">About</h2>
        <div className="set-card">
          <Link href="/your-data" className="set-row">
            <span className="row-icon"><Compass size={18} strokeWidth={2.2} /></span>
            <span className="set-row-text">
              <span className="set-row-title">How it works, and who sees it</span>
              <span className="set-row-sub">Take the guided tour, and see what each of your groups can read</span>
            </span>
            <ChevronRight className="set-row-go" size={18} />
          </Link>

          <Link href="/terms" className="set-row">
            <span className="row-icon"><FileText size={18} strokeWidth={2.2} /></span>
            <span className="set-row-text">
              <span className="set-row-title">Terms and conditions</span>
              <span className="set-row-sub">What is stored, who can see it</span>
            </span>
            <ChevronRight className="set-row-go" size={18} />
          </Link>

          {/* The only way a signed-in person can reach /download. The two prominent buttons for it
              live on the landing page, which app/page.tsx shows ONLY when there is no session — so
              everybody who can see them has no account, and everybody who wants the app cannot.
              (The getting-started checklist used to carry a step for it; that checklist was
              replaced by the tour, leaving the step in INTRO_STEPS but rendered nowhere.)
              Sits above "Share the app" so getting it and passing it on read as one pair. */}
          {!native && (
            <Link href="/download" className="set-row">
              <span className="row-icon"><Smartphone size={18} strokeWidth={2.2} /></span>
              <span className="set-row-text">
                <span className="set-row-title">Get the Android app</span>
                <span className="set-row-sub">Share to save from any app, and reminders that reach your phone</span>
              </span>
              <ChevronRight className="set-row-go" size={18} />
            </Link>
          )}

          <button onClick={shareApp} className="set-row">
            <span className="row-icon"><Share2 size={18} strokeWidth={2.2} /></span>
            <span className="set-row-text">
              <span className="set-row-title">Share the app</span>
              <span className="set-row-sub">Send someone the download link and install steps</span>
            </span>
          </button>

          <SuggestBox />
        </div>
      </section>

      {/* Alone, tinted, and a full section gap away from the nearest other tap target. */}
      <section className="set-group" style={{ marginTop: '34px' }}>
        <h2 className="set-label" style={{ color: 'var(--danger-color)' }}>Danger zone</h2>
        <DeleteAccountCard />
      </section>
    </div>
  );
}
