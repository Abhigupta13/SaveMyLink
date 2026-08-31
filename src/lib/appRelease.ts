/**
 * What the latest APK is, and whether the copy on this phone is behind it.
 *
 * WHY THIS EXISTS AT ALL. The app is a remote-URL Capacitor shell (see capacitor.config.ts): the
 * APK bundles no web assets, so every UI, server-action and styling change reaches every install
 * the moment Vercel finishes deploying. Nobody reinstalls for those, which is most changes.
 *
 * The native shell is the exception. MainActivity, the manifest, permissions, plugins, the app
 * name, the Capacitor config — none of that is web, none of it ships over the air, and until now
 * nothing told anyone a new APK existed. A person could sit on a build whose download handler was
 * broken, or that predates Google sign-in, indefinitely, because the web half kept updating around
 * them and the app never looked out of date.
 *
 * WHY THE VERSION IS DECLARED HERE rather than read from build.gradle. The notes have to live
 * somewhere a human writes them, and a release is one fact — version plus what changed — so
 * splitting it across two files invites the half that nobody remembered to update. Drift is caught
 * instead: tests/unit/appRelease.test.ts asserts LATEST.versionCode and versionName match
 * android/app/build.gradle exactly, so a bumped build with unbumped notes fails the suite rather
 * than shipping a prompt that lies about what is in it.
 *
 * Pure and dependency-free on purpose — no Capacitor import, no DOM — so the comparison can be
 * proven without a device.
 */

export interface Release {
  /** Android's own ordering. Must match versionCode in android/app/build.gradle. */
  versionCode: number;
  /** What a person sees. Must match versionName in android/app/build.gradle. */
  versionName: string;
  /** What changed, in the user's language. Shown verbatim in the update prompt. */
  notes: string[];
}

/**
 * The build currently published at /download.
 *
 * WHEN YOU SHIP A NEW APK: bump versionCode and versionName in android/app/build.gradle, then
 * mirror both here and replace the notes. The test suite fails until all three agree.
 *
 * Notes are what the PERSON gets out of it, not what changed in the code. "Sign in with Google
 * without leaving the app" — not "added Custom Tabs handoff for OAuth". Somebody deciding whether
 * an update is worth their data allowance is the audience.
 */
export const LATEST: Release = {
  versionCode: 4,
  versionName: '1.3',
  notes: [
    'Sign in with Google without leaving the app.',
    'Downloads and shared links open properly instead of doing nothing.',
    'Reminders ask for permission again if you said no the first time.',
    'Installing over an older copy no longer fails.',
  ],
};

/**
 * Is the installed build behind the published one?
 *
 * Compares versionCode, never versionName: the code is the integer Android itself orders installs
 * by, while the name is a marketing string where "1.10" sorts before "1.9" under every naive
 * comparison anyone reaches for.
 *
 * Everything unparseable answers false. This drives a prompt asking somebody to re-download an
 * APK and walk past Android's harm warning, so the failure that matters is nagging a person who
 * is already up to date — not staying quiet for one who isn't. Quiet is recoverable; crying wolf
 * on a security prompt is how people learn to ignore it.
 */
export function updateAvailable(installed: unknown, latest: Release = LATEST): boolean {
  const code = Number(installed);
  if (!Number.isFinite(code) || code <= 0) return false;
  return Math.floor(code) < latest.versionCode;
}

/**
 * Capacitor's App.getInfo() reports `build` as a string on Android and, historically, as other
 * shapes elsewhere. Narrowed here so the caller does not have to care, and so a plugin that starts
 * answering something unexpected degrades to "no update" rather than to a permanent banner.
 */
export const installedCode = (info: { build?: unknown } | null | undefined): number | null => {
  const code = Number(info?.build);
  return Number.isFinite(code) && code > 0 ? Math.floor(code) : null;
};

/** The key under which a dismissal is remembered, scoped to the version it dismissed. */
export const dismissKey = (versionCode: number) => `updateDismissed:${versionCode}`;
