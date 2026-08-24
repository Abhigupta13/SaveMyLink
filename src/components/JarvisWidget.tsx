'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sparkles, X, Send, ArrowUpRight, Mic, Square, Volume2, VolumeX, Trash2, MessageSquare } from 'lucide-react';
import {
  askJarvis, transcribeQuestion, getJarvisSessions, getJarvisSession, saveJarvisSession,
  deleteJarvisSession, JarvisItem, JarvisTurn, Msg, JarvisSessionMeta,
} from '@/actions/jarvis';
import { syncTask } from '@/lib/taskNotifications';
import { getProjects } from '@/actions/project';
import { formatTime, formatDay } from '@/lib/time';

type Mode = 'idle' | 'capturing';
type Tab = 'chat' | 'sessions';

const GREETING = "What's on your mind?";
const BASE_SUGGESTIONS = ['What is urgent today?', 'What did I save this week?'];

const SILENCE_MS = 2600;      // quiet time AFTER you've spoken before we send
const WAIT_FOR_SPEECH_MS = 20000;  // how long the mic waits for you to begin
const MIN_SPEECH_MS = 800;

function itemHref(i: JarvisItem) {
  if (i.type === 'link' && i.url) return i.url;
  if (i.type === 'project') return '/projects';
  if (i.type === 'task') return '/tasks';
  if (i.type === 'mom') return '/mom';
  if (i.type === 'contact') return '/contacts';
  if (i.type === 'note') return '/notes';
  if (i.type === 'document') return '/d-locker';
  return '/links';
}
const speakable = (s: string) => s.replace(/^[-*•]\s*/gm, '').replace(/\s+/g, ' ').trim();
// Speak Hindi replies with a Hindi voice; Hinglish comes back in Latin script and stays on en-IN.
const voiceLang = (s: string) => /[ऀ-ॿ]/.test(s) ? 'hi-IN' : 'en-IN';
const when = (iso: string) => {
  const t = new Date(iso);
  return `${formatDay(t)} · ${formatTime(t)}`;
};

export default function JarvisWidget() {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(BASE_SUGGESTIONS);
  const [heard, setHeard] = useState(false);   // have you said anything this turn?
  const [tab, setTab] = useState<Tab>('chat');
  const [sessions, setSessions] = useState<JarvisSessionMeta[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalRef = useRef('');        // finals of the live recognition session, rebuilt each event
  const committedRef = useRef('');    // finals banked from earlier sessions this turn
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);
  const heardRef = useRef(false);        // has the user actually said anything this turn?
  const modeRef = useRef<Mode>('idle');
  const startedRef = useRef(false);      // did the browser actually open a mic session?
  const retriedRef = useRef(false);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);     // our own flag: speechSynthesis.speaking gets stuck in Chrome
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const sessionIdRef = useRef<string | null>(null);   // null until this conversation's first save
  const openRef = useRef(false);
  openRef.current = open;
  const loopRef = useRef(false);              // conversation mode: reopen the mic after each answer
  const listenAgainRef = useRef<() => void>(() => {});   // set below; breaks the ask ⇄ startRecognition cycle
  const setModeBoth = (m: Mode) => { modeRef.current = m; setMode(m); };
  const setHeardBoth = (v: boolean) => { heardRef.current = v; setHeard(v); };

  const hasSR = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => { try { const m = localStorage.getItem('jarvisMuted') === '1'; setMuted(m); mutedRef.current = m; } catch {} }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  // Keep the tail of a long dictation visible instead of the first few words
  useEffect(() => { const el = inputRef.current; if (el) el.scrollLeft = el.scrollWidth; }, [q]);

  // Prompt examples that name the user's own projects, not made-up ones
  useEffect(() => {
    if (!open) return;
    getProjects().then(res => {
      const names = (res.success ? res.projects || [] : []).slice(0, 2).map((p: any) => p.name);
      setSuggestions([
        BASE_SUGGESTIONS[0],
        ...names.map((n: string) => `Tell me about recent tasks in ${n}`),
        BASE_SUGGESTIONS[1],
      ].slice(0, 3));
    }).catch(() => {});
  }, [open]);

  const clearSilence = () => { if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; } };

  const stopListening = useCallback(() => {
    stoppingRef.current = true;
    clearSilence();
    try { recRef.current?.stop(); } catch {}
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
    setModeBoth('idle');
  }, []);

  // ---------- speaking ----------
  const stopSpeaking = useCallback(() => { if (hasTTS) window.speechSynthesis.cancel(); speakingRef.current = false; setSpeaking(false); }, [hasTTS]);

  /** Closes the mic first — Jarvis must never hear itself. Callers reopen it when they want you back. */
  const speak = useCallback((text: string) => new Promise<void>(resolve => {
    stopListening();
    if (!hasTTS || mutedRef.current || !text) { speakingRef.current = false; return resolve(); }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = voiceLang(text);
    u.rate = 1.02;
    // Chrome silently stops an utterance after ~15s unless it's nudged, which truncates any
    // answer longer than a couple of sentences. resume() on a speaking synth is a no-op elsewhere.
    const keepAlive = setInterval(() => { try { window.speechSynthesis.resume(); } catch {} }, 9000);
    const done = () => { clearInterval(keepAlive); speakingRef.current = false; setSpeaking(false); resolve(); };
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }), [hasTTS, stopListening]);

  // ---------- asking ----------
  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question) return;
    setQ('');
    finalRef.current = '';
    committedRef.current = '';
    stopSpeaking();
    const history: JarvisTurn[] = msgsRef.current.map(m => ({ role: m.role, content: m.content }));
    setMsgs(m => [...m, { role: 'user', content: question }]);
    setBusy(true);
    const res = await askJarvis(question, history, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if (res.success) for (const t of res.createdTasks || []) syncTask(t);
    const reply: Msg = res.success
      ? { role: 'assistant', content: res.answer || '…', items: res.items }
      : { role: 'assistant', content: res.error || 'Something went wrong.' };
    setMsgs(m => [...m, reply]);
    // A failed turn ends the loop — otherwise a rate limit would keep firing more requests at it
    if (!res.success) loopRef.current = false;
    // The session row is born here, on the first turn, and updated in place after that
    saveJarvisSession(sessionIdRef.current, [...history, { role: 'user', content: question }, reply])
      .then(r => { if (r.success && r.id) sessionIdRef.current = r.id; })
      .catch(() => {});
    await speak(reply.content);
    // A beat before the mic reopens — otherwise it starts capturing the moment Jarvis stops,
    // which reads as being cut off. Muted means nothing was spoken at all, so leave roughly
    // the time it takes to read the reply instead.
    await new Promise(r => setTimeout(r, mutedRef.current ? Math.min(8000, 1200 + reply.content.length * 28) : 900));
    listenAgainRef.current();   // keep the conversation going until you stop the mic or close
  }, [speak, stopSpeaking]);

  // ---------- listening ----------
  const submitNow = useCallback(() => {
    clearSilence();
    const text = (committedRef.current + finalRef.current).trim();
    committedRef.current = '';
    finalRef.current = '';
    stoppingRef.current = true;
    try { recRef.current?.stop(); } catch {}
    setModeBoth('idle');
    setHeardBoth(false);
    if (text) ask(text);
  }, [ask]);

  /** Once you've started talking, send after a pause. Before that, just wait. */
  const armSubmit = useCallback(() => {
    clearSilence();
    silenceRef.current = setTimeout(submitNow, SILENCE_MS);
  }, [submitNow]);

  /** Give you plenty of time to begin — nothing is sent until you speak. */
  const armWaitForSpeech = useCallback(() => {
    clearSilence();
    silenceRef.current = setTimeout(() => {
      if (heardRef.current) return;      // speech arrived; the pause timer owns it now
      stoppingRef.current = true;
      try { recRef.current?.stop(); } catch {}
      setModeBoth('idle');
      setQ('');
      loopRef.current = false;           // you went quiet — stop reopening the mic
    }, WAIT_FOR_SPEECH_MS);
  }, []);

  /** Listens continuously and only sends after a real pause, so you can think mid-sentence. */
  const startRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    if (modeRef.current === 'capturing') return true;   // already live — never run two sessions
    clearSilence();
    try { recRef.current?.stop(); } catch {}

    const rec = new SR();
    // Web Speech takes exactly one language — there is no both. hi-IN transliterated spoken
    // English into Devanagari, which is the wrong way round for a vault kept in English, so
    // en-IN it is: English is exact and Hindi comes back as Latin-script Hinglish, which the
    // system prompt already reads. Whisper (Android path) auto-detects and handles both.
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = true;
    stoppingRef.current = false;
    startedRef.current = false;
    setHeardBoth(false);
    finalRef.current = '';
    committedRef.current = '';
    setModeBoth('capturing');

    rec.onstart = () => { startedRef.current = true; retriedRef.current = false; setVoiceBlocked(false); };

    rec.onresult = (e: any) => {
      // Ignore our own voice coming back through the mic
      if (speakingRef.current) return;
      if (modeRef.current !== 'capturing') return;

      // Rebuild the transcript from the whole result list rather than appending this event's
      // slice. e.results is cumulative for the session and Chrome re-fires over indices it has
      // already settled, so appending turned "do you have any contact about Sarabjit Bal" into
      // "do do you do you have do you have any…". Deriving it fresh makes this handler
      // idempotent: however many times an index is replayed, the text cannot double up.
      let finals = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      finalRef.current = finals;
      const shown = (committedRef.current + finals + interim).trim();
      setQ(shown);
      if (shown) { setHeardBoth(true); armSubmit(); }   // pause timer starts only once you speak
    };

    rec.onerror = (e: any) => {
      if (e?.error === 'no-speech' || e?.error === 'aborted') return;
      stoppingRef.current = true;
      setModeBoth('idle');
    };
    rec.onend = () => {
      if (stoppingRef.current) { setModeBoth('idle'); return; }
      // Chrome ends instantly (no onstart) when the call had no user gesture — retry once, then ask for a tap
      if (!startedRef.current) {
        if (retriedRef.current) { setModeBoth('idle'); setVoiceBlocked(true); return; }
        retriedRef.current = true;
        setTimeout(() => { try { rec.start(); } catch { setModeBoth('idle'); setVoiceBlocked(true); } }, 250);
        return;
      }
      // Sessions are short-lived; keep it alive. The new one starts with an empty results list,
      // so bank what this one finalised or rebuilding from e.results would drop it.
      committedRef.current += finalRef.current;
      finalRef.current = '';
      try { rec.start(); } catch { setModeBoth('idle'); }
    };

    recRef.current = rec;
    try { rec.start(); } catch { return false; }
    return true;
  }, [armSubmit, hasTTS]);

  /** Fallback for the Android app (no Web Speech API): tap-to-talk, stops on silence. */
  const recordOnce = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setModeBoth('idle');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1200) { setQ(''); return; }
        setQ('Transcribing…'); setBusy(true);
        const fd = new FormData(); fd.append('audio', blob, 'q.webm');
        const tr = await transcribeQuestion(fd);
        setBusy(false);
        if (tr.success && tr.text) { setQ(tr.text); ask(tr.text); }
        else if (tr.error) {   // rate limit or server error — stop, don't retry straight into it
          setQ('');
          loopRef.current = false;
          setMsgs(m => [...m, { role: 'assistant', content: tr.error! }]);
          await speak(tr.error!);
        }
        else { setQ(''); speak("Sorry, I didn't catch that."); }
      };
      mediaRef.current = rec;
      setModeBoth('capturing');
      rec.start();

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const startedAt = Date.now();
      let quietSince: number | null = null;
      let spoke = false;
      const tick = () => {
        if (rec.state !== 'recording') { ctx.close().catch(() => {}); return; }
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const now = Date.now();
        if (peak > 6) { spoke = true; quietSince = null; } else if (quietSince === null) quietSince = now;

        // Only close the clip once you've actually said something and then gone quiet
        if (spoke && quietSince && now - startedAt > MIN_SPEECH_MS && now - quietSince > SILENCE_MS) { rec.stop(); return; }
        if (!spoke && now - startedAt > WAIT_FOR_SPEECH_MS) { rec.stop(); return; }
        if (now - startedAt > 60000) { rec.stop(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      speak('Microphone is not available.');
      setModeBoth('idle');
    }
  }, [ask, speak]);

  // Mic button: start listening; once you've spoken it doubles as "send now"
  const micTap = () => {
    if (mode === 'capturing') {
      if (heardRef.current) { clearSilence(); submitNow(); return; }   // mid-sentence: send what you said
      loopRef.current = false;                                          // silent tap = mic off, conversation over
      stopListening();
      return;
    }
    stopSpeaking();
    setVoiceBlocked(false); retriedRef.current = false;
    loopRef.current = true;
    listenAgainRef.current();
  };

  // Reopen the mic after each answer so you can just keep talking.
  listenAgainRef.current = () => {
    if (!openRef.current || !loopRef.current) return;
    if (hasSR) { startRecognition(); armWaitForSpeech(); }
    else recordOnce();                                    // Android webview: no Web Speech API
  };

  // ---------- panel lifecycle ----------
  const closePanel = useCallback(() => { loopRef.current = false; stopListening(); stopSpeaking(); setOpen(false); }, [stopListening, stopSpeaking]);

  /** Greets, then listens; every answer reopens the mic until you stop it or close the panel. */
  const openPanel = useCallback(() => {
    setOpen(true);
    openRef.current = true;
    loopRef.current = true;
    // Every open is a fresh conversation; the previous one is already saved under Chats
    setMsgs([]);
    sessionIdRef.current = null;
    setTab('chat');
    stopSpeaking();
    setVoiceBlocked(false);
    retriedRef.current = false;
    // Mic opens only once the greeting has finished playing, so it captures you and not Jarvis
    speak(GREETING).then(() => listenAgainRef.current());
  }, [speak, stopSpeaking]);

  const toggleOpen = () => (openRef.current ? closePanel() : openPanel());

  useEffect(() => () => { stopListening(); stopSpeaking(); }, [stopListening, stopSpeaking]);

  // Tap outside (or Esc) closes the assistant and releases the mic
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || fabRef.current?.contains(t)) return;
      closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, closePanel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleOpen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanel, closePanel]);

  // ---------- saved chats ----------
  const showSessions = () => {
    loopRef.current = false;                // browsing history, not talking
    stopListening(); stopSpeaking();
    setTab('sessions');
    getJarvisSessions().then(r => { if (r.success) setSessions(r.sessions || []); }).catch(() => {});
  };

  const openSession = async (id: string) => {
    const r = await getJarvisSession(id);
    if (!r.success) return;
    sessionIdRef.current = id;
    setMsgs(r.messages || []);
    setTab('chat');
  };

  const removeSession = async (id?: string) => {
    const r = await deleteJarvisSession(id);
    if (!r.success) return;
    setSessions(s => (id ? s.filter(x => x.id !== id) : []));
    // Deleting the chat you're in leaves the transcript on screen but detached — the next
    // turn starts a new row rather than resurrecting the deleted one.
    if (!id || id === sessionIdRef.current) sessionIdRef.current = null;
  };

  const toggleMute = () => {
    const next = !muted; setMuted(next); mutedRef.current = next;
    try { localStorage.setItem('jarvisMuted', next ? '1' : '0'); } catch {}
    if (next) stopSpeaking();
  };

  if (status !== 'authenticated') return null;

  const statusLabel =
    busy ? 'Thinking…'
    : mode === 'capturing' ? (q ? 'Listening… pause when you\'re done' : 'Listening… go ahead, or tap the mic to stop')
    : speaking ? 'Speaking… tap to interrupt'
    : voiceBlocked ? 'Tap the mic to enable voice'
    : 'Tap the mic to speak';

  return (
    <>
      <button ref={fabRef} className={`jarvis-fab ${open ? 'is-open' : ''} ${mode === 'capturing' ? 'listening' : ''}`} onClick={toggleOpen} title="Jarvis (Ctrl+J)" aria-label="Jarvis">
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {open && (
        <div className="jarvis-panel" ref={panelRef}>
          <div className="jarvis-head">
            <span className={`jarvis-dot ${mode === 'capturing' ? 'live' : ''}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>Jarvis</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{statusLabel}</div>
            </div>
            {hasTTS && (
              <button className="icon-btn" onClick={toggleMute} title={muted ? 'Unmute voice' : 'Mute voice'} style={{ width: '32px', height: '32px' }}>
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            )}
            <button className="icon-btn" onClick={closePanel}
              title="Close Jarvis" aria-label="Close Jarvis" style={{ width: '32px', height: '32px' }}>
              <X size={16} />
            </button>
          </div>

          <div className="jarvis-tabs">
            <button className={`jarvis-tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>Chat</button>
            <button className={`jarvis-tab ${tab === 'sessions' ? 'on' : ''}`} onClick={showSessions}>
              <MessageSquare size={13} /> Chats
            </button>
          </div>

          {tab === 'sessions' ? (
            <div className="jarvis-body">
              {sessions.length === 0
                ? <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No saved chats yet.</p>
                : <>
                    <button className="jarvis-sess-all" onClick={() => removeSession()}>
                      <Trash2 size={13} /> Delete all {sessions.length}
                    </button>
                    {sessions.map(s => (
                      <div key={s.id} className="jarvis-sess">
                        <button className="jarvis-sess-open" onClick={() => openSession(s.id)}>
                          <span style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{when(s.updatedAt)}</span>
                        </button>
                        <button className="jarvis-sess-del" onClick={() => removeSession(s.id)} aria-label="Delete chat" title="Delete chat">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </>}
            </div>
          ) : (
          <div className="jarvis-body">
            {msgs.length === 0 && (
              <div>
                <p style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '4px' }}>{GREETING}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Tap the mic and ask, or tap one:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {suggestions.map(s => <button key={s} className="jarvis-suggest" onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`jarvis-msg ${m.role}`}>
                <div className="jarvis-bubble">{m.content}</div>
                {m.items && m.items.length > 0 && (
                  <div className="jarvis-items">
                    {m.items.map(it => {
                      const href = itemHref(it);
                      const external = href.startsWith('http');
                      return (
                        <a key={it.id} className={`jarvis-item ${it.urgent ? 'urgent' : ''}`} href={href}
                          target={external ? '_blank' : undefined} rel="noreferrer"
                          onClick={e => { if (!external) { e.preventDefault(); closePanel(); router.push(href); } }}>
                          <span className="jarvis-type">{it.urgent ? 'URGENT' : it.type}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                            {it.detail && <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{it.detail}</span>}
                          </span>
                          <ArrowUpRight size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="jarvis-msg assistant"><div className="jarvis-bubble" style={{ opacity: 0.6 }}>Looking through your vault…</div></div>}
            <div ref={bottomRef} />
          </div>
          )}

          {tab === 'chat' && (
          <div className="jarvis-input">
            <button type="button" className={`jarvis-mic ${mode === 'capturing' ? 'on' : ''}`}
              onClick={micTap} disabled={busy} aria-label={mode === 'capturing' && heard ? 'Send' : 'Speak'}>
              {mode === 'capturing' && heard ? <Square size={18} fill="currentColor" /> : <Mic size={20} />}
            </button>
            <form style={{ display: 'flex', gap: '8px', flex: 1 }} onSubmit={e => { e.preventDefault(); ask(q); }}>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                placeholder={mode === 'capturing' ? 'Listening…' : 'Ask anything…'} />
              <button type="submit" disabled={!q.trim() || busy || mode === 'capturing'} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
          )}
        </div>
      )}
    </>
  );
}
