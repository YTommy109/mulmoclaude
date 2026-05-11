/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCALE?: "en" | "ja";
  // Set `VITE_DEV_MODE=1` in `.env` to surface `isDebugRole` roles
  // in the dropdown. Anything else (including unset, "0", "true",
  // "yes") hides them — the consumer side does an exact `=== "1"`
  // check so the type stays open to whatever string Vite hands
  // through, instead of pretending only `"1" | "0"` are reachable.
  readonly VITE_DEV_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
