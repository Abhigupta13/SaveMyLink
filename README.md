This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

# SaveMyLink — Android app (Capacitor)

The APK is a thin native shell (share-sheet receiver, local notifications, native share) whose webview loads the deployed Next.js app. Server code changes ship by redeploying the server; rebuild the APK only when `android/` or Capacitor plugins change.

## Environment (.env.local / VPS env)

```
MONGODB_URI=...          # MongoDB connection string
NEXTAUTH_SECRET=...      # also signs the private-safe cookie
NEXTAUTH_URL=https://<your-domain>
GEMINI_API_KEY=...       # Jarvis + MOM task extraction (aistudio.google.com/apikey)
GEMINI_MODEL=...         # optional, defaults to gemini-flash-latest (alias — survives renames)
GROQ_API_KEY=...         # voice + MOM transcription only (whisper-large-v3)

# Password-reset email (optional — without it the reset link is shown on screen)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=...            # Gmail App Password (16 chars), NOT your Google password
SMTP_FROM=ALL YOU NEED <you@gmail.com>
```

Gmail App Password: enable 2-Step Verification, then myaccount.google.com → Security →
App passwords → create one for "Mail". Any SMTP provider works (Brevo, Resend, SES) —
just change the host/port/credentials.

## Deploy (VPS)

TLS is mandatory (NextAuth cookies + microphone need a secure context).

```
npm install && npm run build && npm start   # behind nginx/caddy with https
```

Weekly dead-link check (cron): `0 3 * * 0 cd /path/to/app && node scripts/check-dead-links.js`

## Build the APK (needs Android SDK / Android Studio)

1. Set `SERVER_URL` in `capacitor.config.ts` to your https domain (a pinggy/ngrok https tunnel works for testing).
2. `npx cap sync android`
3. `cd android && ./gradlew assembleDebug`
4. Sideload `android/app/build/outputs/apk/debug/app-debug.apk`.

On first run: allow notifications, and enable "Alarms & reminders" when prompted (exact task reminders on Android 14+).

## Self-check

`node --experimental-strip-types scripts/self-check.mjs`
