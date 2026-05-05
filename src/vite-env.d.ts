/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCALE?: "en" | "ja";
  // Set `VITE_DEV_MODE=1` in `.env` to surface `isDebugRole` roles
  // in the dropdown. Anything else (including unset) hides them.
  readonly VITE_DEV_MODE?: "1" | "0";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
