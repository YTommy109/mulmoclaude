// CSP whitelist applied to HTML files previewed in the Files
// explorer iframe. We ship a narrow list of trusted CDNs that the
// LLM commonly pulls from (Chart.js, D3, Tailwind, etc. via
// jsdelivr / unpkg / cdnjs) plus Google Fonts. Anything else —
// random `https://` origins, phone-home `fetch()` calls, etc. —
// is rejected.
//
// Widen by editing `HTML_PREVIEW_CSP_ALLOWED_CDNS` below. Keep the
// list audited — every entry is a potential supply-chain surface.

export const HTML_PREVIEW_CSP_ALLOWED_CDNS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

/**
 * Build the CSP string. Split from the wrapper so tests can exercise
 * the policy without HTML-template noise.
 */
export function buildHtmlPreviewCsp(
  cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS,
): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    // LLM-authored HTML almost always uses inline <script> blocks
    // alongside the CDN load. No feasible path to avoid
    // 'unsafe-inline' without rewriting every output.
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    // Images: lenient. Covers /api/files/raw (via wildcard), data
    // URIs for inline PNGs, blob: for dynamically-generated charts,
    // and any external https image.
    "img-src * data: blob:",
    // Block XHR / fetch / WebSocket so previews can't phone home or
    // exfiltrate anything the inline scripts happen to compute.
    "connect-src 'none'",
  ].join("; ");
}

const CSP_META_NONCE = ""; // reserved for future use (per-render nonce)

/**
 * Inject a `<meta http-equiv="Content-Security-Policy">` tag into the
 * HTML head. If the HTML has no `<head>`, wrap it as a full document
 * with a synthetic head so the meta tag is honoured regardless.
 *
 * Pure — doesn't touch the DOM. Safe to use from both client and
 * tests.
 */
export function wrapHtmlWithPreviewCsp(html: string): string {
  const csp = buildHtmlPreviewCsp();
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${meta}`);
  }
  // No <head> — treat as fragment and wrap it.
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>${CSP_META_NONCE}`;
}
