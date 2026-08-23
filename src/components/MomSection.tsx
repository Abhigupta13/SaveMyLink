'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getMoms, uploadMomAudio, extractMomTasks, confirmMomTasks, deleteMom, updateMom } from '@/actions/mom';
import { Mic, Square, Share2, Trash2, AlertTriangle, CheckSquare, StickyNote, Pencil, RefreshCw, FileText, Check } from 'lucide-react';
import { useFeedback } from '@/components/ui/Feedback';

interface MomSectionProps {
  projects?: any[]; // all projects, so items can be routed to any of them
  project: any;
  myEmail: string;
  memberOptions: string[];
  onTasksCreated: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: '12px', background: 'var(--bg-tertiary)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-color)',
  color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.85rem'
};

export default function MomSection({ project, projects = [], myEmail, memberOptions, onTasksCreated }: MomSectionProps) {
  const { toast, confirm } = useFeedback();
  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pipeline, setPipeline] = useState(''); // status text while upload/transcribe/extract runs
  type Draft = { kind: 'task' | 'note'; title: string; detail?: string; assigneeEmail: string; dueAt: string; projectId: string; missing: string[] };
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const toLocalInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const allProjects = projects.length ? projects : [project];
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);   // momId whose title/summary is being edited
  const [draftMom, setDraftMom] = useState<{ title: string; summary: string }>({ title: '', summary: '' });
  const [showTranscript, setShowTranscript] = useState<string | null>(null);

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
              kind: c.kind === 'note' ? 'note' : 'task',
              title: c.title,
              detail: c.detail,
              assigneeEmail: c.assigneeEmail || '',
              dueAt: toLocalInput(c.dueAt),
              projectId: c.projectId ? String(c.projectId) : '',
              missing: c.missing || [],
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
      toast('Microphone unavailable. Check app permissions.', 'error');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const runPipeline = async (blob: Blob) => {
    setPipeline('Transcribing… (this can take a minute)');
    const formData = new FormData();
    formData.append('projectId', project._id);
    formData.append('title', `Meeting ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
    formData.append('audio', blob, 'meeting.webm');
    const up = await uploadMomAudio(formData);   // transcribes in the same call
    if (!up.success) { setPipeline(''); toast(up.error || 'Something went wrong', 'error'); return; }

    setPipeline('Extracting tasks…');
    const ex = await extractMomTasks(up.mom._id, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPipeline('');
    if (!ex.success) toast(ex.error || 'Something went wrong', 'error');
    fetchMoms();
  };

  // Resume a meeting whose task extraction failed. The audio is gone once transcribed,
  // so a meeting with no transcript can only be recorded again.
  const handleProcess = async (mom: any) => {
    if (!mom.transcript) { toast('That recording has no transcript — record it again.', 'error'); return; }
    setPipeline('Extracting tasks…');
    const ex = await extractMomTasks(mom._id, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPipeline('');
    if (!ex.success) toast(ex.error || 'Something went wrong', 'error');
    fetchMoms();
  };

  const saveMomEdits = async (momId: string) => {
    const res = await updateMom(momId, draftMom);
    if (res.success) { setEditing(null); fetchMoms(); } else toast(res.error || 'Something went wrong', 'error');
  };

  // Re-run the AI on an existing recording (also upgrades meetings extracted by older versions)
  const reExtract = async (mom: any) => {
    setPipeline('Re-reading the transcript…');
    const ex = await extractMomTasks(mom._id, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPipeline('');
    if (!ex.success) toast(ex.error || 'Something went wrong', 'error');
    setDrafts(d => { const n = { ...d }; delete n[mom._id]; return n; }); // force reseed from new candidates
    fetchMoms();
  };

  const updateDraft = (momId: string, idx: number, patch: Partial<Draft>) => {
    setDrafts(prev => ({
      ...prev,
      [momId]: prev[momId].map((d, i) => i === idx ? { ...d, ...patch } : d),
    }));
  };

  const removeDraft = (momId: string, idx: number) => {
    setDrafts(prev => ({ ...prev, [momId]: prev[momId].filter((_, i) => i !== idx) }));
  };

  const handleConfirm = async (momId: string) => {
    const items = (drafts[momId] || []).filter(d => d.title.trim()).map(d => ({
      kind: d.kind,
      title: d.title.trim(),
      detail: d.detail,
      assigneeEmail: d.assigneeEmail || undefined,
      dueAt: d.dueAt ? new Date(d.dueAt).toISOString() : undefined,
      projectId: d.projectId || undefined,
    }));
    const res = await confirmMomTasks(momId, items);
    if (res.success) {
      fetchMoms();
      onTasksCreated();
    } else {
      toast(res.error || 'Something went wrong', 'error');
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
    else { await navigator.clipboard.writeText(text); toast('MOM copied to clipboard', 'error'); }
  };

  const handleDelete = async (momId: string) => {
    if (!(await confirm({ title: 'Delete this MOM and its recording?', danger: true, confirmLabel: 'Delete' }))) return;
    const res = await deleteMom(momId);
    if (res.success) fetchMoms(); else toast(res.error || 'Something went wrong', 'error');
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                {editing === mom._id ? (
                  <input value={draftMom.title} onChange={e => setDraftMom(d => ({ ...d, title: e.target.value }))}
                    style={{ ...inputStyle, flex: 1, fontWeight: 800 }} autoFocus />
                ) : (
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{mom.title}</span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {new Date(mom.createdAt).toLocaleDateString()}
                </span>
                {editing === mom._id ? (
                  <button onClick={() => saveMomEdits(mom._id)} className="icon-btn" title="Save"><Check size={16} /></button>
                ) : (
                  <button onClick={() => { setEditing(mom._id); setDraftMom({ title: mom.title, summary: mom.summary || '' }); }} className="icon-btn" title="Edit title & summary"><Pencil size={15} /></button>
                )}
                {mom.transcript && (
                  <button onClick={() => reExtract(mom)} disabled={!!pipeline} className="icon-btn" title="Re-run AI on this recording"><RefreshCw size={15} /></button>
                )}
                {mom.transcript && (
                  <button onClick={() => setShowTranscript(showTranscript === mom._id ? null : mom._id)} className="icon-btn" title="Show transcript"><FileText size={15} /></button>
                )}
                {(mom.summary || mom.candidates?.length > 0) && (
                  <button onClick={() => handleShare(mom)} className="icon-btn" title="Share MOM"><Share2 size={15} /></button>
                )}
                <button onClick={() => handleDelete(mom._id)} className="icon-btn danger" title="Delete"><Trash2 size={15} /></button>
              </div>

              {showTranscript === mom._id && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.55, background: 'var(--bg-tertiary)', padding: '10px 12px', borderRadius: '12px', marginBottom: '10px', whiteSpace: 'pre-wrap' }}>
                  {mom.transcript}
                </p>
              )}

              {!mom.tasksConfirmed && (!mom.transcript || !mom.summary) && !pipeline && (
                <button onClick={() => handleProcess(mom)}
                  style={{ padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '8px' }}>
                  {mom.transcript ? 'Extract tasks' : 'Transcribe & extract tasks'}
                </button>
              )}

              {editing === mom._id ? (
                <textarea value={draftMom.summary} onChange={e => setDraftMom(d => ({ ...d, summary: e.target.value }))}
                  rows={5} placeholder="Minutes / summary"
                  style={{ ...inputStyle, width: '100%', marginBottom: '12px', lineHeight: 1.6, resize: 'vertical' }} />
              ) : mom.summary ? (
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: '12px' }}>
                  {mom.summary}
                </p>
              ) : null}

              {/* Review: every item routed to its own project / person / deadline */}
              {!mom.tasksConfirmed && drafts[mom._id]?.length > 0 && (() => {
                const list = drafts[mom._id];
                const gaps = list.reduce((n, d) => n + d.missing.filter(m =>
                  (m === 'project' && !d.projectId) || (m === 'assignee' && !d.assigneeEmail) || (m === 'due' && !d.dueAt)).length, 0);
                return (
                  <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '14px' }}>
                    <p className="task-group-label" style={{ margin: '0 0 10px' }}>
                      Extracted items <span className="count">{list.length}</span>
                      {gaps > 0 && <span className="chip overdue" style={{ marginLeft: 'auto' }}><AlertTriangle size={11} style={{ verticalAlign: '-1px' }} /> {gaps} need your input</span>}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {list.map((d, i) => {
                        const needs = (f: string) => d.missing.includes(f);
                        const gapStyle = (f: string, empty: boolean) => needs(f) && empty
                          ? { ...inputStyle, borderColor: '#f59e0b', background: 'rgba(245,158,11,0.07)' } : inputStyle;
                        return (
                          <div key={i} className="card" style={{ padding: '12px', display: 'grid', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button type="button" title={d.kind === 'task' ? 'This is a task — click for note' : 'This is a note — click for task'}
                                onClick={() => updateDraft(mom._id, i, { kind: d.kind === 'task' ? 'note' : 'task' })}
                                className="icon-btn" style={{ flexShrink: 0, color: d.kind === 'task' ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                                {d.kind === 'task' ? <CheckSquare size={15} /> : <StickyNote size={15} />}
                              </button>
                              <input type="text" value={d.title} onChange={e => updateDraft(mom._id, i, { title: e.target.value })}
                                style={{ ...inputStyle, flex: 1, fontWeight: 700 }} />
                              <button onClick={() => removeDraft(mom._id, i)} className="icon-btn danger" title="Discard"><Trash2 size={14} /></button>
                            </div>

                            {d.detail && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{d.detail}</p>}

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <select value={d.projectId} onChange={e => updateDraft(mom._id, i, { projectId: e.target.value })}
                                style={{ ...gapStyle('project', !d.projectId), flex: '1 1 140px' }}>
                                <option value="">{needs('project') ? '⚠ Pick a project' : 'No project'}</option>
                                {allProjects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
                              </select>

                              {d.kind === 'task' && (
                                <>
                                  <select value={d.assigneeEmail} onChange={e => updateDraft(mom._id, i, { assigneeEmail: e.target.value })}
                                    style={{ ...gapStyle('assignee', !d.assigneeEmail), flex: '1 1 140px' }}>
                                    <option value="">{needs('assignee') ? '⚠ Who does this?' : 'Unassigned'}</option>
                                    {[...new Set([...memberOptions, d.assigneeEmail].filter(Boolean))].map(email => (
                                      <option key={email} value={email}>{email === myEmail ? 'me' : email}</option>
                                    ))}
                                  </select>
                                  <input type="datetime-local" value={d.dueAt} onChange={e => updateDraft(mom._id, i, { dueAt: e.target.value })}
                                    title={needs('due') ? 'No deadline was mentioned — set one' : 'Deadline from the recording'}
                                    style={{ ...gapStyle('due', !d.dueAt), flex: '1 1 150px', color: d.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button onClick={() => handleConfirm(mom._id)} className="btn-primary"
                      style={{ marginTop: '14px', padding: '12px 28px', borderRadius: '14px', fontWeight: 800 }}>
                      Create {list.filter(d => d.kind === 'task').length} task{list.filter(d => d.kind === 'task').length === 1 ? '' : 's'}
                      {list.some(d => d.kind === 'note') && ` + ${list.filter(d => d.kind === 'note').length} note${list.filter(d => d.kind === 'note').length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                );
              })()}

              {mom.tasksConfirmed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-color)', fontWeight: 700 }}>✓ Items created</span>
                  <button className="subtle-link" onClick={() => reExtract(mom)} disabled={!!pipeline}>Re-extract & review again</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
