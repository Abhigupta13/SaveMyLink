'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getMoms, uploadMomAudio, transcribeMom, extractMomTasks, confirmMomTasks, deleteMom } from '@/actions/mom';
import { Mic, Square, Share2, Trash2 } from 'lucide-react';

interface MomSectionProps {
  project: any;
  myEmail: string;
  memberOptions: string[];
  onTasksCreated: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: '12px', background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.85rem'
};

export default function MomSection({ project, myEmail, memberOptions, onTasksCreated }: MomSectionProps) {
  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pipeline, setPipeline] = useState(''); // status text while upload/transcribe/extract runs
  const [drafts, setDrafts] = useState<Record<string, { title: string; assigneeEmail: string; dueAt: string }[]>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMoms = useCallback(async () => {
    const res = await getMoms(project._id);
    if (res.success) {
      setMoms(res.moms || []);
      // Seed editable drafts for MOMs awaiting review
      setDrafts(prev => {
        const next = { ...prev };
        for (const mom of res.moms || []) {
          if (!mom.tasksConfirmed && mom.candidates?.length && !next[mom._id]) {
            next[mom._id] = mom.candidates.map((c: any) => ({
              title: c.title, assigneeEmail: c.assigneeEmail || '', dueAt: ''
            }));
          }
        }
        return next;
      });
    }
    setLoading(false);
  }, [project._id]);

  useEffect(() => { fetchMoms(); }, [fetchMoms]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined,
        audioBitsPerSecond: 32000, // ~14MB/hour — fits transcription file caps
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await runPipeline(blob);
      };
      recorder.start(10000); // gather data every 10s so nothing is lost on crash
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (err) {
      alert('Microphone unavailable. Check app permissions.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const runPipeline = async (blob: Blob) => {
    setPipeline('Uploading recording…');
    const formData = new FormData();
    formData.append('projectId', project._id);
    formData.append('title', `Meeting ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
    formData.append('audio', blob, 'meeting.webm');
    const up = await uploadMomAudio(formData);
    if (!up.success) { setPipeline(''); alert(up.error); return; }

    setPipeline('Transcribing… (this can take a minute)');
    const tr = await transcribeMom(up.mom._id);
    if (!tr.success) { setPipeline(''); alert(tr.error); fetchMoms(); return; }

    setPipeline('Extracting tasks…');
    const ex = await extractMomTasks(up.mom._id);
    setPipeline('');
    if (!ex.success) alert(ex.error);
    fetchMoms();
  };

  // Resume a stuck pipeline (failed/interrupted transcription or extraction)
  const handleProcess = async (mom: any) => {
    if (!mom.transcript) {
      setPipeline('Transcribing… (this can take a minute)');
      const tr = await transcribeMom(mom._id);
      if (!tr.success) { setPipeline(''); alert(tr.error); return; }
    }
    setPipeline('Extracting tasks…');
    const ex = await extractMomTasks(mom._id);
    setPipeline('');
    if (!ex.success) alert(ex.error);
    fetchMoms();
  };

  const updateDraft = (momId: string, idx: number, patch: Partial<{ title: string; assigneeEmail: string; dueAt: string }>) => {
    setDrafts(prev => ({
      ...prev,
      [momId]: prev[momId].map((d, i) => i === idx ? { ...d, ...patch } : d),
    }));
  };

  const removeDraft = (momId: string, idx: number) => {
    setDrafts(prev => ({ ...prev, [momId]: prev[momId].filter((_, i) => i !== idx) }));
  };

  const handleConfirm = async (momId: string) => {
    const tasks = (drafts[momId] || []).filter(d => d.title.trim()).map(d => ({
      title: d.title.trim(),
      assigneeEmail: d.assigneeEmail || undefined,
      dueAt: d.dueAt ? new Date(d.dueAt).toISOString() : undefined,
    }));
    const res = await confirmMomTasks(momId, tasks);
    if (res.success) {
      fetchMoms();
      onTasksCreated();
    } else {
      alert(res.error);
    }
  };

  const handleShare = async (mom: any) => {
    const tasksText = (mom.candidates || []).map((c: any) =>
      `• ${c.title}${c.assigneeEmail ? ` — ${c.assigneeEmail}` : ''}`).join('\n');
    const text = `📋 ${mom.title} (${new Date(mom.createdAt).toLocaleDateString()})\n\n${mom.summary || ''}\n\nAction items:\n${tasksText}`;
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: mom.title, text });
        return;
      }
    } catch { /* fall through */ }
    if (navigator.share) await navigator.share({ title: mom.title, text }).catch(() => {});
    else { await navigator.clipboard.writeText(text); alert('MOM copied to clipboard'); }
  };

  const handleDelete = async (momId: string) => {
    if (!window.confirm('Delete this MOM and its recording?')) return;
    const res = await deleteMom(momId);
    if (res.success) fetchMoms(); else alert(res.error);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div>
      {/* Recorder */}
      <div className="mom-recorder" style={{
        display: 'flex', alignItems: 'center', gap: '16px', padding: '20px', marginBottom: '24px',
        background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)'
      }}>
        {!recording ? (
          <button onClick={startRecording} disabled={!!pipeline} className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 28px', borderRadius: '16px', fontWeight: 800, opacity: pipeline ? 0.6 : 1 }}>
            <Mic size={20} /> Record meeting
          </button>
        ) : (
          <button onClick={stopRecording}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 28px', borderRadius: '16px', fontWeight: 800, background: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}>
            <Square size={18} fill="white" /> Stop · {fmtTime(elapsed)}
          </button>
        )}
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
          {pipeline || (recording ? 'Recording… keep the phone near the discussion.' : 'Record → transcribe → extract action items.')}
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="loading-spinner"></div></div>
      ) : moms.length === 0 && !pipeline ? (
        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px', fontWeight: 600 }}>
          No meeting recordings yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {moms.map(mom => (
            <div key={mom._id} style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{mom.title}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {new Date(mom.createdAt).toLocaleDateString()}
                </span>
                {(mom.summary || mom.candidates?.length > 0) && (
                  <button onClick={() => handleShare(mom)} title="Share MOM"
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '6px' }}>
                    <Share2 size={18} />
                  </button>
                )}
                <button onClick={() => handleDelete(mom._id)} title="Delete"
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px' }}>
                  <Trash2 size={18} />
                </button>
              </div>

              {!mom.tasksConfirmed && (!mom.transcript || !mom.summary) && !pipeline && (
                <button onClick={() => handleProcess(mom)}
                  style={{ padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '8px' }}>
                  {mom.transcript ? 'Extract tasks' : 'Transcribe & extract tasks'}
                </button>
              )}

              {mom.summary && (
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: '12px' }}>
                  {mom.summary}
                </p>
              )}

              {/* Review: allocate extracted tasks */}
              {!mom.tasksConfirmed && drafts[mom._id]?.length > 0 && (
                <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '14px' }}>
                  <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                    Action items — review & allocate
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {drafts[mom._id].map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input type="text" value={d.title} onChange={(e) => updateDraft(mom._id, i, { title: e.target.value })}
                          style={{ ...inputStyle, flex: '1 1 200px' }} />
                        <select value={d.assigneeEmail} onChange={(e) => updateDraft(mom._id, i, { assigneeEmail: e.target.value })}
                          style={inputStyle}>
                          <option value="">Unassigned</option>
                          {memberOptions.map(email => (
                            <option key={email} value={email}>{email === myEmail ? 'me' : email}</option>
                          ))}
                        </select>
                        <input type="datetime-local" value={d.dueAt} onChange={(e) => updateDraft(mom._id, i, { dueAt: e.target.value })}
                          style={{ ...inputStyle, color: d.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                        <button onClick={() => removeDraft(mom._id, i)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => handleConfirm(mom._id)} className="btn-primary"
                    style={{ marginTop: '14px', padding: '12px 28px', borderRadius: '14px', fontWeight: 800 }}>
                    Create {drafts[mom._id].filter(d => d.title.trim()).length} task{drafts[mom._id].length === 1 ? '' : 's'}
                  </button>
                </div>
              )}

              {mom.tasksConfirmed && (
                <p style={{ fontSize: '0.8rem', color: 'var(--accent-color)', fontWeight: 700 }}>✓ Tasks created in this project</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
