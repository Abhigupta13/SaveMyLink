import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Remote-URL mode: the APK is a thin native shell and nothing web is bundled, so this URL *is* the
 * app. Get it wrong and every install opens a blank screen.
 *
 * That is not hypothetical. Commit ba37a7c baked a free pinggy tunnel in here, tunnels of that kind
 * expire after an hour, and the APK built from it sat on the download page for eight days telling
 * everyone who installed it that the app was broken. The download itself was always fine.
 *
 * Mirrors CANONICAL_APP_URL in src/lib/url.ts. Deliberately not imported from there: the Capacitor
 * CLI loads this file outside the Next build, where the `@/` path alias does not resolve.
 */
const PRODUCTION_URL = 'https://allyouneedvault.vercel.app';

/**
 * Point at a tunnel for a device test with `CAP_SERVER_URL=https://… npx cap sync android`, so the
 * throwaway address lives in a shell for ten minutes instead of in git forever.
 */
const SERVER_URL = process.env.CAP_SERVER_URL?.trim() || PRODUCTION_URL;

/** The hosts that expire while you are still looking at them. */
const EPHEMERAL = /\b(pinggy|ngrok|trycloudflare|loca\.lt|localtunnel|serveo)\b/i;

// A guard rather than a comment, because the comment was already there and did not stop it. This
// fires at `cap sync`, when the mistake is one edit away — not at install time on someone's phone.
if (EPHEMERAL.test(PRODUCTION_URL)) {
  throw new Error(
    'capacitor.config.ts: PRODUCTION_URL is a temporary tunnel. It gets baked into the APK and ' +
    'dies within the hour. Restore the real domain and use CAP_SERVER_URL for tunnel testing.',
  );
}

// getUserMedia, MediaRecorder and speechSynthesis all need a secure context. Over plain http the
// mic fails with an error the recording UI reports as "Microphone unavailable", which sends you
// looking at Android permissions for something that is really this line.
if (!SERVER_URL.startsWith('https://')) {
  throw new Error(`capacitor.config.ts: server URL must be https, got "${SERVER_URL}" — the mic dies without a secure context.`);
}

const config: CapacitorConfig = {
  appId: 'com.swaraj.savemylink',
  appName: 'SaveMyLink',
  // Unused in remote mode, but `cap sync` copies this directory into the APK, so it must not be
  // `public`. It was, and the shipped APK carried real user MOM recordings out of public/uploads
  // plus a 4.8 MB copy of the previous APK — half the download, and a privacy leak in a file
  // anyone could unzip. An empty directory is the whole fix.
  webDir: 'capacitor-web',
  server: {
    url: SERVER_URL,
  },
};

export default config;
