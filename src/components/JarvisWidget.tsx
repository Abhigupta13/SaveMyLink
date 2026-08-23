'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sparkles, X, Send, ArrowUpRight, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { askJarvis, transcribeQuestion, JarvisItem, JarvisTurn } from '@/actions/jarvis';
import { syncTask } from '@/lib/taskNotifications';

type Msg = JarvisTurn & { items?: JarvisItem[] };

const GREETING = "What's on your mind?";
const SUGGESTIONS = ['What is urgent today?', 'Remind me to call Rohan tomorrow at 5pm', 'Did I save a site that turns code into images?'];

function itemHref(i: JarvisItem) {
  if (i.type === 'link' && i.url) return i.url;
  if (i.type === 'task' || i.type === 'project') return '/tasks';
  if (i.type === 'mom') return '/mom';
  if (i.type === 'contact') return '/contacts';
  if (i.type === 'note') return '/notes';
  return '/links';
}

// Strip markdown-ish bullets so TTS doesn't read dashes
const speakable = (s: string) => s.replace(/^[-*•]\s*/gm, '').replace(/\s+/g, ' ').trim();

export default function JarvisWidget() {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);          // SpeechRecognition instance
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  const hasSR = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => { try { setMuted(localStorage.getItem('jarvisMuted') === '1'); } catch {} }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  // ---- speech out ----
  const stopSpeaking = useCallback(() => { if (hasTTS) window.speechSynthesis.cancel(); setSpeaking(false); }, [hasTTS]);
  const speak = useCallback((text: string) => {
    if (!hasTTS || muted || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = 'en-IN';
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [hasTTS, muted]);

  // ---- ask ----
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
    // Tasks Jarvis just created need their on-device reminders scheduled
    if (res.success) for (const t of res.createdTasks || []) syncTask(t);
    const reply: Msg = res.success
      ? { role: 'assistant', content: res.answer || '…', items: res.items }
      : { role: 'assistant', content: res.error || 'Something went wrong.' };
    setMsgs(m => [...m, reply]);
    speak(reply.content);
  }, [speak, stopSpeaking]);

  // ---- speech in ----
  const stopListening = useCallback(() => {
    recRef.current?.stop();
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(async () => {
    if (listening || busy) return;
    stopSpeaking();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = 'en-IN';
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        const text = [...e.results].map((r: any) => r[0].transcript).join('');
        setQ(text);
        if (e.results[e.results.length - 1].isFinal) { rec.stop(); ask(text); }
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
      return;
    }
    // Fallback (Android WebView): record → Whisper
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setListening(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setQ('Transcribing…'); setBusy(true);
        const fd = new FormData(); fd.append('audio', blob, 'q.webm');
        const tr = await transcribeQuestion(fd);
        setBusy(false);
        if (tr.success && tr.text) { setQ(tr.text); ask(tr.text); }
        else { setQ(''); speak("Sorry, I didn't catch that."); }
      };
      mediaRef.current = rec;
      setListening(true);
      rec.start();
      // safety stop after 20s of talking
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 20000);
    } catch {
      speak('Microphone is not available.');
    }
  }, [listening, busy, stopSpeaking, ask, speak]);

  // Open: greet aloud and start listening (voice-first)
  const toggleOpen = () => {
    setOpen(o => {
      const next = !o;
      if (next) {
        setTimeout(() => { speak(GREETING); }, 150);
        setTimeout(() => { startListening(); }, muted ? 200 : 1400);
      } else { stopSpeaking(); stopListening(); }
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleOpen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  const toggleMute = () => {
    const next = !muted; setMuted(next);
    try { localStorage.setItem('jarvisMuted', next ? '1' : '0'); } catch {}
    if (next) stopSpeaking();
  };

  if (status !== 'authenticated') return null;

  const micLabel = listening ? 'Listening… tap to stop' : busy ? 'Thinking…' : speaking ? 'Speaking… tap to interrupt' : 'Tap to speak';

  return (
    <>
      <button className={`jarvis-fab ${listening ? 'listening' : ''}`} onClick={toggleOpen} title="Jarvis (Ctrl+J)" aria-label="Jarvis">
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {open && (
        <div className="jarvis-panel">
          <div className="jarvis-head">
            <span className={`jarvis-dot ${listening ? 'live' : ''}`} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>Jarvis</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{micLabel}</div>
            </div>
            {hasTTS && (
              <button className="icon-btn" onClick={toggleMute} title={muted ? 'Unmute voice' : 'Mute voice'} style={{ width: '32px', height: '32px' }}>
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            )}
          </div>

          <div className="jarvis-body">
            {msgs.length === 0 && (
              <div>
                <p style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '4px' }}>{GREETING}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>Speak, or tap one of these:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {SUGGESTIONS.map(s => <button key={s} className="jarvis-suggest" onClick={() => ask(s)}>{s}</button>)}
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
                          onClick={e => { if (!external) { e.preventDefault(); setOpen(false); stopSpeaking(); router.push(href); } }}>
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
            <button type="button" className={`jarvis-mic ${listening ? 'on' : ''}`} onClick={listening ? stopListening : startListening} disabled={busy} aria-label={listening ? 'Stop' : 'Speak'}>
              {listening ? <Square size={18} fill="currentColor" /> : <Mic size={20} />}
            </button>
            <form style={{ display: 'flex', gap: '8px', flex: 1 }} onSubmit={e => { e.preventDefault(); ask(q); }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={listening ? 'Listening…' : 'or type here…'} />
              <button type="submit" disabled={!q.trim() || busy || listening} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
