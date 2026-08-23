'use client';

import Link from 'next/link';
import { Sparkles, Link as LinkIcon, StickyNote, BellRing, Mic, Share2, Lock, Users } from 'lucide-react';

const FEATURES = [
  { Icon: Sparkles, title: 'Ask Jarvis', text: 'Talk to your vault. “What’s urgent today?”, “Did I save a site that turns code into images?” — it answers from your own stuff, and can add tasks or notes for you.' },
  { Icon: Share2, title: 'Save from anywhere', text: 'Share a link from any app on your phone. Title, thumbnail and category are filled in for you — one tap and it’s filed.' },
  { Icon: BellRing, title: 'Tasks that chase you', text: 'Give a task a due time and your phone reminds you — a day before, an hour before, at the deadline, then every morning until it’s done.' },
  { Icon: Mic, title: 'Meetings → action items', text: 'Record a meeting (Hinglish is fine). Get a clean summary plus extracted tasks you can assign to people and projects.' },
  { Icon: StickyNote, title: 'Notes & links together', text: 'Long notes, quick thoughts, saved links and documents — one place, one search across all of it.' },
  { Icon: Lock, title: 'Private Safe', text: 'Anything sensitive sits behind a PIN, hidden from the normal view until you unlock it.' },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <span className="landing-badge"><Sparkles size={13} /> with Jarvis, your voice assistant</span>
        <h1>
          Everything you save,<br /><span className="gradient-text">in one place that answers back</span>
        </h1>
        <p>
          Links, notes, tasks, meetings, documents and people — saved in seconds, found by asking.
          Your personal vault for work and life.
        </p>
        <div className="landing-actions">
          <Link href="/auth/signup" className="btn-primary landing-btn">Get started — it’s yours</Link>
          <Link href="/auth/signin" className="landing-btn ghost">Sign in</Link>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map(({ Icon, title, text }) => (
          <article key={title} className="landing-card">
            <span className="landing-card-icon"><Icon size={20} strokeWidth={2.2} /></span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="landing-cta">
        <h2>Start with one link.</h2>
        <p>Save something today, ask Jarvis about it next month.</p>
        <Link href="/auth/signup" className="btn-primary landing-btn">Create your vault</Link>
      </section>

      <footer className="landing-foot">
        <span className="logo">ALL <span className="logo-light">YOU NEED</span></span>
        <span>© {new Date().getFullYear()} · Your personal vault</span>
      </footer>
    </div>
  );
}
