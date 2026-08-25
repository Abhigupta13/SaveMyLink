'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Mic, Compass } from 'lucide-react';
import { dismissIntro, createSampleMeeting } from '@/actions/intro';
import { useFeedback } from '@/components/ui/Feedback';
import type { introProgress } from '@/lib/intro';

type Props = { progress: ReturnType<typeof introProgress> & { offerSample?: boolean } };

/**
 * A cold account's launcher: take the guided tour, or try the loop on a sample meeting. The old
 * checklist is gone — the tour walks the real app instead. The sample offer stayed: it is the
 * fastest way to see record → tasks without recording anything.
 */
export default function GettingStarted({ progress }: Props) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [sampleBusy, setSampleBusy] = useState(false);

  const trySample = async () => {
    setSampleBusy(true);
    const res = await createSampleMeeting(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setSampleBusy(false);
    if (!res.success) { toast(res.error || 'Something went wrong', 'error'); return; }
    if (!res.extracted) toast(res.error || 'The AI could not read it just now — use "Extract again" on the meeting', 'error');
    router.push(`/mom?project=${res.projectId}`);
  };

  return (
    <section className="card" style={{ marginBottom: '22px', padding: '18px 18px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>New here? Here&apos;s how it fits together.</h2>
        <button onClick={async () => { await dismissIntro(); router.refresh(); }}
          style={{ background: 'none', border: 'none', font: 'inherit', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}>
          Hide
        </button>
      </div>
      <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        A 90-second walk through the real app, or try the meeting-to-task loop on a sample.
      </p>

      <button onClick={() => window.dispatchEvent(new Event('tour:start'))} className="tile"
        style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '12px 14px', marginBottom: '10px' }}>
        <span className="row-icon"><Compass size={18} strokeWidth={2.2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: '0.92rem' }}>Take the tour</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Section by section, skip any step, stop whenever you like.</span>
        </span>
        <ArrowRight size={16} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />
      </button>

      {progress.offerSample && (
        <button onClick={trySample} disabled={sampleBusy} className="tile"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '12px 14px', borderStyle: 'dashed' }}>
          <span className="row-icon"><Mic size={18} strokeWidth={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 800, fontSize: '0.92rem' }}>{sampleBusy ? 'Reading the transcript…' : 'Try it with a sample meeting'}</span>
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>40 seconds, then delete it. Swaraj and Abhishek plan a launch; you confirm the tasks.</span>
          </span>
          {sampleBusy ? <div className="loading-spinner" style={{ width: '18px', height: '18px' }} /> : <ArrowRight size={16} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />}
        </button>
      )}

      <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', margin: '10px 0 0' }}>
        <Link href="/your-data">Who can see my data</Link> — a group is the only thing that shares.
      </p>
    </section>
  );
}
