'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { hintFor } from '@/lib/nav';
import { getMoms, uploadMomAudio, uploadMomAudioSarvam, pollMomTranscription, extractMomTasks, confirmMomTasks, deleteMom, momImpact, updateMom } from '@/actions/mom';
import { Mic, Square, Share2, Trash2, AlertTriangle, CheckSquare, StickyNote, BookOpen, Pencil, RefreshCw, FileText, Check } from 'lucide-react';
import { useFeedback } from '@/components/ui/Feedback';
import { useShareNotice } from '@/components/ShareNotice';
import { isProjectOwner, canWrite } from '@/lib/scope';
import { formatDay, formatDate } from '@/lib/time';

interface MomSectionProps {
  projects?: any[]; // all projects, so items can be routed to any of them
  project: any | null; // null = a personal meeting: no home project, the transcript routes every item
  myEmail: string;
  memberOptions: string[];
  onTasksCreated: () => void;
}

const MAX_SECONDS = 2 * 60 * 60;   // Sarvam accepts at most 2 hours in one file

export default function MomSection({ project, projects = [], myEmail, memberOptions, onTasksCreated }: MomSectionProps) {
  const { toast, confirm } = useFeedback();
  const { confirmShare, shareDialog } = useShareNotice();
  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pipeline, setPipeline] = useState(''); // status text while upload/transcribe/extract runs
  type Kind = 'task' | 'note' | 'brief';
  type Draft = { kind: Kind; title: string; detail?: string; assigneeEmail: string; dueAt: string; projectId: string; missing: string[] };
  // task → note → project brief → task. One button, no dropdown for three options.
  const nextKind = (k: Kind): Kind => (k === 'task' ? 'note' : k === 'note' ? 'brief' : 'task');
  const kindMeta = {
    task: { Icon: CheckSquare, label: 'Task', hint: 'A task — click for a note' },
    note: { Icon: StickyNote, label: 'Note', hint: 'A note — click to add to the project brief' },
    brief: { Icon: BookOpen, label: 'Project brief', hint: 'Appends to the project’s About text — click for a task' },
  } as const;
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const toLocalInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const projectId: string = project?._id || '';
  const allProjects = projects.length ? projects : [project].filter(Boolean);
  // A project meeting belongs to its owners; a personal one to whoever recorded it.
  const canRemove = !project || isProjectOwner(project, myEmail);   // a viewer is never an owner
  // A personal meeting is always yours to record. Inside a group, view-only means no recording,
  // no re-extract, no editing the minutes — every one of those writes to shared data, and the
  // actions refuse them anyway; this is what stops offering them.
  const canEdit = !project || canWrite(project, myEmail);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);   // momId whose title/summary is being edited
  const [draftMom, setDraftMom] = useState<{ title: string; summary: string }>({ title: '', summary: '' });
  const [showTranscript, setShowTranscript] = useState<string | null>(null);
  const [hinglish, setHinglish] = useState(false);   // account is allowlisted for Sarvam

  const fetchMoms = useCallback(async () => {
    const res = await getMoms(projectId);
    if (res.success) {
      setMoms(res.moms || []);
      setHinglish(!!res.hinglish);
      // Seed editable drafts for MOMs awaiting review
      setDrafts(prev => {
        const next = { ...prev };
        for (const mom of res.moms || []) {
          if (!mom.tasksConfirmed && mom.candidates?.length && !next[mom._id]) {
            next[mom._id] = mom.candidates.map((c: any) => ({
              kind: (c.kind === 'note' || c.kind === 'brief' ? c.kind : 'task') as Kind,
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
  }, [projectId]);

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
      timerRef.current = setInterval(() => setElapsed(s => {
        // Sarvam's hard per-file limit is 2 hours, and it bills per minute — so a recorder
        // left running is both a rejected upload and a real bill. Stop it ourselves.
        if (s + 1 >= MAX_SECONDS) { stopRecording(); toast('Stopped at 2 hours — the limit for one recording.', 'error'); }
        return s + 1;
      }), 1000);
    } catch (err) {
      toast('Microphone unavailable. Check app permissions.', 'error');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const meetingTitle = () => `Meeting ${formatDay(new Date())}`;

  const runExtraction = async (momId: string) => {
    setPipeline('Extracting tasks…');
    const ex = await extractMomTasks(momId, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPipeline('');
    if (!ex.success) toast(ex.error || 'Something went wrong', 'error');
    fetchMoms();
  };

  /**
   * Sarvam's job runs for minutes, so wait on it here rather than in a server action. Failure
   * leaves the MOM alone: the job id is stored, so a reload picks the poll back up.
   */
  const waitForTranscript = async (momId: string, background = false) => {
    // A resumed poll runs quietly: the meeting's own card already says it is transcribing, and
    // occupying `pipeline` would disable the recorder — one stuck meeting would then block
    // every new recording in this scope.
    const say = (s: string) => { if (!background) setPipeline(s); };
    say('Transcribing… this can take a few minutes');
    // ~20 minutes of waiting. Giving up only stops watching — the job id stays on the MOM, so
    // a reload picks it back up rather than the meeting being lost to a slow queue.
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 8000));
      const res = await pollMomTranscription(momId);
      if (!res.success) { say(''); toast(res.error || 'Something went wrong', 'error'); fetchMoms(); return false; }
      if (res.done) return true;
    }
    say('');
    toast('Still transcribing — reopen this page in a bit to pick it up.', 'error');
    fetchMoms();
    return false;
  };

  // Paid path. The audio is relayed by the server — Sarvam's presigned URLs are Azure blob
  // storage, which refuses cross-origin browser PUTs. Meeting length is bounded by
  // next.config's serverActions bodySizeLimit (30mb ≈ 2 hours at 32kbps).
  const runSarvamPipeline = async (blob: Blob) => {
    setPipeline('Uploading…');
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('title', meetingTitle());
    formData.append('audio', blob, 'meeting.webm');
    const up = await uploadMomAudioSarvam(formData);
    if (!up.success || !up.momId) {
      setPipeline(''); toast(up.error || 'Something went wrong', 'error'); return;
    }
    fetchMoms();   // the meeting exists now — show it as in-flight straight away
    if (await waitForTranscript(up.momId)) await runExtraction(up.momId);
  };

  // Free path, unchanged: audio goes through the server action and Whisper answers inline.
  const runWhisperPipeline = async (blob: Blob) => {
    setPipeline('Transcribing… (this can take a minute)');
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('title', meetingTitle());
    formData.append('audio', blob, 'meeting.webm');
    const up = await uploadMomAudio(formData);   // transcribes in the same call
    if (!up.success) { setPipeline(''); toast(up.error || 'Something went wrong', 'error'); return; }
    await runExtraction(up.mom._id);
  };

  const runPipeline = (blob: Blob) => (hinglish ? runSarvamPipeline(blob) : runWhisperPipeline(blob));

  /**
   * A job id with no transcript means Sarvam is still working on it. Because the job lives on
   * their side, closing the app mid-transcription no longer loses the meeting — pick it back up.
   */
  const resumedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pipeline) return;   // already waiting on one
    const stuck = moms.find((m: any) =>
      m.sarvamJobId && !m.transcript && !m.transcriptionError && !resumedRef.current.has(m._id));
    if (!stuck) return;
    resumedRef.current.add(stuck._id);
    (async () => { if (await waitForTranscript(stuck._id, true)) await runExtraction(stuck._id); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moms, pipeline]);

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
      projectId: d.projectId,   // '' is a real choice (Personal) — never collapse it to undefined
    }));
    // Once for the batch, per distinct group the items are going into
    for (const pid of new Set(items.map(i => i.projectId).filter(Boolean))) {
      if (!(await confirmShare(allProjects.find(p => String(p?._id) === pid)))) return;
    }
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
    const text = `📋 ${mom.title} (${formatDate(mom.createdAt)})\n\n${mom.summary || ''}\n\nAction items:\n${tasksText}`;
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

  /**
   * Deleting a meeting asks what should happen to what it produced, because a meeting becoming
   * real work is the whole pitch and a routine tidy-up of old recordings must not silently undo
   * it. Two questions rather than a three-way dialog: the second only appears when there is
   * actually work at stake, its safe answer is the focused one, and destroying the work takes a
   * deliberate second yes.
   */
  const handleDelete = async (momId: string) => {
    const impact = await momImpact(momId);
    const n = impact.success ? (impact.notes || 0) : 0;
    const t = impact.success ? (impact.tasks || 0) : 0;
    const made = [n && `${n} note${n === 1 ? '' : 's'}`, t && `${t} task${t === 1 ? '' : 's'}`].filter(Boolean).join(' and ');

    if (!(await confirm({
      title: 'Delete this meeting?',
      message: made
        ? `It produced ${made}. They stay in the project, labelled “from a deleted meeting”, unless you say otherwise next.`
        : 'The recording and its minutes go with it.',
      danger: true,
      confirmLabel: 'Delete meeting',
    }))) return;

    const alsoDeleteWork = made
      ? await confirm({
          title: `Delete the ${made} too?`,
          message: 'This cannot be undone. Keeping them is almost always what you want.',
          danger: true,
          confirmLabel: `Delete the ${made}`,
          cancelLabel: 'Keep them',
        })
      : false;

    const res = await deleteMom(momId, { alsoDeleteWork });
    if (res.success) { fetchMoms(); onTasksCreated(); } else toast(res.error || 'Something went wrong', 'error');
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div>
      {shareDialog}
      {/* Recorder */}
      {canEdit && <div className="mom-recorder" style={{
        display: 'flex', alignItems: 'center', gap: '16px', padding: '20px', marginBottom: hinglish ? '24px' : '8px',
        background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)'
      }}>
        {!recording ? (
          <button onClick={startRecording} disabled={!!pipeline} className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 28px', borderRadius: '16px', fontWeight: 800, opacity: pipeline ? 0.6 : 1 }}>
            <Mic size={20} /> Record meeting
          </button>
        ) : (
          <button onClick={stopRecording}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 28px', borderRadius: '16px', fontWeight: 800, background: 'var(--danger-color)', color: 'white', border: 'none', cursor: 'pointer' }}>
            <Square size={18} fill="white" /> Stop · {fmtTime(elapsed)}
          </button>
        )}
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
          {pipeline || (recording ? 'Recording… keep the phone near the discussion.'
            : project ? `Record → transcribe → action items, filed under ${project.name}.`
            : 'Record → transcribe → each action item routed to the project it belongs to.')}
        </span>
      </div>}

      {/* Say why a Hindi meeting comes out badly, rather than letting it look broken */}
      {!hinglish && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', fontWeight: 600, margin: '0 0 24px', padding: '0 4px', lineHeight: 1.5 }}>
          Meetings are transcribed in English. Hindi and Hinglish need the upgraded transcription,
          which isn’t enabled on this account.
        </p>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="loading-spinner"></div></div>
      ) : moms.length === 0 && !pipeline ? (
        <div className="empty-state">
          <p style={{ fontWeight: 800, marginBottom: '4px' }}>No meetings yet</p>
          <p className="empty-hint">{hintFor('/mom')}</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tap Record above. Hindi and Hinglish work too.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {moms.map(mom => (
            <div key={mom._id} style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                {editing === mom._id ? (
                  <input value={draftMom.title} onChange={e => setDraftMom(d => ({ ...d, title: e.target.value }))}
                    className="field" style={{ flex: 1, fontWeight: 800 }} autoFocus />
                ) : (
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{mom.title}</span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                  {formatDay(mom.createdAt)}
                </span>
                {editing === mom._id ? (
                  <button onClick={() => saveMomEdits(mom._id)} className="icon-btn" title="Save"><Check size={16} /></button>
                ) : canEdit && (
                  <button onClick={() => { setEditing(mom._id); setDraftMom({ title: mom.title, summary: mom.summary || '' }); }} className="icon-btn" title="Edit title & summary"><Pencil size={15} /></button>
                )}
                {mom.transcript && canEdit && (
                  <button onClick={() => reExtract(mom)} disabled={!!pipeline} className="icon-btn" title="Re-run AI on this recording"><RefreshCw size={15} /></button>
                )}
                {mom.transcript && (
                  <button onClick={() => setShowTranscript(showTranscript === mom._id ? null : mom._id)} className="icon-btn" title="Show transcript"><FileText size={15} /></button>
                )}
                {(mom.summary || mom.candidates?.length > 0) && (
                  <button onClick={() => handleShare(mom)} className="icon-btn" title="Share MOM"><Share2 size={15} /></button>
                )}
                {canRemove && <button onClick={() => handleDelete(mom._id)} className="icon-btn danger" title="Delete"><Trash2 size={15} /></button>}
              </div>

              {showTranscript === mom._id && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.55, background: 'var(--bg-tertiary)', padding: '10px 12px', borderRadius: '12px', marginBottom: '10px', whiteSpace: 'pre-wrap' }}>
                  {mom.transcript}
                </p>
              )}

              {/* Still with Sarvam. Survives a reload, so say so rather than offering a dead button. */}
              {mom.sarvamJobId && !mom.transcript && !mom.transcriptionError && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, margin: '0 0 8px' }}>
                  Transcribing… this can take a few minutes. Safe to leave the page.
                </p>
              )}

              {mom.transcriptionError && !mom.transcript && (
                <p style={{ fontSize: '0.8rem', color: 'var(--danger-color)', fontWeight: 700, margin: '0 0 8px' }}>
                  {mom.transcriptionError} — the audio is gone, so this one needs recording again.
                </p>
              )}

              {!mom.tasksConfirmed && (!mom.transcript || !mom.summary) && !pipeline && !mom.sarvamJobId && (
                <button onClick={() => handleProcess(mom)}
                  style={{ padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '8px' }}>
                  {mom.transcript ? 'Extract tasks' : 'Transcribe & extract tasks'}
                </button>
              )}

              {editing === mom._id ? (
                <textarea value={draftMom.summary} onChange={e => setDraftMom(d => ({ ...d, summary: e.target.value }))}
                  rows={5} placeholder="Minutes / summary"
                  className="field" style={{ marginBottom: '12px', lineHeight: 1.6, resize: 'vertical' }} />
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
                        const gapCls = (f: string, empty: boolean) => `field${needs(f) && empty ? ' needs-fill' : ''}`;
                        return (
                          <div key={i} className="card" style={{ padding: '12px', display: 'grid', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button type="button" title={kindMeta[d.kind].hint}
                                onClick={() => updateDraft(mom._id, i, { kind: nextKind(d.kind) })}
                                className="icon-btn" style={{ flexShrink: 0, color: d.kind === 'task' ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                                {(() => { const { Icon } = kindMeta[d.kind]; return <Icon size={15} />; })()}
                              </button>
                              <input type="text" value={d.title} onChange={e => updateDraft(mom._id, i, { title: e.target.value })}
                                className="field" style={{ flex: 1, fontWeight: 700 }} />
                              <button onClick={() => removeDraft(mom._id, i)} className="icon-btn danger" title="Discard"><Trash2 size={14} /></button>
                            </div>

                            {d.detail && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{d.detail}</p>}

                            {d.kind === 'brief' && (
                              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--accent-color)', fontWeight: 700 }}>
                                Gets appended to the project’s About text{d.projectId ? '' : ' — pick which project'}
                              </p>
                            )}

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <select value={d.projectId} onChange={e => updateDraft(mom._id, i, { projectId: e.target.value })}
                                className={gapCls('project', !d.projectId)} style={{ flex: '1 1 140px' }}>
                                <option value="">
                                  {d.kind === 'brief' ? '⚠ Which project’s brief?'
                                    : needs('project') ? '⚠ Pick a project' : 'Personal — no project'}
                                </option>
                                {allProjects.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
                              </select>

                              {d.kind === 'task' && (
                                <>
                                  <select value={d.assigneeEmail} onChange={e => updateDraft(mom._id, i, { assigneeEmail: e.target.value })}
                                    className={gapCls('assignee', !d.assigneeEmail)} style={{ flex: '1 1 140px' }}>
                                    <option value="">{needs('assignee') ? '⚠ Who does this?' : 'Unassigned'}</option>
                                    {[...new Set([...memberOptions, d.assigneeEmail].filter(Boolean))].map(email => (
                                      <option key={email} value={email}>{email === myEmail ? 'me' : email}</option>
                                    ))}
                                  </select>
                                  <input type="datetime-local" value={d.dueAt} onChange={e => updateDraft(mom._id, i, { dueAt: e.target.value })}
                                    title={needs('due') ? 'No deadline was mentioned — set one' : 'Deadline from the recording'}
                                    className={gapCls('due', !d.dueAt)}
                                    style={{ flex: '1 1 150px', color: d.dueAt ? 'var(--text-primary)' : 'var(--text-tertiary)' }} />
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button onClick={() => handleConfirm(mom._id)} className="btn-primary"
                      style={{ marginTop: '14px', padding: '12px 28px', borderRadius: '14px', fontWeight: 800 }}>
                      Create {(['task', 'note', 'brief'] as const)
                        .map(k => [list.filter(d => d.kind === k).length, k] as const)
                        .filter(([n]) => n)
                        .map(([n, k]) => `${n} ${k === 'brief' ? 'brief note' : k}${n === 1 ? '' : 's'}`)
                        .join(' + ')}
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
