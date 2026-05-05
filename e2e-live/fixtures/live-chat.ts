// Live-mode helpers for e2e-live. Mirrors the surface of
// `e2e/fixtures/chat.ts` for the shared interactions, but does NOT
// install any API mocks — the real Claude API runs end-to-end. Use
// these helpers from specs in `e2e-live/tests/`.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Download, type FrameLocator, type Page, expect } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the user's mulmoclaude workspace. Honours the env override
 * the server itself respects so the tests still work when a custom
 * workspace is in use.
 *
 * Caveat: if you set `MULMOCLAUDE_WORKSPACE` in your shell to point
 * tests at a sandbox dir, `unset` it before running mulmoclaude
 * itself — fixture cleanup writes inside whatever this resolves to,
 * and a stale env in the parent shell will silently target the
 * wrong workspace.
 */
function workspaceRoot(): string {
  return process.env.MULMOCLAUDE_WORKSPACE ?? path.join(homedir(), "mulmoclaude");
}

/**
 * Resolve a workspace-relative path to an absolute path inside the
 * workspace root, refusing anything that escapes the root via `..`
 * or absolute paths. Defensive guard so a mistyped fixture target
 * cannot delete arbitrary files on the host.
 */
function resolveWorkspacePath(workspaceRel: string): string {
  const root = path.resolve(workspaceRoot());
  const target = path.resolve(root, workspaceRel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Workspace-relative path escapes workspace root: ${workspaceRel}`);
  }
  return target;
}

/**
 * Copy a fixture file (relative to `e2e-live/fixtures/`) into the
 * workspace at the given relative path. Creates intermediate dirs.
 * Returns the absolute destination path so the spec can pass it on
 * to {@link removeFromWorkspace} for cleanup. The destination
 * filename should be unique per spec to avoid stomping on real
 * user data.
 */
export async function placeFixtureInWorkspace(fixtureRel: string, workspaceRel: string): Promise<string> {
  const src = path.join(FIXTURES_DIR, fixtureRel);
  const dst = resolveWorkspacePath(workspaceRel);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return dst;
}

/** Best-effort delete; never throws if the file is already gone. */
export async function removeFromWorkspace(workspaceRel: string): Promise<void> {
  await rm(resolveWorkspacePath(workspaceRel), { force: true });
}

/**
 * Drop a wiki page directly onto disk at `data/wiki/pages/<slug>.md`.
 * The wiki view fetches /api/wiki?slug=<slug> on navigate, which
 * reads the same file — so seeding the file is enough to make a page
 * accessible via the standalone /wiki/pages/<slug> route. Spec-unique
 * slugs only; do not stomp real user pages.
 */
export async function placeWikiPage(slug: string, body: string): Promise<void> {
  const target = resolveWorkspacePath(`data/wiki/pages/${slug}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
}

export async function removeWikiPage(slug: string): Promise<void> {
  await removeFromWorkspace(`data/wiki/pages/${slug}.md`);
}

const WIKI_PAGE_BODY_SELECTOR = '[data-testid="wiki-page-body"]';

/**
 * Open a wiki page directly via its standalone route. The SPA's wiki
 * router fetches /api/wiki?slug=... and renders the page body into
 * `[data-testid="wiki-page-body"]` (the v-html surface inside
 * `WikiPageBody.vue`). Used as the entry point for L-W-S-* specs.
 */
export async function navigateToWikiPage(page: Page, slug: string): Promise<void> {
  await page.goto(`/wiki/pages/${encodeURIComponent(slug)}`);
}

/**
 * Wait for an `<img>` matching `imgSelector` to appear inside the
 * rendered wiki page body. Counterpart to `waitForImgInPresentHtml`
 * for the markdown surface — no iframe boundary, the body is a
 * direct DOM child of the page.
 */
export async function waitForImgInWiki(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  await expect(body.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * in the wiki body. Lets the caller assert the rewriter produced the
 * expected `/api/files/raw?path=...` path (or, for self-repair tests,
 * the final repaired URL).
 */
export async function readImgSrcInWiki(page: Page, imgSelector: string): Promise<string | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` / `naturalHeight` of the first matching `<img>`
 * in the wiki body. Both 0 means the rewritten URL did not resolve to
 * a decodable image — that's the failure mode every L-W-S-* spec
 * guards against.
 */
export async function readImgNaturalSizeInWiki(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

/**
 * Pull the chat session id out of the current URL. Returns null if
 * the page is not on a /chat/<id> route (e.g. before the first
 * navigation, or while sitting on /wiki).
 */
export function getCurrentSessionId(page: Page): string | null {
  const match = /\/chat\/([^/?#]+)/.exec(page.url());
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Best-effort hard-delete a chat session via the same UI gesture a
 * human user performs — open the session row's kebab menu in the
 * sidebar history, click the red 削除 item, and accept the
 * `window.confirm` "このセッションを削除しますか？" prompt that the SPA
 * raises. Used as cleanup so the test does not leave debug sessions
 * piling up in the user's history.
 *
 * Without the `page.once("dialog", ...)` accept the prompt would
 * stay pending and the SPA would never call DELETE — that was the
 * silent-skip mode behind the leftover-history symptom we saw
 * before this change.
 *
 * Never throws. Cleanup failures (page already closed, sidebar
 * collapsed, session already gone) must not turn a passing test red.
 */
const DELETE_BUTTON_TIMEOUT_MS = 10_000;

// Opt-in QA hold-mode. When the runner sets E2E_LIVE_KEEP_SESSIONS=1
// every spec leaves its session intact in history so a human can
// inspect the residue (chat transcript, generated artifacts, plugin
// state) after the test finishes — pair with HEADED=1 for the
// "watch it drive, then poke at the result" flow. Cleanup falls to
// the user (sidebar kebab → 削除) once they're done.
//
// We gate inside deleteSession itself so every existing spec
// (L-01..L-14 and onwards) inherits the behaviour without any
// per-spec retrofit — every cleanup site already routes through
// here in a `finally { ... }` block.
const KEEP_SESSIONS_ENV = "E2E_LIVE_KEEP_SESSIONS";

function shouldKeepSessions(): boolean {
  return process.env[KEEP_SESSIONS_ENV] === "1";
}

/**
 * Poll `GET /api/sessions` until `session.isRunning` flips to false
 * for the given id. Bridges the gap between "the assistant
 * `thinking-indicator` went hidden" (the UI signal
 * `waitForAssistantResponseComplete` waits on) and "the server is
 * willing to accept the DELETE" — without this wait, the UI
 * cleanup click sequence races server state and the route returns
 * 409 silently from the UI's point of view, the test passes, and
 * the file stays on disk.
 *
 * Predicate-asymmetry note (codex iter-2): the summary `isRunning`
 * we read here is `live.isRunning || pendingGenerations.length>0`
 * (server/api/routes/sessions.ts:150), but `DELETE /api/sessions/:id`
 * only checks `getSession()?.isRunning` proper (line 401), without
 * pendingGenerations. We intentionally wait on the STRICTER summary
 * predicate because:
 *   * the summary is the only `isRunning`-shaped field exposed on
 *     the public API today — querying just `live.isRunning` would
 *     need a server-side endpoint addition
 *   * waiting too long is the safe direction (we never delete
 *     before the server is ready); waiting too SHORT is the
 *     regression we are explicitly closing
 *   * for every spec in this suite, the test already waits for
 *     the user-visible artifact to render (Download Movie button
 *     for L-04, etc.) before reaching cleanup — by then
 *     pendingGenerations is empty in practice, so the stricter
 *     predicate doesn't add measurable wall time
 *
 * Runs the fetch inside `page.evaluate` so the browser's bearer
 * header (read from `<meta name="mulmoclaude-auth">`) is reused
 * verbatim — no need to plumb the token into the test process.
 */
const SESSION_IDLE_TIMEOUT_MS = 30_000;

// Probe shape returned by the in-page evaluate. We carry both the
// HTTP outcome and the session-running flag so the polling site can
// distinguish "API healthy + session still busy" (retry quietly)
// from "API failed" (surface as a real assertion failure inside
// `toPass`, with the offending status / error message in the
// log). Without this split, a 401/5xx or a network blip silently
// looks like "session is still running" and the poller waits the
// full timeout before falling through to the swallowed UI cleanup
// — exactly the silent failure the original wait was added to fix.
type SessionIdleProbe = { ok: true; stillRunning: boolean } | { ok: false; reason: string };

async function waitForSessionIdle(page: Page, sessionId: string, timeoutMs: number = SESSION_IDLE_TIMEOUT_MS): Promise<void> {
  await expect(async () => {
    const probe: SessionIdleProbe = await page.evaluate(async (sid) => {
      const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
      const token = meta?.getAttribute("content") ?? "";
      try {
        const res = await fetch("/api/sessions", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return { ok: false as const, reason: `GET /api/sessions returned HTTP ${res.status} ${res.statusText}` };
        const data = (await res.json()) as { sessions?: { id: string; isRunning?: boolean }[] };
        const session = data.sessions?.find((row) => row.id === sid);
        return { ok: true as const, stillRunning: session?.isRunning === true };
      } catch (err) {
        // Network drop / abort / JSON parse throw — anything that
        // would otherwise surface as an opaque page.evaluate failure
        // outside `toPass`'s retry semantics. Funnel it back as a
        // structured failure so the assertion message names the cause.
        return { ok: false as const, reason: `GET /api/sessions threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    }, sessionId);
    expect(probe.ok, probe.ok ? "session probe ok" : `session probe failed for ${sessionId}: ${probe.reason}`).toBe(true);
    if (probe.ok) {
      expect(probe.stillRunning, `session ${sessionId} should report isRunning=false before delete`).toBe(false);
    }
  }).toPass({ timeout: timeoutMs, intervals: [200, 500, 1000] });
}

export async function deleteSession(page: Page, sessionId: string): Promise<void> {
  if (page.isClosed()) return;
  if (shouldKeepSessions()) {
    // QA-mode breadcrumb so the runner can confirm the gate fired.
    console.log(`[${KEEP_SESSIONS_ENV}=1] keeping session ${sessionId} for inspection`);
    return;
  }
  try {
    // Step away from /chat/<id> first — the server's isRunning
    // guard rejects DELETE on whichever session the page is
    // currently sitting on (it's still in the active store right
    // after the assistant turn). Routing to "/" detaches the
    // SPA's hold so the cleanup flow lands on a quiescent record.
    if (page.url().includes(`/chat/${sessionId}`)) {
      await page.goto("/");
    }
    // Then wait for the SERVER side to agree the session is no
    // longer running — `thinking-indicator` going hidden is a UI
    // signal, but `live.isRunning || pendingGenerations` lingers a
    // little longer on the server. Skipping this wait is exactly
    // the regression that surfaced as a silent 409 inside the
    // route handler while the UI dance reported success.
    await waitForSessionIdle(page, sessionId);
    // The session-row kebab menu lives inside the session-history
    // side panel, which is collapsed by default. Open it via the
    // toggle button (testid switches between -off and -on) before
    // looking up the row.
    const toggleOff = page.getByTestId("session-history-toggle-off");
    if ((await toggleOff.count()) > 0 && (await toggleOff.isVisible())) {
      await toggleOff.click();
    }
    const menuButton = page.getByTestId(`session-row-menu-${sessionId}`);
    await menuButton.click({ timeout: DELETE_BUTTON_TIMEOUT_MS });
    // Auto-accept the SPA's `window.confirm("このセッションを削除しますか？")`
    // prompt that fires from the delete button's @click handler.
    page.once("dialog", (dialog) => {
      dialog.accept().catch(() => undefined);
    });
    const deleteButton = page.getByTestId(`session-row-delete-${sessionId}`);
    await deleteButton.click({ timeout: DELETE_BUTTON_TIMEOUT_MS });
  } catch (err) {
    // best-effort: page closing, sidebar collapsed, session already gone, etc.
    console.warn(`deleteSession: UI cleanup skipped for session ${sessionId}`, err);
  }
}

const PRESENT_HTML_IFRAME_SELECTOR = '[data-testid="present-html-iframe"]';

/** Open the app root and start a fresh chat session. */
export async function startNewSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("new-session-btn").click();
}

/** Fill the chat input and click send. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("user-input").fill(text);
  await page.getByTestId("send-btn").click();
}

/**
 * Switch the active role via the dropdown. App.vue's `onRoleChange`
 * spins up a fresh session in the new role on chat pages, so callers
 * are expected to capture the new session id (after the next user
 * turn) for cleanup. Idempotent: calling with the already-active role
 * still works because the dropdown emits `change` on every selection.
 */
export async function selectRole(page: Page, roleId: string): Promise<void> {
  await page.getByTestId("role-selector-btn").click();
  await page.getByTestId(`role-option-${roleId}`).click();
}

/**
 * Wait for an `<img>` matching the selector to appear *inside* the
 * presentHtml iframe. The iframe element itself is appended to the
 * DOM before its srcdoc finishes rendering, so a plain `iframe`
 * `toBeVisible` check returns too early — we have to reach into
 * the frame and wait for the actual rendered child.
 */
export async function waitForImgInPresentHtml(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<FrameLocator> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  await expect(frame.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
  return frame;
}

/**
 * Wait for Claude to finish its full turn — the `thinking-indicator`
 * disappears when the assistant has stopped streaming. Without this
 * the test would end the moment any earlier assertion passes, and
 * the trace / video would cut off mid-response, hiding any later
 * regression that only surfaces after the iframe is rendered (for
 * example a text reply that fails because of a downstream error).
 *
 * If the indicator was never rendered (response was instant) this
 * still resolves cleanly because Playwright's `toBeHidden` treats
 * a detached element as hidden.
 */
export async function waitForAssistantResponseComplete(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  await expect(page.getByTestId("thinking-indicator")).toBeHidden({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * inside the presentHtml iframe. We use Playwright's `frameLocator`
 * + `getAttribute` rather than `page.evaluate` + `contentDocument`
 * because the srcdoc iframe is recreated whenever Vue updates the
 * `srcdoc` prop. A `contentDocument` reference held by an in-page
 * `evaluate` block can land on the previous (empty) document and
 * miss the rendered child entirely, even after the iframe element
 * is "visible" in the DOM. `frameLocator` re-resolves the live
 * frame each time, matching the wait helper above.
 *
 * Reading the unresolved attribute (not `img.src`) lets assertions
 * check the rewritten path verbatim instead of the absolute
 * resolved URL the browser computes.
 */
export async function readImgSrcInPresentHtml(page: Page, imgSelector: string): Promise<string | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` and `naturalHeight` for an `<img>` inside the
 * presentHtml iframe. Both are 0 when the image is broken (404,
 * blocked by sandbox, etc.), so the caller can assert that the
 * rewritten URL actually resolves to a real, decodable image.
 */
export async function readImgNaturalSize(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

/**
 * Detect whether the in-iframe onerror self-repair (PR #974) fired
 * on an `<img>`. The repair script tags the element with
 * `data-image-repair-tried="1"` before rewriting `src` to
 * `/artifacts/images/<rest>`, so the marker's presence after the
 * image has loaded is a direct signal that the original LLM-emitted
 * src was broken and the browser silently rescued it.
 *
 * Without this check, an LLM regression that emits a path containing
 * the `artifacts/images/` segment behind a wrong prefix would still
 * pass `naturalWidth > 0` because self-repair masks the 404. Reading
 * the marker preserves the suite's ability to catch convention drift.
 */
export async function readImgRepairAttempted(page: Page, imgSelector: string): Promise<boolean | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  const marker = await img.getAttribute("data-image-repair-tried");
  return marker !== null;
}

const GENERATE_IMAGE_VIEW_SELECTOR = '[data-testid="generate-image-view"]';

/**
 * Wait for the generateImage canvas view to render an `<img>` — i.e.
 * the LLM called the tool, the server returned an `imageData` path,
 * and the SPA mounted ImageView with a non-empty `resolvedSrc`. Use
 * before reading src / naturalWidth so the spec does not race the
 * ImageView placeholder ("No image yet").
 */
export async function waitForGeneratedImage(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const view = page.locator(GENERATE_IMAGE_VIEW_SELECTOR);
  await expect(view.locator("img").first()).toBeVisible({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the generated image. After
 * PR #969 / #972 introduced the `/artifacts/images/` static mount,
 * `resolveImageSrcFresh` produces `/artifacts/images/<path>?v=<bump>`,
 * so the caller can assert the prefix to catch regressions in the
 * image storage / resolve chain.
 */
export async function readGeneratedImageSrc(page: Page): Promise<string | null> {
  const img = page.locator(GENERATE_IMAGE_VIEW_SELECTOR).locator("img").first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` / `naturalHeight` of the generated image. Both
 * 0 means the static mount returned a non-decodable response (404,
 * empty file, wrong MIME) — that is the failure mode we want to
 * detect end-to-end, paralleling the iframe-side `readImgNaturalSize`.
 */
export async function readGeneratedImageNaturalSize(page: Page): Promise<{ width: number; height: number } | null> {
  const img = page.locator(GENERATE_IMAGE_VIEW_SELECTOR).locator("img").first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const PDF_EOF = Buffer.from("%%EOF", "ascii");
// PDF spec writes %%EOF in the last few hundred bytes; widen to
// 2 KiB so trailing whitespace, line endings, or `<startxref>`
// blocks don't shift it past our search window.
const PDF_EOF_TAIL_BYTES = 2048;

/**
 * Read a Playwright `Download` into memory and check that it is a
 * real PDF rather than an HTML error page or a truncated stream.
 * Validates both the `%PDF-` header and the `%%EOF` tail marker,
 * so a connection that drops mid-response is rejected. Returns
 * the buffer so the caller can run extra assertions (file size,
 * inline image search, etc.).
 */
export async function readPdfDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Download has no on-disk path; was failOnStatusCode triggered?");
  }
  const buf = await readFile(downloadPath);
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    const head = buf.subarray(0, 64).toString("utf8");
    throw new Error(`Downloaded file is not a PDF (first bytes: ${JSON.stringify(head)})`);
  }
  const tail = buf.subarray(Math.max(0, buf.length - PDF_EOF_TAIL_BYTES));
  if (tail.indexOf(PDF_EOF) === -1) {
    throw new Error(`Downloaded PDF appears truncated (missing %%EOF marker, length ${buf.length})`);
  }
  return buf;
}

// presentMulmoScript downloads always land as `<id>.mp4` (see
// downloadMovie in plugins/presentMulmoScript/View.vue), and the
// MP4 container always tags bytes 4..7 with the `ftyp` box marker
// regardless of brand (isom / mp42 / etc.). Checking that marker
// rejects HTML error pages, empty stubs, and any other format that
// might slip through if the route accidentally returned a different
// payload.
const MP4_FTYP = Buffer.from("ftyp", "ascii");

/**
 * Read a Playwright `Download` for a mulmoScript movie and check
 * that it is a real MP4. Validates the `ftyp` box at offset 4, so an
 * HTML error response or a near-empty stub fails fast. Returns the
 * buffer so the caller can layer additional assertions (size floor,
 * stream parsing, etc.).
 */
export async function readMovieDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Download has no on-disk path; was failOnStatusCode triggered?");
  }
  const buf = await readFile(downloadPath);
  if (buf.length < 8) {
    throw new Error(`Downloaded movie too small to inspect (${buf.length} bytes)`);
  }
  if (!buf.subarray(4, 8).equals(MP4_FTYP)) {
    const head = buf.subarray(0, 16).toString("hex");
    throw new Error(`Downloaded file is not an MP4 (expected 'ftyp' at offset 4, got hex: ${head})`);
  }
  return buf;
}
