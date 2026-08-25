'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { dismissIntro, markIntro } from '@/actions/intro';
import type { introProgress } from '@/lib/intro';

type Props = { progress: ReturnType<typeof introProgress>; children?: React.ReactNode };

/** Home's first ten minutes: the point is record → tasks, and this is where a cold account learns it. */
export default function GettingStarted({ progress, children }: Props) {
  const router = useRouter();
  const total = progress.steps.length;
  const doneCount = total - progress.remaining;

  const go = (step: (typeof progress.steps)[number]) => {
    if (step.id === 'jarvis') { window.dispatchEvent(new Event('jarvis:open')); return; }
    if ('manual' in step && step.manual) markIntro(step.id).catch(() => {});
    router.push(step.href);
  };

  return (
    <section className="card" style={{ marginBottom: '22px', padding: '18px 18px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>For work and for life — here&apos;s how it fits together.</h2>
        <button onClick={async () => { await dismissIntro(); router.refresh(); }}
          style={{ background: 'none', border: 'none', font: 'inherit', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}>
          Hide
        </button>
      </div>
      <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px' }}>{doneCount} of {total} done</p>

      {children}

      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {progress.steps.map(step => (
          <li key={step.id} style={{ borderTop: '1px solid var(--border-color)' }}>
            <button onClick={() => go(step)} disabled={step.done}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '11px 2px', background: 'none', border: 'none', font: 'inherit', textAlign: 'left', color: 'inherit', cursor: step.done ? 'default' : 'pointer', opacity: step.done ? 0.55 : 1 }}>
              <span style={{ color: step.done ? 'var(--success-color)' : 'var(--text-tertiary)', flexShrink: 0, display: 'flex' }}>
                {step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '0.92rem', textDecoration: step.done ? 'line-through' : 'none' }}>{step.title}</span>
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{step.why}</span>
              </span>
              {!step.done && <ArrowRight size={16} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />}
            </button>
          </li>
        ))}
      </ol>
      <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
        <Link href="/your-data">Who can see my data</Link> — a group is the only thing that shares.
      </p>
    </section>
  );
}
