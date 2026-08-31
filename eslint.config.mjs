import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Anywhere NEXT_DIST_DIR sends a build. Without this, linting a checkout that has one
    // reports fifteen thousand problems in generated code.
    ".next-*/**",
    "out/**",
    // Anchored at the repo root, so this does NOT cover android/app/build — see below.
    "build/**",
    // Gradle's output. It only appears on a machine that has actually built the APK, which is why
    // it went unnoticed: `native-bridge.js` is 53KB of generated Capacitor code and contributed 16
    // warnings out of nowhere the first time anyone ran a build locally. Against a lint budget that
    // ratchets on total count, that reads as a regression somebody has to go and disprove.
    "android/**/build/**",
    // Written by `npx cap sync` — the web assets copied into the APK, plus the cordova shims.
    // Generated, never hand-edited, and replaced wholesale on every sync.
    "android/app/src/main/assets/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
