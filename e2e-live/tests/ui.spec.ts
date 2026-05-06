import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, getCurrentSessionId, sendChatMessage, startNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const L19_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L20_TIMEOUT_MS = ONE_MINUTE_MS;

// Each scenario is independent — L-19 spins up its own chat session,
// L-20 stays on a static route — so run them in parallel to cut wall
// time. Same justification as media.spec.ts / wiki-nav.spec.ts.
test.describe.configure({ mode: "parallel" });

test.describe("ui (real LLM / static)", () => {
  test("L-19: stack layout で 1 ターン後 reload しても stack-scroll が再描画される", async ({ page }) => {
    test.setTimeout(L19_TIMEOUT_MS);
    // Covers B-31: tool-call history used to drop on reload because
    // the stack view's `toolResults` was rebuilt from the in-memory
    // turn stream rather than the persisted session record. The fix
    // hydrates from the session jsonl on mount, so reload should keep
    // `stack-scroll` mounted (and `stack-empty` hidden). A single-word
    // prompt is enough — even the assistant's textResponse reply
    // counts as a stack entry, so we don't need to coerce a tool
    // call to populate the panel.
    //
    // The default canvas layout is `single` (App.vue gates StackView
    // on `layoutMode === 'stack'`), so `stack-scroll` only mounts
    // after the user opts into stack mode. We seed the localStorage
    // key before the first navigation so both the initial render and
    // the post-reload render land in stack layout — that matches the
    // human-side reproduction path for B-31 (a stack-mode user notices
    // their turns disappearing on reload).
    const userPrompt = "Reply with the single word: stack";
    let sessionIdForCleanup: string | null = null;
    try {
      // addInitScript runs before every navigation (including reload),
      // so the stack preference survives the page.reload() below
      // without re-injecting after the second navigation.
      await page.addInitScript(() => {
        window.localStorage.setItem("canvas_layout_mode", "stack");
      });
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      await waitForAssistantResponseComplete(page);
      sessionIdForCleanup = getCurrentSessionId(page);

      // Pre-reload: the assistant's reply must have at least one
      // entry in the stack (textResponse view). If this fails the
      // bug is upstream of B-31 (stack never populated in the first
      // place), so the assertion message stays distinct from the
      // post-reload one for diagnosability.
      await expect(page.getByTestId("stack-scroll"), "stack must be populated after the first turn (pre-reload)").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must be hidden once a turn has landed").toBeHidden();

      await page.reload();

      // Post-reload: B-31's regression shape — the stack flips back
      // to the empty placeholder because hydration didn't refill
      // toolResults. Assert both the positive (stack still mounted)
      // and the negative (placeholder didn't reappear) so we catch
      // either side of the regression.
      await expect(page.getByTestId("stack-scroll"), "stack must rehydrate from the session record after reload — B-31 canary").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must stay hidden after reload — B-31 canary").toBeHidden();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-20: 旧形式 /files?path=foo.md は新形式 /files/foo.md に書き換わる", async ({ page }) => {
    test.setTimeout(L20_TIMEOUT_MS);
    // Covers B-30 (URL-shape side): the legacy query-string form
    // `/files?path=…` must be silently rewritten to the new path
    // form `/files/…` by the router guard. Reload is a safety
    // net — the rewrite is `replace: true` so it should land in
    // history once and stay; we re-check after reload to make sure
    // the guard does not bounce the URL on every navigation.
    //
    // No file actually has to exist at the target path — we are
    // testing the router guard in isolation, not the file fetch.
    // `e2e-live-l20-nonexistent.md` is intentionally not seeded so
    // the cleanup story stays trivial (nothing to remove).
    const targetFile = "e2e-live-l20-nonexistent.md";
    await page.goto(`/files?path=${encodeURIComponent(targetFile)}`);
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);
  });
});
