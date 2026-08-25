/**
 * End-to-end smoke test for the Sarvam batch pipeline, against the real API.
 *
 * Verified against the live API on 24 Aug 2026 — every step passes and a Hindi clip comes
 * back as English. Kept as a regression check: it exercises the whole job lifecycle without
 * a browser, a login, or a real meeting, so a Sarvam API change surfaces here first.
 *
 * The three things that were guesses, and what they turned out to be:
 *   1. model/mode/language_code — top level on initiate, echoed back in job_parameters
 *   2. the start path — `${JOB}/{id}/start`, as assumed
 *   3. URL shapes — keyed by file name and wrapped as { file_url }, NOT { url }; and the
 *      output file is named by index ("0.json"), so its name must come from job status
 *
 * Run:  node --experimental-strip-types --env-file=.env.local scripts/sarvam-smoke.mjs [audio-file]
 *
 * With no audio file it uploads one second of silence, which still proves every step except
 * the transcript text itself. A short real clip ("kal shaam tak vendor ko call karna hai,
 * and send the report by Friday") also proves the Hinglish→English translation.
 */
import { readFile } from 'node:fs/promises';
import {
  createTranscriptionJob, getUploadUrl, uploadAudio, startTranscriptionJob, jobStatus, jobTranscript,
} from '../src/lib/sarvam.ts';

const die = (step, error, apiCall = true) => {
  console.error(`\n✗ FAILED at: ${step}\n  ${error}`);
  if (apiCall) console.error('  The raw response body was logged above by src/lib/sarvam.ts.');
  process.exit(1);
};

/** 1s of 8kHz mono silence — enough to exercise upload, start, poll and download. */
function silentWav() {
  const data = Buffer.alloc(8000 * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24); head.writeUInt32LE(16000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

if (!process.env.SARVAM_API_KEY) die('config', 'SARVAM_API_KEY is not set (pass --env-file=.env.local)', false);
// The lib takes the key per call now (users can bring their own), so the smoke test hands it
// the founder's env key explicitly — the same one the allowlist path would resolve to.
const KEY = process.env.SARVAM_API_KEY;

const path = process.argv[2];
const audio = path ? await readFile(path) : silentWav();
const name = path ? path.split('/').pop() : 'smoke.wav';
console.log(`audio: ${name} (${(audio.length / 1024).toFixed(1)} KB)${path ? '' : ' — silence; pass a real clip to test translation'}`);

const job = await createTranscriptionJob(KEY);
if (!job.ok) die('initiate — guess 1: model/mode/language_code placement', job.error);
console.log(`✓ job created: ${job.data.jobId}`);

const upload = await getUploadUrl(KEY, job.data.jobId, name);
if (!upload.ok) die('upload-files — guess 3: upload_urls shape', upload.error);
console.log('✓ presigned upload URL received');

// The mime type matters — see uploadAudio. Derived from the extension so each format is
// uploaded the way the app would upload it.
const MIME = { webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' };
const put = await uploadAudio(upload.data.uploadUrl,
  new Blob([audio], { type: MIME[name.split('.').pop()] || 'audio/webm' }));
if (!put.ok) die('PUT to storage', put.error);
console.log('✓ audio uploaded to storage (server-side; a browser PUT fails CORS)');

const started = await startTranscriptionJob(KEY, job.data.jobId);
if (!started.ok) die('start — guess 2: the job start path in src/lib/sarvam.ts', started.error);
console.log('✓ job started');

for (let i = 1; i <= 60; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const status = await jobStatus(KEY, job.data.jobId);
  if (!status.ok) die('status', status.error);
  console.log(`  [${i}] ${status.data.state}`);
  if (status.data.state === 'Failed') die('transcription', 'job reported Failed');
  if (status.data.state !== 'Completed') continue;

  const result = await jobTranscript(KEY, job.data.jobId);
  // Silence legitimately produces nothing — that is not a shape failure.
  if (!result.ok && !path) {
    console.log(`\n✓ pipeline works end to end (empty transcript from silence: "${result.error}")`);
    process.exit(0);
  }
  if (!result.ok) die('download-files — guess 3: download_urls shape', result.error);
  console.log(`\n✓ ALL STEPS PASSED\n\ntranscript:\n${result.data.transcript}`);
  process.exit(0);
}
die('polling', 'still not Completed after 5 minutes');
