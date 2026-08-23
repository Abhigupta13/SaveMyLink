'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sparkles, X, Send, ArrowUpRight, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { askJarvis, transcribeQuestion, JarvisItem, JarvisTurn } from '@/actions/jarvis';
import { syncTask } from '@/lib/taskNotifications';
import { getProjects } from '@/actions/project';

type Msg = JarvisTurn & { items?: JarvisItem[] };
type Mode = 'idle' | 'capturing';

const GREETING = "What's on your mind?";
const BASE_SUGGESTIONS = ['What is urgent today?', 'What did I save this week?'];

const SILENCE_MS = 1300;           // quiet time AFTER you've spoken before we send
const WAIT_FOR_SPEECH_MS = 12000;  // how long the mic waits for you to begin before giving up
const MIN_SPEECH_MS = 400;         // ignore a stray cough as a whole utterance
const MAX_CLIP_MS = 60000;
const SPEECH_PEAK = 6;             // amplitude above silence that counts as talking

function itemHref(i: JarvisItem) {
  if (i.type === 'link' && i.url) return i.url;
  if (i.type === 'task' || i.type === 'project') return '/tasks';
  if (i.type === 'mom') return '/mom';
  if (i.type === 'contact') return '/contacts';
  if (i.type === 'note') return '/notes';
  return '/links';
}
const speakable = (s: string) => s.replace(/^[-*•]\s*/gm, '').replace(/\s+/g, ' ').trim();
// Speak Hindi replies with a Hindi voice; Hinglish comes back in Latin script and stays on en-IN.
const voiceLang = (s: string) => /[ऀ-ॿ]/.test(s) ? 'hi-IN' : 'en-IN';

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

  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const modeRef = useRef<Mode>('idle');
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);     // our own flag: speechSynthesis.speaking gets stuck in Chrome
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  const openRef = useRef(false);
  openRef.current = open;
  const loopRef = useRef(false);              // conversation mode: reopen the mic after each answer
  const listenAgainRef = useRef<() => void>(() => {});   // set below; breaks the ask ⇄ startRecognition cycle
  const setModeBoth = (m: Mode) => { modeRef.current = m; setMode(m); };

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

  const stopListening = useCallback(() => {
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
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    u.onend = () => { speakingRef.current = false; setSpeaking(false); resolve(); };
    u.onerror = () => { speakingRef.current = false; setSpeaking(false); resolve(); };
    window.speechSynthesis.speak(u);
  }), [hasTTS, stopListening]);

  // ---------- asking ----------
  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question) return;
    setQ('');
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
    await speak(reply.content);
    listenAgainRef.current();   // keep the conversation going until you stop the mic or close
  }, [speak, stopSpeaking]);

  // ---------- listening ----------
  // Kept open across turns: re-acquiring the mic each turn costs a few hundred ms and
  // makes the browser's recording indicator blink between turns.
  const getStream = useCallback(async () => {
    if (streamRef.current?.active) return streamRef.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = s;
    return s;
  }, []);
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Records one utterance and sends it to Whisper. Endpointing is done on the audio
   * itself — the browser's SpeechRecognition is not used at all, because it accepts
   * exactly one language (so English came back transliterated into Devanagari) and its
   * restart-on-end lifecycle races across turns. Whisper detects the language itself.
   */
  const listen = useCallback(async () => {
    if (modeRef.current === 'capturing') return;
    setModeBoth('capturing');
    let stream: MediaStream;
    try {
      stream = await getStream();
    } catch {
      setModeBoth('idle');
      loopRef.current = false;
      speak('Microphone is not available.');
      return;
    }
    if (!openRef.current || !loopRef.current) { setModeBoth('idle'); return; }   // closed while the mic was opening

    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
    chunksRef.current = [];
    let spoke = false;
    rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      setModeBoth('idle');
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (!spoke || blob.size < 1200) { setQ(''); loopRef.current = false; return; }  // silence = you're done talking
      setQ('Transcribing…'); setBusy(true);
      const fd = new FormData(); fd.append('audio', blob, 'q.webm');
      const tr = await transcribeQuestion(fd);
      setBusy(false);
      if (tr.success && tr.text) { setQ(tr.text); ask(tr.text); }
      else if (tr.error && !tr.success) {   // rate limit or server error — stop, don't retry into it
        setQ('');
        loopRef.current = false;
        setMsgs(m => [...m, { role: 'assistant', content: tr.error! }]);
        await speak(tr.error!);
      }
      else { setQ(''); await speak("Sorry, I didn't catch that."); listenAgainRef.current(); }
    };
    mediaRef.current = rec;
    rec.start();

    // Endpointing: wait for speech, then close the clip once you've gone quiet.
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    let quietSince: number | null = null;
    const tick = () => {
      if (rec.state !== 'recording') { src.disconnect(); ctx.close().catch(() => {}); return; }
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      const now = Date.now();
      if (peak > SPEECH_PEAK) { spoke = true; quietSince = null; } else if (quietSince === null) quietSince = now;

      if (spoke && quietSince && now - startedAt > MIN_SPEECH_MS && now - quietSince > SILENCE_MS) { rec.stop(); return; }
      if (!spoke && now - startedAt > WAIT_FOR_SPEECH_MS) { rec.stop(); return; }   // nothing said → onstop ends the loop
      if (now - startedAt > MAX_CLIP_MS) { rec.stop(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [ask, speak, getStream]);

  // Mic button: off while listening, on otherwise.
  const micTap = () => {
    if (mode === 'capturing') { loopRef.current = false; stopListening(); setQ(''); return; }
    stopSpeaking();
    loopRef.current = true;
    listenAgainRef.current();
  };

  // Reopen the mic after every answer so the conversation just continues.
  listenAgainRef.current = () => {
    if (!openRef.current || !loopRef.current) return;
    listen();
  };

  // ---------- panel lifecycle ----------
  const closePanel = useCallback(() => { loopRef.current = false; stopListening(); stopSpeaking(); releaseStream(); setOpen(false); }, [stopListening, stopSpeaking, releaseStream]);

  /** Greets, then listens; every answer reopens the mic until you stop it or close the panel. */
  const openPanel = useCallback(() => {
    setOpen(true);
    openRef.current = true;
    loopRef.current = true;
    stopSpeaking();
    // Mic opens only once the greeting has finished playing, so it captures you and not Jarvis
    speak(GREETING).then(() => listenAgainRef.current());
  }, [speak, stopSpeaking]);

  const toggleOpen = () => (openRef.current ? closePanel() : openPanel());

  useEffect(() => () => { stopListening(); stopSpeaking(); releaseStream(); }, [stopListening, stopSpeaking, releaseStream]);

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

  const toggleMute = () => {
    const next = !muted; setMuted(next); mutedRef.current = next;
    try { localStorage.setItem('jarvisMuted', next ? '1' : '0'); } catch {}
    if (next) stopSpeaking();
  };

  if (status !== 'authenticated') return null;

  const statusLabel =
    busy ? 'Thinking…'
    : mode === 'capturing' ? 'Listening… pause when you\'re done'
    : speaking ? 'Speaking… tap to interrupt'
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

          <div className="jarvis-input">
            <button type="button" className={`jarvis-mic ${mode === 'capturing' ? 'on' : ''}`}
              onClick={micTap} disabled={busy} aria-label={mode === 'capturing' ? 'Stop listening' : 'Speak'}>
              {mode === 'capturing' ? <Square size={18} fill="currentColor" /> : <Mic size={20} />}
            </button>
            <form style={{ display: 'flex', gap: '8px', flex: 1 }} onSubmit={e => { e.preventDefault(); ask(q); }}>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                placeholder={mode === 'capturing' ? 'Listening…' : 'Ask anything…'} />
              <button type="submit" disabled={!q.trim() || busy || mode === 'capturing'} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
