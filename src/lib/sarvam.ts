/**
 * Sarvam AI speech-to-text — used only by MOM, and only for accounts that have a key.
 *
 * Whisper is the wrong engine for Hindi/Hinglish and no prompt tuning fixes it: it cannot
 * emit romanized Hinglish at all, it mis-detects spoken Hindi as Urdu (Perso-Arabic script),
 * and its `prompt` field is prior-context conditioning rather than an instruction — it also
 * only conditions the first 30 seconds, so on a 40-minute meeting it does nothing. Saaras is
 * trained on Indian audio, handles code-switching, and translates to English directly.
 *
 * Plain fetch against the documented REST endpoints: the SDK would be a dependency for four
 * HTTP calls. Never throws — callers get a message they can put in front of a user.
 */

const BASE = 'https://api.sarvam.ai';

// Meetings must use the batch API: the synchronous endpoint accepts only 30 seconds of audio.
const JOB = '/speech-to-text/job/v1';

// Documented only by implication (the status path is `${JOB}/{id}/status`). Isolated here so a
// smoke test against a real key is a one-line correction rather than a hunt.
const startPath = (jobId: string) => `${JOB}/${jobId}/start`;

export type SarvamResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * The pre-r4 bootstrap: a comma-separated env list of addresses that may spend the founder's
 * key. `lib/sarvamAccess` is what consults it — it lives here because it is pure, and the
 * self-check runs on plain node with no module aliasing.
 */
export const envAllowlisted = (email?: string | null) =>
  !!email && (process.env.SARVAM_ENABLED_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(email.toLowerCase());

/**
 * WHOSE key. Required, never defaulted to the environment: Sarvam bills per minute, and a
 * caller that forgets to pass one would quietly bill the founder for somebody else's meeting.
 * `lib/sarvamAccess` is the single place that decides which key an account gets.
 */
async function call<T>(apiKey: string, path: string, init?: RequestInit): Promise<SarvamResult<T>> {
  if (!apiKey) return { ok: false, error: 'No Sarvam API key for this account' };
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'api-subscription-key': apiKey,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      // Body carries the real reason; the caller only ever sees the status.
      console.error('Sarvam error:', path, res.status, await res.text().catch(() => ''));
      return { ok: false, error: `Transcription service error (${res.status})` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    console.error('Sarvam call failed:', path, error);
    return { ok: false, error: 'Could not reach the transcription service' };
  }
}

const postJSON = <T>(apiKey: string, path: string, body: unknown) =>
  call<T>(apiKey, path, { method: 'POST', body: JSON.stringify(body) });

/**
 * Both upload_urls and download_urls are keyed by file name and wrap the link as
 * `{ file_url, file_metadata }`. A bare string is accepted too so a future shape change
 * degrades to a clear error rather than a crash.
 */
function pickUrl(map: any): string | null {
  const entry = Object.values(map || {})[0] as any;
  if (!entry) return null;
  return typeof entry === 'string' ? entry : (entry.file_url || entry.url || null);
}

/**
 * mode 'translate' emits English directly from Hindi/Hinglish speech — the meeting is stored
 * already translated. language_code 'unknown' auto-detects, so a meeting that switches
 * language mid-sentence is handled without anyone choosing a language up front.
 */
export async function createTranscriptionJob(apiKey: string): Promise<SarvamResult<{ jobId: string }>> {
  const res = await postJSON<any>(apiKey, JOB, {
    model: 'saaras:v3',
    mode: 'translate',
    language_code: 'unknown',
    job_parameters: { model: 'saaras:v3', mode: 'translate', language_code: 'unknown' },
  });
  if (!res.ok) return res;
  const jobId = res.data?.job_id;
  if (!jobId) return { ok: false, error: 'Transcription service returned no job id' };
  return { ok: true, data: { jobId } };
}

/** A presigned URL the browser PUTs the audio to, so it never passes through our function. */
export async function getUploadUrl(apiKey: string, jobId: string, fileName: string): Promise<SarvamResult<{ uploadUrl: string }>> {
  const res = await postJSON<any>(apiKey, `${JOB}/upload-files`, { job_id: jobId, files: [fileName] });
  if (!res.ok) return res;
  const uploadUrl = pickUrl(res.data?.upload_urls);
  if (!uploadUrl) {
    // A 2xx with an unfamiliar shape logs nothing in `call`, which makes this the one place
    // a mismatch would otherwise be invisible.
    console.error('Sarvam upload-files: unexpected shape', JSON.stringify(res.data));
    return { ok: false, error: 'Transcription service returned no upload URL' };
  }
  return { ok: true, data: { uploadUrl } };
}

/**
 * Must run server-side. The presigned URL points at Azure blob storage, which does not allow
 * cross-origin browser requests — a PUT from the page fails CORS while this one succeeds.
 * x-ms-blob-type is Azure's required marker for a single-shot block blob upload.
 *
 * Content-Type is NOT optional. Without it Azure stores the blob as octet-stream and Sarvam
 * falls back to reading the bytes as raw WAV — a webm/opus recording then transcribes to an
 * empty string with a nonsense detected language, and the job still reports Success. Verified:
 * the identical file returns a transcript with the header and nothing without it.
 */
export async function uploadAudio(uploadUrl: string, audio: Blob): Promise<SarvamResult<true>> {
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: audio,
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': audio.type || 'audio/webm',
      },
    });
    if (!res.ok) {
      console.error('Sarvam upload failed:', res.status, await res.text().catch(() => ''));
      return { ok: false, error: `Could not upload the recording (${res.status})` };
    }
    return { ok: true, data: true };
  } catch (error) {
    console.error('Sarvam upload threw:', error);
    return { ok: false, error: 'Could not upload the recording' };
  }
}

export const startTranscriptionJob = (apiKey: string, jobId: string) => postJSON<any>(apiKey, startPath(jobId), {});

export type JobState = 'Accepted' | 'Pending' | 'Running' | 'Completed' | 'Failed';

const status = (apiKey: string, jobId: string) => call<any>(apiKey, `${JOB}/${jobId}/status`);

export async function jobStatus(apiKey: string, jobId: string): Promise<SarvamResult<{ state: JobState }>> {
  const res = await status(apiKey, jobId);
  if (!res.ok) return res;
  return { ok: true, data: { state: (res.data?.job_state || 'Pending') as JobState } };
}

/**
 * Three hops. The output file is NOT named after the audio — Sarvam names it by index
 * ("0.json"), and download-files rejects any other name, so the real name has to come from
 * the job status first. Then swap that for a presigned URL and read the JSON behind it.
 */
export async function jobTranscript(apiKey: string, jobId: string): Promise<SarvamResult<{ transcript: string }>> {
  const info = await status(apiKey, jobId);
  if (!info.ok) return info;

  const outputs: string[] = (info.data?.job_details || [])
    .flatMap((d: any) => d?.outputs || [])
    .map((o: any) => o?.file_name)
    .filter(Boolean);
  if (!outputs.length) {
    console.error('Sarvam status: no output files', JSON.stringify(info.data));
    return { ok: false, error: 'Transcription finished but produced no result file' };
  }

  const res = await postJSON<any>(apiKey, `${JOB}/download-files`, { job_id: jobId, files: outputs });
  if (!res.ok) return res;

  const url = pickUrl(res.data?.download_urls);
  if (!url) {
    console.error('Sarvam download-files: unexpected shape', JSON.stringify(res.data));
    return { ok: false, error: 'Transcription finished but returned no result file' };
  }

  try {
    const file = await fetch(url);
    if (!file.ok) return { ok: false, error: `Could not read the transcript (${file.status})` };
    const body = await file.json();
    // Shape is { transcript, timestamps, diarized_transcript } — take the plain transcript.
    const transcript = String(body?.transcript || '').trim();
    if (!transcript) return { ok: false, error: 'The recording produced an empty transcript' };
    return { ok: true, data: { transcript } };
  } catch (error) {
    console.error('Sarvam result download failed:', error);
    return { ok: false, error: 'Could not read the transcript' };
  }
}
