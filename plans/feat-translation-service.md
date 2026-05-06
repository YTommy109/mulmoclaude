# Translation service

A server-side microservice that translates short English UI strings
into other locales, backed by a per-dictionary JSON cache so the
LLM is only called on misses.

First consumer (separate PR): Role suggested queries, translated
asynchronously to the user's browser locale when a chat session is
opened.

## Why a separate service

Role queries are short, finite, and rarely change — close to the
ideal shape for an English-keyed cache that warms once and stays
warm. Building the service generically (rather than baking a
translation step into the roles config) keeps it reusable for other
short-string surfaces (helps text, role descriptions, plugin labels)
without each consumer growing its own caching strategy.

## API shape

```text
POST /api/translation
{
  "namespace": "role-queries",       // dictionary namespace + filename
  "targetLanguage": "ja",            // BCP-47 short code
  "sentences": ["Hello", "World"]    // English source
}
→ 200
{ "translations": ["こんにちは", "世界"] }   // same length, same order
```

`namespace` partitions translations by context, not by content hash.
We may only ever use one namespace (`role-queries`) but the parameter
keeps the option open for context-disambiguated translations later
(e.g. "Save" in a toolbar vs. a dialog). Validated against
`^[a-zA-Z0-9_-]+$` so it can't escape the cache directory.

## Cache file

Path: `{workspace}/data/translation/{namespace}.json`

```json
{
  "sentences": {
    "Hello": { "ja": "こんにちは", "ko": "안녕하세요" },
    "World": { "ja": "世界" }
  }
}
```

- Source English is the dictionary key — debuggable (`cat` shows
  exactly what's been translated), collision-free, no hash step.
- Files are KB-scale even with all 8 locales × hundreds of strings;
  loaded on each request, no in-memory cache layer.
- Orphan keys (English source got reworded) are left in place.
  Costs nothing; pruning would risk dropping live entries during
  partial deploys.

## Service flow

1. **`en` short-circuit** — if `targetLanguage === "en"`, return
   `sentences` as-is. No cache I/O, no LLM call.
2. **Validate inputs** — `namespace` matches the safe regex,
   `targetLanguage` matches `^[a-z]{2}(-[A-Z]{2})?$`, `sentences`
   is a non-empty array of non-empty strings.
3. **Load cache** — read `{namespace}.json` if it exists, else
   start with `{ sentences: {} }`.
4. **Split hit / miss** — for each input sentence, check
   `cache.sentences[sentence]?.[targetLanguage]`.
5. **Translate misses** — call the injected `translateBatch`
   function with only the missing sentences. Validate the returned
   array length matches the request.
6. **Merge + write** — fold new translations into the cache,
   atomic-write back via `writeFileAtomic`.
7. **Return** — assemble the output array in the original input
   order (cached entries + freshly-translated, mapped back).

## Single-flight per namespace

Concurrent requests for the same `namespace` would race on
read-merge-write. An in-memory `Map<namespace, Promise<void>>`
serializes the cache update step per namespace. Held only for the
duration of the LLM call + write; released regardless of outcome.

## LLM call (production)

Spawn the `claude` CLI in print mode:

```bash
claude -p "<prompt>" --output-format json
```

This piggybacks on the same auth model the existing
`server/agent/backend/claude-code.ts` already uses (no new
dependency, no `ANTHROPIC_API_KEY` required). The prompt asks
for a JSON array of translations matching the input order; we
parse and length-check before merging.

Subprocess wrapped in `server/services/translation/llm.ts` and
injected into the service factory, so unit tests pass a mock
function and never spawn anything.

Timeout: reuse `SUBPROCESS_WORK_TIMEOUT_MS` from
`server/utils/time.ts`. On timeout the request fails with 503;
the cache is not written.

## File layout

```text
server/
  services/translation/
    index.ts        ← createTranslationService({ translateBatch })
    cache.ts        ← load / merge / mapping helpers (pure)
    llm.ts          ← prod translateBatch impl (spawns claude -p)
    types.ts
  utils/files/translation-io.ts   ← atomic read/write per project rule
  api/routes/translation.ts       ← Express handler

src/config/apiRoutes.ts            ← +translation: "/api/translation"
server/workspace/paths.ts          ← +translation: "data/translation"

test/services/translation/
  test_translate.ts                ← cache hit/miss/partial, en short-circuit, order, merge, validation
  test_cache.ts                    ← pure cache helpers
```

## Test plan (PR 1)

All against an injected mock `translateBatch`. Real workspace I/O
into a temp dir per the existing `test/journal/` pattern.

- **cold**: empty cache → mock called with all sentences → cache
  file created with new entries → result matches mock output.
- **warm**: full cache → mock NOT called → result from cache only.
- **partial**: 2 of 5 cached → mock called with 3 misses only →
  result is in original input order (interleaved cached + fresh).
- **merge**: cache has `{Hello: {ja}}`, request `ko` → final cache
  has `{Hello: {ja, ko}}` (existing language preserved).
- **`en` short-circuit**: targetLanguage `en` → mock NOT called,
  cache file not touched, returns input verbatim.
- **length mismatch**: mock returns wrong-length array → throws.
- **namespace validation**: `../etc` rejected.
- **single-flight**: two concurrent calls on the same namespace →
  mock invoked exactly once for the overlapping misses, both
  promises resolve with consistent results.

## Out of scope (PR 1)

- Role-queries integration (separate PR — see below).
- LRU / TTL eviction (orphan keys are cheap; no need).
- Cross-process cache coordination (single-flight is per Node
  process; we run one server).
- Streaming partial results (synchronous JSON response).

## PR 2 (separate): wire to Role suggested queries

When the chat session opens:

1. Read browser locale via the existing i18n composable.
2. If `en`, render queries as-is.
3. Otherwise, fire `POST /api/translation` with
   `namespace: "role-queries"` and the role's English queries.
4. Render English immediately; swap to translations when the
   response arrives (progressive enhancement, never blocks the
   chat UI).
5. Use `apiPost` from `src/utils/api.ts` (auto-attaches bearer
   token).

PR 2 also picks the right place in the role-rendering path to
stash the translated queries (likely a composable that wraps the
role config rather than mutating it in place).
