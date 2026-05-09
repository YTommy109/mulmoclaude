// One-time marked configuration for the SPA. Call `setupMarked()`
// from `src/main.ts` before the Vue app mounts so every component
// that imports `{ marked }` afterwards inherits the configured
// global instance.
//
// Today this just installs the wiki-embed extension + the
// built-in `amazon` / `isbn` handlers (#1221 PR-B). Future global
// marked extensions belong here too — keep all the side-effects
// in one greppable spot.

import { marked } from "marked";
import { wikiEmbedExtension } from "./wikiEmbeds";
import { registerBuiltInWikiEmbeds } from "./wikiEmbedHandlers";

let installed = false;

export function setupMarked(): void {
  // Idempotent: tests reach for `setupMarked()` before each
  // assertion suite without paying for re-installation.
  if (installed) return;
  registerBuiltInWikiEmbeds();
  marked.use(wikiEmbedExtension);
  installed = true;
}
