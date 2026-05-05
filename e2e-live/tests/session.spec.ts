import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, getCurrentSessionId, sendChatMessage, startNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const L11_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
// L-12 carries two LLM turns plus a reload, so it gets a wider
// budget than L-11. Each turn is a no-tool single-fact recall, so
// 4 minutes still leaves slack on a cold-cache run without inviting
// a hung scenario to soak the wall clock.
const L12_TIMEOUT_MS = 4 * ONE_MINUTE_MS;
// Six-digit code rather than a word: deterministic to assert on
// (`toContainText("729841")` survives even if the LLM wraps the
// answer in markdown / quotes / multilingual prose) and unlikely
// enough to collide with anything else in the DOM (sidebar history
// previews, chrome strings, role names).
const L12_MAGIC_CODE = "729841";

// Each scenario opens its own chat session, so they do not share
// state. Run them in parallel to cut wall time.
test.describe.configure({ mode: "parallel" });

test.describe("session (real LLM)", () => {
  test("L-11: 新規セッション → 1 ターン → reload → 履歴復元", async ({ page }) => {
    test.setTimeout(L11_TIMEOUT_MS);
    // Covers B-14: history persisted on reload. The prompt asks
    // for a one-word reply so the assistant never spins up TTS /
    // image generation; we only need a session to be created and
    // its URL to survive the reload.
    const userPrompt = "Reply with the single word: pong";
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      await waitForAssistantResponseComplete(page);
      const sessionIdBeforeReload = getCurrentSessionId(page);
      expect(sessionIdBeforeReload, "session URL should be /chat/<id> after the first turn").not.toBeNull();
      sessionIdForCleanup = sessionIdBeforeReload;

      await page.reload();

      // Two complementary signals — together they cover B-14:
      //  1. URL-level: the /chat/<id> route survived the reload.
      //  2. DOM-level: the user's own prompt is back in the
      //     transcript. The user-typed string is locale-agnostic
      //     (the app never localizes user input), so this catches
      //     "URL stayed but transcript failed to hydrate" without
      //     coupling to UI dictionaries (CLAUDE.md keeps eight in
      //     lockstep). See Codex review iter-1 / GHA review for
      //     why visible-text assertions on chrome-side strings
      //     stay out of this spec.
      expect(getCurrentSessionId(page), "session id must survive a reload").toBe(sessionIdBeforeReload);
      // The same prompt text shows up in both the sidebar history
      // preview and the main transcript bubble after rehydration —
      // either rendering is enough to prove the record came back, so
      // `.first()` keeps the locator out of strict-mode violation
      // territory while still catching the "URL kept but transcript
      // lost" failure mode Codex flagged.
      await expect(page.getByText(userPrompt).first(), "user prompt must rehydrate after reload — B-14 transcript canary").toBeVisible();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-12: 古いセッションを resume → LLM が前ターンの文脈を保持している", async ({ page }) => {
    test.setTimeout(L12_TIMEOUT_MS);
    // Covers B-16: a session that is reloaded mid-conversation must
    // hand the prior turn back to the agent so the next reply can
    // reference it. The bug shape was "URL kept the session id but
    // the agent saw an empty history on the next call", so the
    // simplest canary is: ask the LLM to remember a fact, reload,
    // ask it back, assert the answer references the fact.
    //
    // The first prompt is intentionally instruction-style (rather
    // than asking the LLM to repeat the code in the same turn) so
    // we are not testing turn-1 echoing — we are testing that
    // turn-2 (after reload) still has access to turn-1's content.
    const rememberPrompt = `Please remember this 6-digit code for later: ${L12_MAGIC_CODE}. Reply with the single word: ok.`;
    const recallPrompt = "What was the 6-digit code I just asked you to remember? Reply with only the number.";
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, rememberPrompt);
      await waitForAssistantResponseComplete(page);
      const sessionIdBeforeReload = getCurrentSessionId(page);
      expect(sessionIdBeforeReload, "session URL should be /chat/<id> after the first turn").not.toBeNull();
      sessionIdForCleanup = sessionIdBeforeReload;

      await page.reload();
      // Survival check first — if the URL flipped, B-16 is masked
      // behind B-14 (transcript hydration) and the recall failure
      // would point at the wrong root cause.
      expect(getCurrentSessionId(page), "session id must survive a reload before we can probe context").toBe(sessionIdBeforeReload);

      // Pin the baseline AFTER the turn-1 transcript has fully
      // hydrated. Without this wait `preRecallCodeCount` can land
      // on 0 (hydration in flight), and any late-arriving turn-1
      // user-prompt bubble would later push the count up even if
      // the agent's turn-2 reply contained nothing — which is
      // exactly the false-positive shape codex iter-2 flagged.
      // Waiting on the user prompt itself is locale-agnostic
      // (the app never localises user input) and proves the
      // transcript carries the code from turn-1 before we measure.
      await expect(page.getByText(rememberPrompt).first(), "turn-1 transcript must rehydrate before sampling the magic-code baseline").toBeVisible();
      // Count how many times the magic code appears BEFORE turn 2.
      // After hydration there is already at least one occurrence
      // (the user's own turn-1 prompt; the sidebar history preview
      // typically shows it too). Anchoring the post-recall
      // assertion to "the count went up" is what makes this an
      // actual B-16 canary: if the agent fails to recall, its
      // turn-2 reply won't contain the code and the count stays
      // flat, even though the page still has the code from turn 1.
      const preRecallCodeCount = await page.getByText(L12_MAGIC_CODE).count();

      await sendChatMessage(page, recallPrompt);
      await waitForAssistantResponseComplete(page);

      // The recall prompt itself doesn't contain the code, so the
      // only way for the count to increase is for the assistant to
      // have echoed it back from turn-1 context. `expect.toPass`
      // gives the transcript a moment to flush the streamed reply
      // into the DOM after `thinking-indicator` goes hidden.
      await expect(async () => {
        const postRecallCodeCount = await page.getByText(L12_MAGIC_CODE).count();
        expect(postRecallCodeCount, "the agent must echo the magic code from turn-1 — B-16 canary").toBeGreaterThan(preRecallCodeCount);
      }).toPass({ timeout: ONE_MINUTE_MS });
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });
});
