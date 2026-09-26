import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Production APKs load a small local page from `capacitor-web/` first. When the network is up it
 * forwards to the live site; when it is down the user sees a branded offline screen instead of
 * Android’s generic “Web page not available”.
 *
 * Tunnel dev still uses `CAP_SERVER_URL` to point the WebView straight at a temporary host.
 *
 * Mirrors CANONICAL_APP_URL in src/lib/url.ts. Deliberately not imported from there: the Capacitor
 * CLI loads this file outside the Next build, where the `@/` path alias does not resolve.
 */
const PRODUCTION_URL = 'https://allyouneedvault.vercel.app';

/**
 * Point at a tunnel for a device test with `CAP_SERVER_URL=https://… npx cap sync android`, so the
 * throwaway address lives in a shell for ten minutes instead of in git forever.
 */
const TUNNEL_URL = process.env.CAP_SERVER_URL?.trim() || '';

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

if (TUNNEL_URL && !TUNNEL_URL.startsWith('https://')) {
  throw new Error(`capacitor.config.ts: CAP_SERVER_URL must be https, got "${TUNNEL_URL}" — the mic dies without a secure context.`);
}

const config: CapacitorConfig = {
  // appId is the package identity Android installs under, and it is NOT the display name. Changing
  // it would make this a different app: every existing install would be orphaned rather than
  // updated, and the com.swaraj.savemylink:// deep link that carries a finished Google sign-in
  // back into the WebView would stop resolving. It stays as it is; only the label changes.
  appId: 'com.swaraj.savemylink',
  appName: 'ALL you need',
  // Unused in remote mode, but `cap sync` copies this directory into the APK, so it must not be
  // `public`. It was, and the shipped APK carried real user MOM recordings out of public/uploads
  // plus a 4.8 MB copy of the previous APK — half the download, and a privacy leak in a file
  // anyone could unzip. An empty directory is the whole fix.
  webDir: 'capacitor-web',
  ...(TUNNEL_URL ? { server: { url: TUNNEL_URL } } : {}),
};

export default config;
