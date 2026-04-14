import { resolveImageSrc } from "./resolve";

// Pre-`marked` pass that rewrites workspace-relative image references
// in markdown source so they render through the backend file server.
//
// Without this, a page like `![chart](../images/foo.png)` produces
// `<img src="../images/foo.png">`, which the browser resolves against
// the SPA page URL (e.g. `/chat/…foo.png`) and 404s. After this
// pass, the src becomes `/api/files/raw?path=images/foo.png` which
// the workspace file server serves.
//
// Kept as a pure string→string transform so it can be applied
// uniformly wherever we render user/LLM-authored markdown outside
// the markdown plugin proper:
//
//   - `src/plugins/wiki/View.vue`
//   - `src/components/FilesView.vue` (when previewing a .md file)
//   - potential future renderers
//
// The markdown plugin (`src/plugins/markdown/View.vue`) has its own
// post-`marked` HTML rewriter; both approaches reach the same end
// state, but pre-marked is less brittle for places where we don't
// own the rendering pipeline (TextResponseView).

// Match `![alt](url)`. Single character class per span, no
// overlapping backtracking surface (linear-time matching).
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;

function shouldSkip(url: string): boolean {
  if (url.startsWith("data:")) return true;
  if (url.startsWith("http://") || url.startsWith("https://")) return true;
  // Already an API route — nothing to do.
  if (url.startsWith("/api/")) return true;
  return false;
}

function normalizeRelative(url: string): string {
  // Strip leading `./` / `../` segments. Markdown authored from
  // different workspace subdirs typically uses `../images/foo.png`
  // relative to the file's own directory; our API resolves from the
  // workspace root so the relative prefix is always noise.
  let out = url;
  while (out.startsWith("./")) out = out.slice(2);
  while (out.startsWith("../")) out = out.slice(3);
  return out;
}

/**
 * Rewrite `![alt](path)` image refs in markdown text so workspace-
 * relative paths render through `/api/files/raw`. Absolute URLs,
 * data URIs, and existing API paths pass through untouched.
 *
 * Pure — safe to call on any markdown string.
 */
export function rewriteMarkdownImageRefs(markdown: string): string {
  return markdown.replace(IMAGE_REF_RE, (match, alt: string, url: string) => {
    const trimmedUrl = url.trim();
    if (trimmedUrl === "" || shouldSkip(trimmedUrl)) return match;
    const resolved = resolveImageSrc(normalizeRelative(trimmedUrl));
    return `![${alt}](${resolved})`;
  });
}
