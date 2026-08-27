'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { hintFor } from '@/lib/nav';
import { getMoms, uploadMomAudio, uploadMomAudioSarvam, pollMomTranscription, extractMomTasks, confirmMomTasks, deleteMom, momImpact, updateMom } from '@/actions/mom';
import { Mic, Square, Share2, Trash2, AlertTriangle, CheckSquare, StickyNote, BookOpen, Pencil, RefreshCw, FileText, Check, Loader2 } from 'lucide-react';
import { useFeedback } from '@/components/ui/Feedback';
import { useShareNotice } from '@/components/ShareNotice';
import { isProjectOwner, canWrite } from '@/lib/scope';
import { formatDay, formatDate } from '@/lib/time';
import { getReminderDefault } from '@/actions/task';
import ReminderPicker from '@/components/ReminderPicker';
import type { ReminderChoice } from '@/lib/reminderRule';

interface MomSectionProps {
  projects?: any[]; // all projects, so items can be routed to any of them
  project: any | null; // null = a personal meeting: no home project, the transcript routes every item
  myEmail: string;
  memberOptions: string[];
  onTasksCreated: () => void;
  /**
   * Show only the meetings whose items nobody has confirmed yet — unfinished work. The group page
   * puts the recorder at the top of its first screen and lists those underneath it; the finished
   * meetings live one tap away, behind the Meetings card. A filter and not a second instance
   * because the recorder must stay mounted: two of these would mean two pipelines and two polls.
   */
  pendingOnly?: boolean;
  /** Slots straight under the recorder, above the meetings — the group page's warning band. */
  afterRecorder?: React.ReactNode;
}

// The honest cap. Sarvam accepts 2 hours in one file, but the recording reaches the server inside
// a server-action body, and a serverless host caps those at ~4.5MB — about 20 minutes at the
// recorder's 32kbps. The old 2-hour limit was fiction: the upload failed long before it.
const MAX_SECONDS = 20 * 60;

// What produced the transcript. Said quietly, because the user does not choose it — but "why is
// my Hindi meeting in English" needs an answer on the card rather than in a support message.
const ENGINE_NOTE: Record<string, string> = {
  gemini: 'Hindi + English',
  whisper: 'English only',
  sarvam: 'upgraded Hindi',
};

// The landing page promises a live waveform while you record; this is that, made real. Bars driven
// by CSS keyframes rather than an AnalyserNode: a real level meter costs a 60fps rAF loop on a
// phone that is already encoding audio, and it would say nothing the "Recording" pill does not.
const Wave = () => (
  <div className="mom-wave" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} />)}</div>
);

export default function MomSection({ project, projects = [], myEmail, memberOptions, onTasksCreated, pendingOnly = false, afterRecorder }: MomSectionProps) {
  const { toast, confirm } = useFeedback();
  const { confirmShare, shareDialog } = useShareNotice();
  const [moms, setMoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pipeline, setPipeline] = useState(''); // status text while upload/transcribe/extract runs
  type Kind = 'task' | 'note' | 'brief';
  type Draft = { kind: Kind; title: string; detail?: string; assigneeEmail: string; dueAt: string; projectId: string; missing: string[]; reminder: ReminderChoice | null };
  // The person's profile default, shown in each row's picker until they change that row. Seeded as
  // null rather than copied into every draft, so the drafts can be built before this call lands.
  const [reminderDefault, setReminderDefault] = useState<ReminderChoice | null>(null);
  useEffect(() => { getReminderDefault().then(r => setReminderDefault((r.choice as ReminderChoice) || null)).catch(() => {}); }, []);
  // What an extracted item becomes. Three named choices, all visible at once — the old single
  // icon cycled task → note → brief and explained itself in a `title` tooltip, which on a phone
  // is no explanation at all.
  const KINDS = ['task', 'note', 'brief'] as const;
  const kindMeta = {
    task: { Icon: CheckSquare, label: 'Task' },
    note: { Icon: StickyNote, label: 'Note' },
    brief: { Icon: BookOpen, label: 'Brief' },
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
  /**
   * The mic, claimed SYNCHRONOUSLY — before the getUserMedia await, not after it.
   *
   * `setRecording(true)` lives on the far side of that await, so for as long as it takes the phone
   * to grant the mic (on Android WebView that is the OS permission dialog: seconds) the dot still
   * reads "record" and is still enabled. A second tap in that window used to build a SECOND
   * MediaRecorder whose `ondataavailable` pushes into the same `chunksRef`, and `recorderRef` then
   * only pointed at the newer one — so Stop stopped one recorder and the other kept running.
   * The blob was two overlapping webm streams interleaved, and the transcript came back with whole
   * sentences twice. Measured on real Chrome with a fake mic: 25s of speech → a 43.5s blob with
   * the timestamps restarting mid-file, Whisper repeating "testing environment setup… I will do it
   * by Wednesday" verbatim. One recording, one mic — a boolean ref is the only thing fast enough
   * to say so, because React state is not set until the await returns.
   */
  const micBusy = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);   // momId whose title/summary is being edited
  const [draftMom, setDraftMom] = useState<{ title: string; summary: string }>({ title: '', summary: '' });
  const [showTranscript, setShowTranscript] = useState<string | null>(null);
  const [hinglish, setHinglish] = useState(false);   // account is allowlisted for Sarvam
  // Which meeting the stage card is about. Set when recording starts, cleared by every pipeline
  // that belongs to an *older* meeting (re-extract, resumed poll) — those must not borrow today's
  // title and the last recording's clock.
  const [stageTitle, setStageTitle] = useState('');

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
              reminder: null,   // null = my default; the row's own picker overrides it
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
    if (micBusy.current) return;   // a start is already in flight, or one is already running
    micBusy.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined,
        audioBitsPerSecond: 32000, // ~14MB/hour — fits transcription file caps
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        micBusy.current = false;
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await runPipeline(blob);
      };
      recorder.start(10000); // gather data every 10s so nothing is lost on crash
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      setStageTitle(meetingTitle());
      timerRef.current = setInterval(() => setElapsed(s => {
        // Past this the upload is rejected by the host before any engine sees it, and on the paid
        // path it would also be a real bill. Stop it ourselves rather than lose the recording.
        if (s + 1 >= MAX_SECONDS) { stopRecording(); toast('Stopped at 20 minutes — longer meetings after the next round.', 'error'); }
        return s + 1;
      }), 1000);
    } catch (err) {
      micBusy.current = false;   // nothing to stop, so nothing else will release it
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

    // Sarvam could not take it (dead balance, revoked key, their API down) and the server
    // transcribed it on the free engine instead. There is no job to wait for — the transcript
    // is already on the meeting, so go straight to extraction and say what happened.
    if (up.fallback) {
      toast(up.fallback, 'info');
      await runExtraction(up.momId);
      return;
    }

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
    (async () => { if (await waitForTranscript(stuck._id, true)) { setStageTitle(''); await runExtraction(stuck._id); } })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moms, pipeline]);

  // Resume a meeting whose task extraction failed. The audio is gone once transcribed,
  // so a meeting with no transcript can only be recorded again.
  const handleProcess = async (mom: any) => {
    if (!mom.transcript) { toast('That recording has no transcript — record it again.', 'error'); return; }
    setStageTitle('');
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
    setStageTitle('');
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
      reminder: d.reminder || undefined,   // undefined = resolve my profile default server-side
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

  // The pill says which of the three waits this is, because "please wait" is not an answer to
  // "how long". Derived from the pipeline text rather than a second piece of state to keep in sync.
  const stageWord = pipeline.startsWith('Uploading') ? 'Uploading'
    : pipeline.startsWith('Transcribing') ? 'Transcribing' : 'Extracting';

  // A meeting still transcribing has no candidates yet, and it is the least finished thing there
  // is — so "not confirmed" is the whole filter, not "has items waiting".
  //
  // Capped at two, because a group with six unreviewed meetings would otherwise rebuild the wall
  // this page was rebuilt to remove — and every one of these cards can grow a full review form.
  // The caller says how many are left over and offers the way to the rest.
  const shown = pendingOnly ? moms.filter(m => !m.tasksConfirmed).slice(0, 2) : moms;

  return (
    <div>
      {shareDialog}
      {/* Recorder — the landing page's stage card, made real: title row, live waveform, state pill. */}
      {canEdit && <div className="mom-stage" style={{ marginBottom: hinglish ? '24px' : '8px' }}>
        {(recording || (pipeline && stageTitle)) && (
          <div className="mom-stage-bar">
            <b>{stageTitle}</b>
            <span className="mom-clock">{fmtTime(elapsed)}<i> / 20:00</i></span>
          </div>
        )}

        {/* One control across all states: the dot IS the record/stop button. Idle = accent mic,
            recording = red stop, transcribing = disabled spinner. No separate button. */}
        <div className={`mom-strip${recording ? '' : pipeline ? ' waiting' : ' idle'}`}>
          {recording ? (
            <button type="button" onClick={stopRecording} data-tour="record-meeting"
              className="mom-dot rec" aria-label="Stop recording">
              <Square size={16} fill="currentColor" />
            </button>
          ) : pipeline ? (
            <button type="button" disabled data-tour="record-meeting"
              className="mom-dot" aria-label={`${stageWord}…`}>
              <Loader2 size={18} className="mom-spin" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={startRecording} data-tour="record-meeting"
              className="mom-dot idle" aria-label="Start recording">
              <Mic size={18} />
            </button>
          )}
          <Wave />
          {recording ? <span className="mom-pill live">Recording</span>
            : pipeline ? <span className="mom-pill">{stageWord}</span>
            : null}
        </div>

        <p className="mom-stage-note" role="status">
          {pipeline || (recording ? 'Recording… keep the phone near the discussion. Up to 20 minutes for now — longer meetings after the next round.'
            : project ? `Tap the dot to record → transcribe → action items, filed under ${project.name}.`
            : 'Tap the dot to record → transcribe → each action item routed to the project it belongs to.')}
        </p>
      </div>}

      {afterRecorder}

      {/* Hindi is free now, so the old "needs the upgraded engine" line would be a lie. What is
          still true: the free engine has a daily ceiling, and falling past it drops to English.
          It is an explainer about the engine, so it belongs with the meetings, not on a summary
          screen whose job is to get you to the dot. */}
      {!hinglish && !pendingOnly && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', fontWeight: 600, margin: '0 0 24px', padding: '0 4px', lineHeight: 1.5 }}>
          Hindi and Hinglish are transcribed free, and take a little longer than English. On a busy
          day the free engine runs out and the meeting falls back to English only. For the upgraded
          engine, add your own Sarvam key in Profile.
        </p>
      )}

      {loading ? (
        pendingOnly ? null : <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="loading-spinner"></div></div>
      ) : shown.length === 0 && !pipeline ? (
        // Nothing to confirm is the normal state, not an empty state — the count on the Meetings
        // card is what says how many there are.
        pendingOnly ? null : (
          <div className="empty-state">
            <p style={{ fontWeight: 800, marginBottom: '4px' }}>No meetings yet</p>
            <p className="empty-hint">{hintFor('/mom')}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tap Record above. Hindi and Hinglish work too.</p>
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {shown.map(mom => (
            <div key={mom._id} style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '24px', border: '1px solid var(--border-color)' }}>
              <div className="mom-card-head">
                {editing === mom._id ? (
                  <input value={draftMom.title} onChange={e => setDraftMom(d => ({ ...d, title: e.target.value }))}
                    className="field" style={{ fontWeight: 800 }} autoFocus />
                ) : (
                  /* Width comes from .mom-card-head — full line at 390px, shared line above it. */
                  <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{mom.title}</span>
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

              {/* Its own line rather than beside the date: at 390px that row already carries a
                  wrapping title and five icon buttons. */}
              {mom.transcript && ENGINE_NOTE[mom.engine] && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600, margin: '0 0 8px' }}>
                  {ENGINE_NOTE[mom.engine]}
                </p>
              )}

              {showTranscript === mom._id && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.55, background: 'var(--bg-tertiary)', padding: '10px 12px', borderRadius: '12px', marginBottom: '10px', whiteSpace: 'pre-wrap' }}>
                  {mom.transcript}
                </p>
              )}

              {/* Still with Sarvam. Survives a reload, so say so rather than offering a dead button. */}
              {mom.sarvamJobId && !mom.transcript && !mom.transcriptionError && (
                <>
                  <div className="mom-strip waiting" style={{ marginBottom: '8px' }}>
                    <Wave />
                    <span className="mom-pill">Transcribing</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 700, margin: '0 0 8px' }}>
                    This can take a few minutes. Safe to leave the page.
                  </p>
                </>
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
                    {/* The reveal the landing page promises, at the moment it actually happens. */}
                    <p className="mom-found" aria-hidden="true">↓ action items found</p>
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
                              <input type="text" value={d.title} onChange={e => updateDraft(mom._id, i, { title: e.target.value })}
                                className="field" style={{ flex: 1, fontWeight: 700 }} />
                              <button onClick={() => removeDraft(mom._id, i)} className="icon-btn danger" title="Discard"><Trash2 size={14} /></button>
                            </div>

                            {/* Task or note, said out loud and reversible. It sits directly above the
                                fields it governs, so picking Note visibly takes the assignee and the
                                deadline away — they only mean something on a task. Same segmented
                                control as the theme picker: 44px tall, no hover needed. */}
                            <div className="segmented mom-kind" role="radiogroup" aria-label={`What to make of “${d.title.slice(0, 60) || 'this item'}”`}>
                              {KINDS.map(k => {
                                const { Icon, label } = kindMeta[k];
                                return (
                                  <button key={k} type="button" role="radio" aria-checked={d.kind === k}
                                    className={`segment ${d.kind === k ? 'on' : ''}`}
                                    onClick={() => updateDraft(mom._id, i, { kind: k })}>
                                    <Icon size={15} strokeWidth={2.2} aria-hidden="true" /> {label}
                                  </button>
                                );
                              })}
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
                                  {/* Only once this item has a deadline. Its own line rather than a
                                      fourth control squeezed into the row — the chase is the point
                                      of turning a meeting into a task, so it is worth reading. */}
                                  {d.dueAt && <ReminderPicker inline value={d.reminder ?? reminderDefault}
                                    onChange={next => updateDraft(mom._id, i, { reminder: next })}
                                    style={{ flex: '1 1 100%' }} />}
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
