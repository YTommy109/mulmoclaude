// Auto-linkify inline-code spans whose content looks like a
// workspace-relative path to a generated / data file (#1300).
//
// The LLM is told (via `server/agent/prompt.ts` → "Referring to
// files in chat replies") to present generated files as Markdown
// links: `[name.pdf](artifacts/.../name.pdf)`. That covers 80%+ of
// outputs deterministically. The remaining tail — where the model
// drops the wrapper and ships ``artifacts/.../name.pdf`` as an
// inline code span — used to render as non-clickable code, forcing
// the user to copy/paste. This extension catches that residual case
// and wraps the codespan in an anchor so the existing
// workspace-link routing (#1102 / L-23) picks it up.
//
// Detection is intentionally narrow:
//   - prefix MUST be `artifacts/` or `data/` (= host's two
//     workspace-root file dirs; never matches a generic code
//     identifier like `obj.prop`)
//   - the path MUST be whitespace-free and end with `.<ext>` where
//     ext is 1-8 alphanumeric chars
// Anything that doesn't match falls through to the default
// codespan rendering — so legitimate code snippets (CSS selectors,
// CLI flags, version strings) keep their `<code>` shape.

import type { MarkedExtension } from "marked";

// Greedy by design: matches up to the LAST `.ext` group, so paths
// with intermediate dots (e.g. `archive.tar.gz`) get the FULL path
// wrapped, not just the trailing `.gz`. `[^\s.]` inside the body
// avoids backtracking on multi-dot input.
const WORKSPACE_PATH_PATTERN = /^(?:artifacts|data)\/[^\s]+\.[A-Za-z0-9]{1,8}$/;

/** Pure test seam — exported so the unit test can drive every
 *  decision branch without spinning up marked. */
export function isWorkspacePath(text: string): boolean {
  return WORKSPACE_PATH_PATTERN.test(text);
}

/** Wrap `<code>...</code>` in an anchor that the workspace-link
 *  routing in `src/utils/dom/externalLink.ts` (and the global
 *  click handler in chat / files / wiki views) already knows how
 *  to intercept and route. `text` is the codespan content marked
 *  has already HTML-escaped — workspace paths contain no special
 *  chars, but treating it as escaped keeps the contract honest. */
function wrapAsWorkspaceLink(text: string): string {
  return `<a href="${text}" class="workspace-link" data-workspace-path="${text}"><code>${text}</code></a>`;
}

export const workspaceLinkifyExtension: MarkedExtension = {
  renderer: {
    codespan(token): string {
      const { text } = token;
      if (!isWorkspacePath(text)) {
        return `<code>${text}</code>`;
      }
      return wrapAsWorkspaceLink(text);
    },
  },
};
