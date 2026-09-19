/**

 * The one place the chat provider is configured. Jarvis and MOM extraction both route through

 * here, so switching provider or model is a single edit rather than two files drifting apart.

 *

 * Audio does NOT belong here — see `lib/geminiAudio`. Groq below is a silent fallback when Gemini

 * fails; callers should never surface provider names to the user.

 */



import fs from 'fs';

import path from 'path';



const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';



const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const FALLBACKS = ['gemini-3.5-flash', 'gemini-3.7-flash'];



const GEMINI_WALL_MS = 7_000;

const GEMINI_FETCH_MS = 18_000;

const GROQ_FETCH_MS = 22_000;



// Groq retired llama-3.1-8b-instant and llama-3.3-70b-versatile on 2026-08-16.

const GROQ_CHAT_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];



export function getEnvKey(name: string): string | undefined {

  if (process.env[name]) return process.env[name];

  try {

    const cwd = process.cwd();

    for (const file of ['.env.local', '.env']) {

      const p = path.join(cwd, file);

      if (fs.existsSync(p)) {

        const content = fs.readFileSync(p, 'utf8');

        const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));

        if (match && match[1]) {

          const val = match[1].trim().replace(/^["']|["']$/g, '');

          if (val) {

            process.env[name] = val;

            return val;

          }

        }

      }

    }

  } catch {}

  return undefined;

}



function errorReason(body: string): string | null {

  try {

    const parsed = JSON.parse(body);

    return (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message || null;

  } catch {

    return null;

  }

}



export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatResult = { ok: true; data: any } | { ok: false; error: string; code?: 'rate_limited' };



export function parseLooseJSON(raw: string): any {

  const text = (raw || '').trim();

  try { return JSON.parse(text); } catch {}

  const start = text.indexOf('{');

  const end = text.lastIndexOf('}');

  if (start >= 0 && end > start) {

    try { return JSON.parse(text.slice(start, end + 1)); } catch {}

  }

  return null;

}



async function chatViaGroq(groqKey: string, messages: ChatMsg[]): Promise<ChatResult> {

  let lastGroqError = 'Assistant unavailable';



  for (const model of GROQ_CHAT_MODELS) {

    for (const useFormat of [true, false]) {

      try {

        const bodyPayload: Record<string, unknown> = { model, messages };

        if (useFormat) bodyPayload.response_format = { type: 'json_object' };



        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {

          method: 'POST',

          headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },

          body: JSON.stringify(bodyPayload),

          signal: AbortSignal.timeout(GROQ_FETCH_MS),

        });

        if (!res.ok) {

          const errText = await res.text().catch(() => '');

          console.error(`Groq LLM error (${model}):`, res.status, errText.slice(0, 200));

          try { lastGroqError = JSON.parse(errText)?.error?.message || lastGroqError; } catch {}

          if (res.status === 400 && useFormat) continue;

          break;

        }

        const data = parseLooseJSON((await res.json()).choices?.[0]?.message?.content || '');

        if (!data) continue;

        return { ok: true, data };

      } catch (err) {

        console.error(`Groq LLM call failed (${model}):`, err);

      }

    }

  }

  return { ok: false, error: lastGroqError };

}



/** One JSON chat completion. Never throws — callers get a message they can show the user. */

export async function chatJSON(messages: ChatMsg[]): Promise<ChatResult> {

  const geminiKey = getEnvKey('GEMINI_API_KEY');

  const groqKey = getEnvKey('GROQ_API_KEY');



  if (!geminiKey && !groqKey) {

    return { ok: false, error: 'GEMINI_API_KEY or GROQ_API_KEY not configured' };

  }

  if (!geminiKey && groqKey) return chatViaGroq(groqKey, messages);



  const call = (model: string) => fetch(`${BASE}/chat/completions`, {

    method: 'POST',

    headers: { Authorization: `Bearer ${geminiKey}`, 'Content-Type': 'application/json' },

    body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages }),

    signal: AbortSignal.timeout(GEMINI_FETCH_MS),

  });



  const models = [MODEL, ...FALLBACKS.filter(m => m !== MODEL)];

  let lastError = 'Assistant unavailable';

  let lastCode: 'rate_limited' | undefined;

  const t0 = Date.now();

  let saw503 = false;



  for (const model of models) {

    if (Date.now() - t0 > GEMINI_WALL_MS) break;



    let res: Response;

    try {

      res = await call(model);

    } catch (error) {

      console.error('LLM call failed:', model, error);

      lastError = error instanceof Error && error.name === 'TimeoutError'

        ? 'Assistant took too long to respond'

        : 'Could not reach the assistant';

      continue;

    }



    if (res.status === 503) {

      saw503 = true;

      lastError = 'Assistant is busy right now. Try again in a moment.';

      console.warn(`LLM busy: ${model}`);

      continue;

    }



    if (res.status === 429) {

      const body = await res.text();

      const reason = errorReason(body);

      lastError = reason ? `Rate limited — ${reason}` : 'Rate limited. Give it a minute.';

      lastCode = 'rate_limited';

      continue;

    }



    if (!res.ok) {

      const body = await res.text();

      console.error('LLM error:', res.status, model, body.slice(0, 400));

      const reason = errorReason(body);

      if (res.status === 401 || res.status === 403) {

        lastError = reason || 'API key invalid. Use a key from aistudio.google.com/apikey';

        break;

      }

      if (res.status === 400 || res.status === 404) {

        lastError = reason || `Model "${model}" is not available`;

        continue;

      }

      lastError = `Assistant unavailable (${res.status})`;

      break;

    }



    const data = parseLooseJSON((await res.json()).choices?.[0]?.message?.content || '');

    if (!data) return { ok: false, error: 'Assistant returned something unreadable' };

    return { ok: true, data };

  }



  if (groqKey && (saw503 || Date.now() - t0 > GEMINI_WALL_MS - 500)) {

    const groq = await chatViaGroq(groqKey, messages);

    if (groq.ok) return groq;

    return { ok: false, error: groq.error || lastError, code: lastCode };

  }



  return { ok: false, error: lastError, code: lastCode };

}

