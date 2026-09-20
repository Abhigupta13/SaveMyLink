'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sparkles, X, Send, ArrowUpRight, Mic, Square, Volume2, VolumeX, Trash2, MessageSquare, Users } from 'lucide-react';
import {
  askJarvis, transcribeQuestion, getJarvisSessions, getJarvisSession, saveJarvisSession,
  deleteJarvisSession, runJarvisActions, JarvisItem, JarvisTurn, Msg, JarvisSessionMeta, JarvisPending,
} from '@/actions/jarvis';
import {
  jarvisIsConfirm, jarvisIsDecline, jarvisLooksLikeRevision, HELD_NUDGE,
} from '@/lib/jarvisWriteConfirm';
import { capMessage, JARVIS_DAILY_LIMIT, SHARED_OUT_MESSAGE } from '@/lib/jarvisLimit';
import { pickVoice } from '@/lib/voice';
import { mergeFinals, joinTranscripts } from '@/lib/transcript';
import { syncTask } from '@/lib/taskNotifications';
import { getProjects } from '@/actions/project';
import { markIntro } from '@/actions/intro';
import { formatTime, formatDay } from '@/lib/time';
import { ownsItsFrame } from '@/lib/nav';

type Mode = 'idle' | 'capturing';
type Tab = 'chat' | 'sessions';

const GREETING = "What's on your mind?";
/** If the user says nothing after a create/update/delete proposal, apply it anyway. */
const HELD_AUTO_CONFIRM_MS = 5000;
const BASE_SUGGESTIONS = ['What is urgent today?', 'What did I save this week?'];

/** After you've spoken, this much quiet auto-sends. No speech yet → keep listening. */
const SILENCE_MS = 5000;
const MIN_SPEECH_MS = 800;
const MAX_RECORD_MS = 120_000;

function itemHref(i: JarvisItem) {
  if (i.type === 'link' && i.url) return i.url;
  if (i.type === 'project') return '/projects';
  if (i.type === 'task') return '/tasks';
  if (i.type === 'mom') return '/mom';
  if (i.type === 'contact') return '/contacts';
  if (i.type === 'note') return '/notes';
  if (i.type === 'document') return '/d-locker';
  if (i.type === 'expense') return '/expenses';
  return '/links';
}
const speakable = (s: string) => s.replace(/^[-*•]\s*/gm, '').replace(/\s+/g, ' ').trim();
// Round 5: male whenever the speech comes from the non-Sarvam path, which today is every word the
// widget says — the browser synthesiser here, Gemini TTS when that lands. Sarvam speaks female;
// lib/sarvam is transcription-only so far, so nothing calls pickVoice with 'female' yet, and the
// day it does it is this one argument.
const JARVIS_VOICE = 'male' as const;
// Speak Hindi replies with a Hindi voice; Hinglish comes back in Latin script and stays on en-IN.
const voiceLang = (s: string) => /[ऀ-ॿ]/.test(s) ? 'hi-IN' : 'en-IN';
const when = (iso: string) => {
  const t = new Date(iso);
  return `${formatDay(t)} · ${formatTime(t)}`;
};

/** Round-trip time in seconds, one decimal, for the small label under assistant replies. */
const responseSec = (t0: number) => Math.max(0.1, Math.round((performance.now() - t0) / 100) / 10);

function WisprWaveform({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="wispr-waveform" title="Wispr Flow Streaming Dictation">
      <span className="bar bar1" />
      <span className="bar bar2" />
      <span className="bar bar3" />
      <span className="bar bar4" />
      <span className="bar bar5" />
    </div>
  );
}

export default function JarvisWidget() {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
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
  const [left, setLeft] = useState<number | null>(null);   // questions left today; null = not counted / unknown
  const [pending, setPending] = useState<JarvisPending[]>([]);   // writes into a group, waiting on a yes
  const [heldWrites, setHeldWrites] = useState<unknown[]>([]); // create/update/delete, waiting on confirm
  const heldWritesRef = useRef<unknown[]>([]);
  const heldAutoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped whenever the 5s auto-confirm is cancelled — stale timeouts must not apply. */
  const heldAutoEpoch = useRef(0);
  const applyingHeldRef = useRef(false);
  const busyRef = useRef(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /**
   * Same claim MomSection makes, for the same reason: `setModeBoth('capturing')` is on the far
   * side of the getUserMedia await, so `micTap`'s `mode === 'capturing'` test cannot see a start
   * that is still in flight. A second tap — or `listenAgainRef` firing again — would build a
   * second MediaRecorder pushing into this same `chunksRef` while `mediaRef` forgot the first,
   * and the question came back with its own words repeated. `startRecognition` already refuses to
   * run two sessions; this is that guard for the Android path, which has no Web Speech API.
   */
  const micBusy = useRef(false);
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
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const msgsRef = useRef<Msg[]>([]);
  const sessionIdRef = useRef<string | null>(null);   // null until this conversation's first save
  const openRef = useRef(false);
  const loopRef = useRef(false);              // conversation mode: reopen the mic after each answer
  const sharedOutRef = useRef(false);         // provider quota empty — do not keep calling the LLM
  const listenAgainRef = useRef<() => void>(() => {});   // set below; breaks the ask ⇄ startRecognition cycle
  const setModeBoth = (m: Mode) => { modeRef.current = m; setMode(m); };
  const setHeardBoth = (v: boolean) => { heardRef.current = v; setHeard(v); };

  useEffect(() => {
    heldWritesRef.current = heldWrites;
    msgsRef.current = msgs;
    openRef.current = open;
  }, [heldWrites, msgs, open]);

  const hasSR = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => { try { const m = localStorage.getItem('jarvisMuted') === '1'; setMuted(m); mutedRef.current = m; } catch {} }, []);
  // getVoices() is empty on first call in Chrome and fills in later, so listen as well as ask.
  useEffect(() => {
    if (!hasTTS) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [hasTTS]);
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

  const clearHeldAuto = useCallback(() => {
    if (heldAutoRef.current) {
      clearTimeout(heldAutoRef.current);
      heldAutoRef.current = null;
    }
    heldAutoEpoch.current += 1;
  }, []);

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
    // Language first: an English male voice reading Devanagari is worse than a Hindi voice of the
    // wrong gender. Left unset when the device has nothing to choose from, exactly as before.
    const chosen = pickVoice(voicesRef.current, u.lang, JARVIS_VOICE);
    if (chosen) u.voice = chosen as SpeechSynthesisVoice;
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
  const introMarkedRef = useRef(false);   // the checklist's "Ask Jarvis" step, ticked once per mount
  const finishHeldWrites = useCallback(async (actions: unknown[], userLine?: string) => {
    clearHeldAuto();
    if (userLine) setMsgs(m => [...m, { role: 'user', content: userLine }]);
    setHeldWrites([]);
    setBusy(true);
    busyRef.current = true;
    applyingHeldRef.current = true;
    const t0 = performance.now();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let r: Awaited<ReturnType<typeof runJarvisActions>> = { success: false, error: 'Could not do that.' };
    try {
      r = await runJarvisActions(actions, tz, { confirmShared: true });
    } catch {
      r = { success: false, error: 'Could not do that.' };
    } finally {
      applyingHeldRef.current = false;
      setBusy(false);
      busyRef.current = false;
    }
    if (r.success) for (const t of r.createdTasks || []) syncTask(t);
    const reply: Msg = r.success
      ? { role: 'assistant', content: r.items?.length ? `Yes — ${r.items.map(i => i.detail || i.title).join('; ')}.` : 'Done.', items: r.items, responseSec: responseSec(t0) }
      : { role: 'assistant', content: r.error || 'Could not do that.', responseSec: responseSec(t0) };
    setMsgs(m => [...m, reply]);
    if (r.success && r.pending?.length) { loopRef.current = false; setPending(r.pending); }
    await speak(reply.content);
    if (r.success && r.nav) {
      loopRef.current = false; stopListening(); setOpen(false);
      router.push(r.nav);
      return;
    }
    // Write applied — stop the voice loop so side talk is not sent as a new AI question.
    loopRef.current = false;
    stopListening();
  }, [router, speak, stopListening, clearHeldAuto]);

  const finishHeldWritesRef = useRef(finishHeldWrites);
  useEffect(() => {
    finishHeldWritesRef.current = finishHeldWrites;
  }, [finishHeldWrites]);

  const scheduleHeldAutoConfirm = useCallback(() => {
    clearHeldAuto();
    const epoch = heldAutoEpoch.current;
    heldAutoRef.current = setTimeout(() => {
      if (epoch !== heldAutoEpoch.current) return;
      if (applyingHeldRef.current || busyRef.current) return;
      const actions = heldWritesRef.current;
      if (!actions.length || !openRef.current) return;
      finishHeldWritesRef.current(actions);
    }, HELD_AUTO_CONFIRM_MS);
  }, [clearHeldAuto]);

  const refuseAsk = useCallback(async (question: string, error: string) => {
    const last = msgsRef.current.at(-1);
    if (last?.role === 'assistant' && last.content === error) {
      stopListening();
      return;
    }
    const t0 = performance.now();
    setMsgs(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: error, responseSec: responseSec(t0) }]);
    loopRef.current = false;
    stopListening();
    await speak(error);
  }, [speak, stopListening]);

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question) return;
    clearHeldAuto();
    setQ('');
    finalRef.current = '';
    committedRef.current = '';
    stopSpeaking();

    if (sharedOutRef.current) {
      await refuseAsk(question, SHARED_OUT_MESSAGE);
      return;
    }
    if (left === 0) {
      await refuseAsk(question, capMessage(JARVIS_DAILY_LIMIT));
      return;
    }

    const held = heldWritesRef.current;
    if (held.length && jarvisIsConfirm(question)) {
      await finishHeldWrites(held, question);
      return;
    }
    if (held.length && jarvisIsDecline(question)) {
      const t0 = performance.now();
      setHeldWrites([]);
      setMsgs(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: 'Okay — I won\'t make that change. Tell me what you want instead.', responseSec: responseSec(t0) }]);
      await speak('Okay — tell me what you want instead.');
      loopRef.current = true;
      await new Promise(r => setTimeout(r, 900));
      listenAgainRef.current();
      return;
    }
    if (held.length && !jarvisLooksLikeRevision(question)) {
      const t0 = performance.now();
      setMsgs(m => [...m, { role: 'user', content: question }, { role: 'assistant', content: HELD_NUDGE, responseSec: responseSec(t0) }]);
      await speak(HELD_NUDGE);
      scheduleHeldAutoConfirm();
      if (loopRef.current) listenAgainRef.current();
      return;
    }

    // Revision — drop the pending write immediately so a stale 5s timer cannot apply the old one.
    if (held.length) setHeldWrites([]);

    const history: JarvisTurn[] = msgsRef.current.map(m => ({ role: m.role, content: m.content, ids: m.items?.map(i => i.id) }));
    setMsgs(m => [...m, { role: 'user', content: question }]);
    setBusy(true);
    busyRef.current = true;
    const t0 = performance.now();
    const res = await askJarvis(question, history, Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    busyRef.current = false;
    // -1 means this account is not counted (an admin); undefined means the turn never reached the
    // counter at all. Neither is a number to show anyone.
    if (typeof res.remaining === 'number' && res.remaining >= 0) setLeft(res.remaining);
    if (res.success) for (const t of res.createdTasks || []) syncTask(t);
    if (res.success && !introMarkedRef.current) { introMarkedRef.current = true; markIntro('jarvis').catch(() => {}); }
    if (res.success && res.heldWrites?.length) {
      setHeldWrites(res.heldWrites);
      loopRef.current = true;   // waiting on yes/no — reopen mic after Jarvis speaks
    } else {
      setHeldWrites([]);
    }
    // A sheet is waiting on an answer — do not reopen the mic behind it
    if (res.success && res.pending?.length) { loopRef.current = false; setPending(res.pending); }
    const sec = responseSec(t0);
    const reply: Msg = res.success
      ? { role: 'assistant', content: res.answer || '…', items: res.items, responseSec: sec }
      : { role: 'assistant', content: res.error || 'Something went wrong.', responseSec: sec };
    setMsgs(m => [...m, reply]);
    // A failed turn ends the loop — otherwise a rate limit would keep firing more requests at it
    if (!res.success) {
      loopRef.current = false;
      stopListening();
      if (res.error === SHARED_OUT_MESSAGE) sharedOutRef.current = true;
      if (res.remaining === 0 || res.error === capMessage(JARVIS_DAILY_LIMIT)) setLeft(0);
    }
    // The session row is born here, on the first turn, and updated in place after that
    saveJarvisSession(sessionIdRef.current, [...history, { role: 'user', content: question }, reply])
      .then(r => { if (r.success && r.id) sessionIdRef.current = r.id; })
      .catch(() => {});
    await speak(reply.content);
    // "Show my tasks" — spoken first, then we actually go. The panel closes with it, because
    // landing on a page behind a covering sheet is not arriving anywhere.
    if (res.success && res.nav) {
      loopRef.current = false; stopListening(); setOpen(false);   // closePanel, minus the cycle it would create
      router.push(res.nav);
      return;
    }
    // A beat before the mic reopens — otherwise it starts capturing the moment Jarvis stops,
    // which reads as being cut off. Muted means nothing was spoken at all, so leave roughly
    // the time it takes to read the reply instead.
    await new Promise(r => setTimeout(r, mutedRef.current ? Math.min(8000, 1200 + reply.content.length * 28) : 900));
    if (res.success && res.heldWrites?.length) scheduleHeldAutoConfirm();
    else clearHeldAuto();
    if (loopRef.current) listenAgainRef.current();   // keep talking until you stop the mic or close
  }, [speak, stopSpeaking, stopListening, router, finishHeldWrites, clearHeldAuto, scheduleHeldAutoConfirm, refuseAsk, left]);

  // ---------- listening ----------
  const submitNow = useCallback(() => {
    clearSilence();
    const text = mergeFinals(committedRef.current, finalRef.current).trim();
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
      // Merged pairwise, never concatenated. Chrome's results are disjoint pieces of the sentence,
      // but Android's WebView emits each result as a longer PREFIX of the same sentence — so
      // joining them built "I am / I am checking / I am checking if" into a ladder before anything
      // else got involved. joinTranscripts collapses that and still joins genuine pieces. The same
      // rule then merges the bank from earlier sessions, which a WebView also repeats.
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        (r.isFinal ? finalParts : interimParts).push(r[0].transcript);
      }
      const finals = joinTranscripts(finalParts);
      finalRef.current = finals;
      const shown = mergeFinals(mergeFinals(committedRef.current, finals), joinTranscripts(interimParts));
      setQ(shown);
      if (shown) {
        if (heldWritesRef.current.length) clearHeldAuto();
        setHeardBoth(true);
        armSubmit();   // pause timer starts only once you speak
      }
    };

    rec.onerror = (e: any) => {
      console.warn('Jarvis WebSpeech error:', e?.error);
      if (e?.error === 'no-speech' || e?.error === 'aborted') return;
      stoppingRef.current = true;
      setModeBoth('idle');
      setTimeout(() => { recordOnce(); }, 100);
    };
    rec.onend = () => {
      if (stoppingRef.current) { setModeBoth('idle'); return; }
      if (!startedRef.current) {
        console.warn('Jarvis WebSpeech failed to start. Automatically switching to MediaRecorder + Whisper...');
        stoppingRef.current = true;
        setModeBoth('idle');
        setTimeout(() => { recordOnce(); }, 100);
        return;
      }
      committedRef.current = mergeFinals(committedRef.current, finalRef.current);
      finalRef.current = '';
      try { rec.start(); } catch { setModeBoth('idle'); recordOnce(); }
    };

    recRef.current = rec;
    try { rec.start(); } catch { return false; }
    return true;
  }, [armSubmit, hasTTS, clearHeldAuto]);

  /** Fallback for the Android app (no Web Speech API): tap-to-talk, stops on silence. */
  const recordOnce = useCallback(async () => {
    if (micBusy.current) return;   // a start is already in flight, or one is already running
    if (heldWritesRef.current.length) clearHeldAuto();
    micBusy.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        micBusy.current = false;
        stream.getTracks().forEach(t => t.stop());
        setModeBoth('idle');
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1200) { setQ(''); return; }
        setQ('Transcribing…'); setBusy(true);
        const t0 = performance.now();
        const fd = new FormData(); fd.append('audio', blob, 'q.webm');
        const tr = await transcribeQuestion(fd);
        setBusy(false);
        if (tr.success && tr.text) { setQ(tr.text); ask(tr.text); }
        else if (tr.error) {   // rate limit or server error — stop, don't retry straight into it
          setQ('');
          loopRef.current = false;
          setMsgs(m => [...m, { role: 'assistant', content: tr.error!, responseSec: responseSec(t0) }]);
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

      /* Close the AudioContext on EVERY way out of the loop, exactly once.
         Only the `rec.state !== 'recording'` branch used to close it — and that branch was
         unreachable, because all three normal exits below call rec.stop() and return without
         scheduling another tick, so nothing ever looked at rec.state again. One context leaked per
         voice question. Chrome caps a page at six concurrent AudioContexts, so the seventh
         `new AudioContext()` threw, fell into the outer catch, and told the user "Microphone is not
         available." — a microphone fault message for a resource leak, after about six questions. */
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        ctx.close().catch(() => {});
      };

      const tick = () => {
        if (rec.state !== 'recording') { release(); return; }
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const now = Date.now();
        if (peak > 6) { spoke = true; quietSince = null; } else if (quietSince === null) quietSince = now;

        // Stop only after speech + silence, or a long cap — never for "no speech yet"
        if (spoke && quietSince && now - startedAt > MIN_SPEECH_MS && now - quietSince > SILENCE_MS) { rec.stop(); release(); return; }
        if (now - startedAt > MAX_RECORD_MS) { rec.stop(); release(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      micBusy.current = false;   // nothing to stop, so nothing else will release it
      speak('Microphone is not available.');
      setModeBoth('idle');
    }
  }, [ask, speak, clearHeldAuto]);

  // Mic button: start listening; once you've spoken it doubles as "send now"
  const micTap = () => {
    if (mode === 'capturing') {
      if (heardRef.current) { clearSilence(); submitNow(); return; }   // mid-sentence: send what you said
      loopRef.current = false;                                          // silent tap = mic off, conversation over
      stopListening();
      return;
    }
    stopSpeaking();
    if (heldWritesRef.current.length) clearHeldAuto();
    setVoiceBlocked(false);
    retriedRef.current = false;
    loopRef.current = true;
    if (hasSR) startRecognition();
    else recordOnce();
  };

  // Reopen the mic after each answer so you can just keep talking.
  const listenAgain = useCallback(() => {
    if (!openRef.current || !loopRef.current) return;
    if (hasSR) startRecognition();
    else recordOnce();
  }, [hasSR, startRecognition, recordOnce]);

  useEffect(() => {
    listenAgainRef.current = listenAgain;
  }, [listenAgain]);

  // ---------- panel lifecycle ----------
  const closePanel = useCallback(() => {
    clearHeldAuto();
    sharedOutRef.current = false;
    loopRef.current = false; stopListening(); stopSpeaking(); setPending([]); setHeldWrites([]); setOpen(false);
  }, [stopListening, stopSpeaking, clearHeldAuto]);

  useEffect(() => () => clearHeldAuto(), [clearHeldAuto]);

  /** Greets, then listens; every answer reopens the mic until you stop it or close the panel. */
  const openPanel = useCallback(() => {
    setOpen(true);
    openRef.current = true;
    sharedOutRef.current = false;
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
    // Home's checklist opens the assistant without a keyboard; a ?jarvis=1 link does the same
    const onOpen = () => { if (!openRef.current) openPanel(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('jarvis:open', onOpen);
    if (new URLSearchParams(window.location.search).get('jarvis') === '1') {
      window.history.replaceState(null, '', window.location.pathname);
      onOpen();
    }
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('jarvis:open', onOpen); };
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

  /**
   * Round 2's share sheet, in Jarvis's shape: before the assistant writes into a group, say who
   * will see it. Personal writes never reach here — the server only holds an action that has a
   * group behind it — and the whole gate can be switched off in Profile.
   */
  const settlePending = async (ok: boolean) => {
    const held = pending;
    setPending([]);
    if (!ok || !held.length) {
      if (held.length) {
        const t0 = performance.now();
        setMsgs(m => [...m, { role: 'assistant', content: 'Left it alone.', responseSec: responseSec(t0) }]);
      }
      return;
    }
    setBusy(true);
    const t0 = performance.now();
    const r = await runJarvisActions(held.map(p => p.action), Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if (r.success) for (const t of r.createdTasks || []) syncTask(t);
    const sec = responseSec(t0);
    setMsgs(m => [...m, r.success
      ? { role: 'assistant', content: `Done — it's in ${[...new Set(held.map(h => h.group))].join(' and ')}.`, items: r.items, responseSec: sec }
      : { role: 'assistant', content: r.error || 'Could not do that.', responseSec: sec }]);
  };

  const toggleMute = () => {
    const next = !muted; setMuted(next); mutedRef.current = next;
    try { localStorage.setItem('jarvisMuted', next ? '1' : '0'); } catch {}
    if (next) stopSpeaking();
  };

  // A suspended account keeps a session object with no `user` on it, so `status` still reads
  // 'authenticated' — the assistant would float over the one screen meant to be a dead end. Every
  // action behind it refuses anyway; offering it is a button that can only fail.
  if (status !== 'authenticated' || ownsItsFrame(pathname)) return null;

  const statusLabel =
    busy ? 'Thinking…'
    : heldWrites.length > 0 && mode === 'capturing' ? (q ? 'Listening…' : 'Say yes or your change — or wait 5s')
    : heldWrites.length > 0 ? 'Confirming in 5s — interrupt to change'
    : mode === 'capturing' ? (q ? 'Listening… pause when you\'re done' : 'Listening… go ahead, or tap the mic to stop')
    : speaking ? 'Speaking… tap to interrupt'
    : voiceBlocked ? 'Tap the mic to enable voice'
    : 'Tap the mic to speak';

  return (
    <>
      <button ref={fabRef} className={`jarvis-fab ${open ? 'is-open' : ''} ${mode === 'capturing' ? 'listening' : ''}`} onClick={toggleOpen} title="Jarvis (Ctrl+J)" aria-label="Jarvis">
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {pending.length > 0 && (
        <div className="confirm-overlay" onClick={() => settlePending(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <div className="confirm-icon"><Users size={20} /></div>
            <h3>Everyone in {[...new Set(pending.map(p => p.group))].join(' and ')} will see this</h3>
            <p>
              {pending[0].people === 1
                ? 'Only you are in it right now — anyone you add later sees it too.'
                : `${pending[0].people} people are in this group.`}
              {' '}Jarvis will {pending.length === 1 ? 'make this change' : `make these ${pending.length} changes`} once you say so.
            </p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => settlePending(false)}>Cancel</button>
              <button className="confirm-ok" onClick={() => settlePending(true)} autoFocus>Go ahead</button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="jarvis-panel" ref={panelRef}>
          <div className="jarvis-head">
            <span className={`jarvis-dot ${mode === 'capturing' ? 'live' : ''}`} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div>
                <div style={{ fontWeight: 800 }}>Jarvis</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{statusLabel}</div>
              </div>
              <WisprWaveform active={mode === 'capturing'} />
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
                            {(it.detail || it.project) && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                {it.project && <span className="chip">{it.project}</span>}
                                {it.detail && <span style={{ minWidth: 0 }}>{it.detail}</span>}
                              </span>
                            )}
                          </span>
                          <ArrowUpRight size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                        </a>
                      );
                    })}
                  </div>
                )}
                {m.role === 'assistant' && m.responseSec != null && (
                  <span className="jarvis-timing" aria-label={`Responded in ${m.responseSec} seconds`}>
                    Responded in {m.responseSec} s
                  </span>
                )}
              </div>
            ))}
            {busy && (
              <div className="jarvis-msg assistant" aria-busy="true">
                <div className="jarvis-bubble" style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.85 }}>
                  <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, flexShrink: 0 }} />
                  <span>Looking in your vault…</span>
                </div>
              </div>
            )}
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
              <input ref={inputRef} value={q}
                onChange={e => {
                  setQ(e.target.value);
                  if (heldWritesRef.current.length && e.target.value.trim()) clearHeldAuto();
                }}
                onFocus={() => { if (heldWritesRef.current.length) clearHeldAuto(); }}
                placeholder={mode === 'capturing' ? 'Listening…' : 'Ask anything…'} />
              <button type="submit" disabled={!q.trim() || busy || mode === 'capturing'} aria-label="Send">
                {busy ? <div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : <Send size={16} />}
              </button>
            </form>
          </div>
          )}

          {/* Only near the end. Counting down from five on every turn makes the app feel metered;
              running out with no warning at all feels broken. */}
          {tab === 'chat' && left !== null && left <= 2 && (
            <p className="jarvis-left">
              {left === 0 ? 'That was today\u2019s last question.' : `${left} question${left === 1 ? '' : 's'} left today.`}
              {' '}The free AI allowance is shared by everyone; it resets tomorrow.
            </p>
          )}
        </div>
      )}
    </>
  );
}
