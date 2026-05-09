// Built-in prefix handlers for the wiki-embed registry (#1221 PR-B).
//
// Two prefixes ship today — `amazon` and `isbn` — chosen because
// they tie directly to the `mc-library` preset skill (#1210),
// which already captures ASIN / ISBN as it summarises books and
// products. After this PR, the skill can write
// `[[amazon:B00ICN066A]]` instead of a raw URL and get a clickable
// link in the rendered wiki / chat.
//
// Future prefixes (youtube / x / map / github / …) plug into the
// same registry — see plans/feat-rich-embed-syntax-1221.md PR-C+.

import { escapeHtml, registerWikiEmbed } from "./wikiEmbeds";

/** Amazon ASIN format — letters + digits, 10 chars. The pattern
 *  guards against `[[amazon:javascript:alert(1)]]` style attacks
 *  by rejecting non-alphanumeric ids before composing the URL. */
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

/** ISBN-10 / ISBN-13 — digits + optional `X` checksum on ISBN-10.
 *  Non-digit / dash chars (other than the trailing X) reject. */
const ISBN_PATTERN = /^\d{9}[\dX]$|^\d{13}$/i;

/** Strip ISBN dashes the user might paste verbatim
 *  (`978-0-06-231609-7` → `9780062316097`). */
function normaliseIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, "");
}

/** Build an `<a>` opening tag with the safe / extern attribute
 *  set. Centralised so every handler renders the same shape. */
function externalLink(href: string, label: string, title?: string): string {
  const escapedHref = escapeHtml(href);
  const escapedLabel = escapeHtml(label);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer" class="wiki-embed wiki-embed-external"${titleAttr}>${escapedLabel}</a>`;
}

/** Bracket-render a verbatim `[[prefix:id]]` for the rare invalid-
 *  id case so the user sees what they typed (and can fix it)
 *  rather than nothing. */
function verbatim(prefix: string, embedId: string): string {
  const escapedSource = escapeHtml(`[[${prefix}:${embedId}]]`);
  const escapedTitle = escapeHtml(`Invalid ${prefix} id`);
  return `<span class="wiki-embed wiki-embed-invalid" title="${escapedTitle}">${escapedSource}</span>`;
}

export function registerAmazonEmbed(): void {
  registerWikiEmbed({
    prefix: "amazon",
    render: (embedId: string): string => {
      if (!ASIN_PATTERN.test(embedId)) return verbatim("amazon", embedId);
      // .com is the safe default — Amazon redirects to the user's
      // locale automatically when they're signed in. Locale-aware
      // routing (.co.jp etc.) is a follow-up.
      return externalLink(`https://www.amazon.com/dp/${embedId}`, `📦 ${embedId}`, `Amazon product ${embedId}`);
    },
  });
}

export function registerIsbnEmbed(): void {
  registerWikiEmbed({
    prefix: "isbn",
    render: (embedId: string): string => {
      const isbn = normaliseIsbn(embedId);
      if (!ISBN_PATTERN.test(isbn)) return verbatim("isbn", embedId);
      // OpenLibrary's `/isbn/<isbn>` URL resolves to the canonical
      // edition page and falls back to a search if the edition
      // isn't catalogued. No API key required.
      return externalLink(`https://openlibrary.org/isbn/${isbn}`, `📖 ISBN ${isbn}`, `OpenLibrary entry for ISBN ${isbn}`);
    },
  });
}

/** Convenience entry point — registers every built-in handler.
 *  Called once at app boot from `src/main.ts`. Idempotent. */
export function registerBuiltInWikiEmbeds(): void {
  registerAmazonEmbed();
  registerIsbnEmbed();
}
