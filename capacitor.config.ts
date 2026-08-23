import type { CapacitorConfig } from '@capacitor/cli';

// Remote-URL mode: the APK is a thin native shell; the webview loads the deployed
// Next.js app. Point SERVER_URL at the VPS domain (or an https tunnel while testing).
const SERVER_URL = 'https://euvya-2409-40f2-4f-cf41-57c1-4c18-7f54-183d.free.pinggy.net'; // pinggy tunnel (testing)

const config: CapacitorConfig = {
  appId: 'com.swaraj.savemylink',
  appName: 'SaveMyLink',
  webDir: 'public', // unused in remote mode, must exist
  server: {
    url: SERVER_URL,
  },
};

export default config;
