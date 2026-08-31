# The Android app — how it works, and what still needs your hands

## What was actually wrong

The download was never broken. The file served correctly the whole time: HTTP 200, right MIME type,
complete 8.9 MB, not behind the auth gate. What was broken is what happened *after* install.

The APK is a thin native shell — a WebView pointed at a URL baked in at build time. The URL baked
into the shipped build was a free pinggy tunnel, which expires about an hour after it is created.
It was committed on 23 Aug and the APK sat on the download page for eight days. So: download works,
install works, app opens, WebView loads a host that no longer exists, blank screen.

Three more problems came out of unzipping that same APK:

- **Real user recordings were inside it.** `webDir` pointed at `public/`, so `cap sync` copied the
  whole folder into the APK — including `public/uploads/mom/*.webm`. Anyone who downloaded the app
  could unzip it and read other people's meeting audio.
- **The APK contained a copy of itself** (4.8 MB of the 8.9 MB), same cause. Each rebuild would
  have embedded the previous one, so the next would have been ~14 MB.
- **Downloads and links did nothing inside the app.** A stock Android WebView silently discards
  every download and every `target="_blank"`. Digi Locker file links, note attachments, and opening
  a saved link from search were all no-ops — nothing happened, no error.

All four are fixed. The APK is now 4.7 MB, points at `allyouneedvault.vercel.app`, contains no user
data, and downloads work.

---

## What you need to do — Google Cloud Console

Google refuses OAuth inside embedded WebViews, so sign-in and Drive now run in a Chrome Custom Tab.
That works, but Google only accepts redirect URIs you have registered. **Until you do this, Google
sign-in and Drive connect will fail with `redirect_uri_mismatch` on the app and the website alike.**

1. Open **https://console.cloud.google.com** and sign in with the account that owns the app.
2. Top-left, click the **project dropdown** (next to "Google Cloud") and pick the project holding
   the ALL you need OAuth client.
3. In the left sidebar click **APIs & Services**, then **Credentials**.
4. Under **OAuth 2.0 Client IDs**, click the name of the **Web application** client. (If there is
   more than one, it is the one whose Client ID matches `GOOGLE_CLIENT_ID` in your env.)
5. Scroll to **Authorised redirect URIs**. Click **+ ADD URI** and add each of these exactly —
   no trailing slash:

   ```
   https://allyouneedvault.vercel.app/api/auth/callback/google
   https://allyouneedvault.vercel.app/api/drive/callback
   http://localhost:3000/api/auth/callback/google
   http://localhost:3000/api/drive/callback
   ```

   The two localhost ones are so development keeps working; Google allows http only for localhost.
6. Click **SAVE** at the bottom.
7. Changes can take a few minutes to apply. If sign-in still fails right after saving, wait five
   minutes before concluding anything.

Nothing needs to be added for the app specifically. It uses the same web client — the Custom Tab is
a real Chrome, so from Google's side it is an ordinary web sign-in.

## What you need to check — Vercel

`DECISION.md` records `NEXTAUTH_URL` pointing at a deployment that no longer exists. Everything
above is downstream of it.

1. Open **https://vercel.com** and go to the **allyouneedvault** project.
2. **Settings** → **Environment Variables**.
3. Find **`NEXTAUTH_URL`**. It must be exactly:

   ```
   https://allyouneedvault.vercel.app
   ```

   One URL, no trailing slash, no second value after a `|`. If it says `save-my-link-akg.vercel.app`
   or anything else, click the three dots → **Edit**, fix it, **Save**.
4. Check **`NEXT_PUBLIC_APP_URL`** has the same value.
5. Redeploy for the change to take effect: **Deployments** → newest one → three dots → **Redeploy**.

---

## Rebuilding the APK

The toolchain is installed on this machine now (JDK 21, Android SDK, platform-tools, build-tools 36).

```bash
npx cap sync android && cd android && ./gradlew assembleDebug
```

Output lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it over
`public/app-debug.apk` to publish it.

**Bump `versionCode` in `android/app/build.gradle` every time.** Android refuses to install a build
whose versionCode is not higher than the installed one, and the refusal reads "App not installed",
which looks exactly like a corrupt download.

To test against a tunnel instead of production, pass the URL in the environment rather than editing
the file — that is how the dead tunnel got committed in the first place:

```bash
CAP_SERVER_URL=https://your-tunnel.example npx cap sync android
```

`capacitor.config.ts` now throws at `cap sync` if a tunnel host is ever hardcoded as the production
URL, and if the URL is not https (the microphone needs a secure context).

### Signing

`android/keystore/debug.keystore` is committed on purpose, so every machine and CI produce an APK
that installs over the last one. Previously each machine used its own generated debug key, which is
why a rebuild elsewhere could not update an existing install.

This key is not a secret and is not meant to be — it is the same posture as the debug keystore the
Android SDK ships with, and it is fine for a sideloaded APK. **It must never become the Play Store
release key.** That one gets generated with the Play org account, never enters git, and cannot be
recovered if it leaks.

---

## Test on your phone

These are the things no amount of desktop testing can prove. Everything else has been verified.

1. **If you still have a build from before 31 Aug, uninstall it first.** Those were signed with a
   per-machine key, so Android refuses to install over them and says "App not installed". Nothing is
   lost — your account lives on the server. Builds from here on share one key and update in place.
2. Install the new APK from the download page.
3. Open it. **It should show the app, not a blank screen.** This is the main fix.
4. Sign in with **email and password** first. Confirm the vault loads.
5. Sign out, then sign in with **Google**. A Chrome tab should open, you complete sign-in there, and
   the app should come back signed in on its own. *(Needs the console step above.)*
6. Go to **MOM → record**. Android should ask for microphone permission. Record ten seconds and stop.
7. Go to **Digi Locker** and tap a file. It should download, with a notification. This did nothing
   before.
8. Go to **Profile → connect Google Drive**. A Chrome tab opens, you approve, and the app comes back
   with Drive connected. *(Needs the console step above.)*
9. Create a **task with a due time** a few minutes out. Allow notifications, and allow "Alarms &
   reminders" when it asks. Confirm the reminder arrives.
10. From any other app, **share a link** to ALL you need and confirm it lands in the vault.

If any step fails, the useful detail is which step and what appeared on screen.

---

## Known, not fixed

- **Exact alarms still need granting once.** The prompt now reappears weekly until it is granted
  rather than firing once ever, but Android 14+ will not grant exact alarms on its own — until you
  allow it, reminders arrive late rather than on time.
- **`GEMINI_API_KEY` is unset** in every env file, so Hinglish transcription silently falls back to
  Groq Whisper, which the code itself notes mis-detects Hindi as Urdu. `SARVAM_API_KEY` is unset too,
  so the paid path is unreachable.
- **Deep links use a custom scheme** (`com.swaraj.savemylink://`), which any app may also claim. The
  handoff is built so an interceptor gains nothing — it would hold a one-time code but not the
  verifier needed to spend it — but Android App Links on the real domain would remove the
  interception entirely. That needs `.well-known/assetlinks.json` carrying this signing key's
  fingerprint: `E8:06:04:C5:CD:22:8C:C1:76:83:12:38:17:12:D8:56:41:C4:2F:4F:88:67:EA:1A:1F:34:CF:67:B0:AB:B6:3E`
- **`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`** are still dependencies with zero uses
  anywhere in `src/`. Drive replaced them. Worth removing.
