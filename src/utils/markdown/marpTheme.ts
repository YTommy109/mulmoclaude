// Marp custom-theme helpers (#1649). Shared by the frontend (MarpView)
// and the server (PDF route + workspace I/O).
//
// Marp identifies themes by a `/* @theme <name> */` comment at the
// top of the CSS source. The workspace convention is **filename =
// theme name**: `config/marp-themes/corporate.css` registers a theme
// named `corporate` and is referenced from a deck's frontmatter
// `theme: corporate`. `ensureThemeDirective` injects the directive
// if the file omits it, so users don't have to remember the
// boilerplate.
//
// `sanitizeMarpThemeCss` rejects any CSS that pulls external
// resources at render time. The Marp themeSet itself happily accepts
// `@import url(http://...)` and `url(http://attacker/track.png)`,
// but our preview iframe's CSP already denies non-same-origin
// network traffic — so a theme that needed those would render
// broken anyway, and accepting it would create an SSRF / tracking
// vector in the server-side PDF path which runs in a headless
// browser without the iframe's CSP. Block at load time; surface a
// diagnostic on the bell so authors notice.

const THEME_DIRECTIVE_RE = /\/\*\s*@theme\s+([A-Za-z0-9_-]+)\s*\*\//;

/** Strip the `.css` extension and validate the slug.
 *  Returns null for names that wouldn't survive Marp's own
 *  `[A-Za-z0-9_-]` validator. */
export function marpThemeNameFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".css")) return null;
  const base = filename.slice(0, -4);
  if (!/^[A-Za-z0-9_-]+$/.test(base)) return null;
  return base;
}

/** Re-stamp the `@theme <name>` Marp directive on the CSS so the
 *  registered name matches the filename (the convention the rest of
 *  the system relies on). If the CSS already declares a different
 *  name, the filename wins — we don't want a `themes/foo.css` that
 *  registers as "bar", because the frontmatter lookup would silently
 *  miss. */
export function ensureThemeDirective(css: string, themeName: string): string {
  const stripped = css.replace(THEME_DIRECTIVE_RE, "").trimStart();
  return `/* @theme ${themeName} */\n${stripped}`;
}

export interface SanitizeResult {
  ok: boolean;
  reason?: string;
}

/** Reject CSS that would pull external resources at render time.
 *  Allows `data:` URIs (inline fonts) and same-origin refs. */
export function sanitizeMarpThemeCss(css: string): SanitizeResult {
  if (/@import\s+url\s*\(\s*['"]?https?:/i.test(css)) {
    return { ok: false, reason: "external @import url(http...) is not allowed" };
  }
  if (/@import\s+['"]https?:/i.test(css)) {
    return { ok: false, reason: "external @import 'http://...' is not allowed" };
  }
  if (/url\s*\(\s*['"]?https?:/i.test(css)) {
    return { ok: false, reason: "external url(http://...) is not allowed" };
  }
  return { ok: true };
}
