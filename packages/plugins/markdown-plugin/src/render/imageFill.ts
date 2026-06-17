// Shared image-placeholder fill (task #6 Phase 4). The LLM is told to
// emit `![prompt](__too_be_replaced_image_path__)` for embedded images
// (see definition.ts); this owns the regex + the substitution format so
// every host stays in lockstep with that contract, while the actual
// image GENERATION + STORAGE is injected (each host wires its own
// Gemini + image store / data-URI strategy).

// Alt text is bounded ({1,1000}) rather than `+` so the regex stays linear on
// adversarial/uncontrolled markdown (CodeQL polynomial-ReDoS); image prompts are
// never anywhere near 1000 chars.
export const IMAGE_PLACEHOLDER = /!\[([^\]]{1,1000})\]\(\/?__too_be_replaced_image_path__\)/g;

/** Build the markdown that replaces one placeholder. `ref` is the
 *  host-resolved image reference (a workspace-rooted URL, a data URI, …)
 *  or null when generation was unavailable/failed — in which case the
 *  alt text is kept as an italic marker so the operator can see what
 *  *would* have been generated. */
export function buildImagePlaceholderReplacement(prompt: string, ref: string | null): string {
  if (ref) return `![${prompt}](${ref})`;
  return `*🖼️ Image: ${prompt}*`;
}

export interface ImagePlaceholderResult {
  full: string;
  prompt: string;
  ref: string | null;
}

export interface FillImagePlaceholdersDeps {
  /** Resolve a displayable image reference for `prompt` (the host
   *  generates + stores it, returning a URL or data URI), or null to
   *  fall back to a text marker. `index`/`total` are for progress logs. */
  resolveImage: (prompt: string, index: number, total: number) => Promise<string | null>;
  /** Max image generations in flight at once. Bounded so a document with
   *  many placeholders doesn't fan out into a burst of provider calls
   *  (rate limits / resource spikes). Default 4. */
  concurrency?: number;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving
 *  input order in the results. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Replace every `__too_be_replaced_image_path__` placeholder. Returns
 *  the filled markdown plus the per-placeholder results so the host can
 *  emit its own batch observability. Generation runs with bounded
 *  concurrency (`deps.concurrency`, default 4). */
export async function fillImagePlaceholders(
  markdown: string,
  deps: FillImagePlaceholdersDeps,
): Promise<{ markdown: string; results: ImagePlaceholderResult[] }> {
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return { markdown, results: [] };

  const total = matches.length;
  const results = await mapWithConcurrency(matches, deps.concurrency ?? 4, async (match, index) => ({
    full: match[0],
    prompt: match[1],
    ref: await deps.resolveImage(match[1], index, total),
  }));

  // One ordered pass over the same matches: `String.replace` with the
  // global regex invokes the replacer per match in document order, and
  // `results` is in matchAll order — so each placeholder (including
  // duplicate identical ones) gets its own result. Avoids the
  // quadratic re-scan + first-occurrence collision of a per-item
  // `filled.replace(full, …)` loop (Sourcery).
  let cursor = 0;
  const filled = markdown.replace(IMAGE_PLACEHOLDER, () => {
    const result = results[cursor++];
    return buildImagePlaceholderReplacement(result.prompt, result.ref);
  });
  return { markdown: filled, results };
}
