import path from "node:path";

import { expect, test } from "@playwright/test";

import { TOOL_NAME as PRESENT_MULMO_SCRIPT_TOOL } from "../../src/plugins/presentMulmoScript/definition.ts";
import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeFixtureInWorkspace,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const LEDIT_TIMEOUT_MS = 3 * ONE_MINUTE_MS;

test.describe.configure({ mode: "parallel" });

test.describe("mulmoScript edit (real workspace)", () => {
  // Regression net for #1074. The fix has two halves:
  //   1. View re-reads the script from disk on mount via
  //      `refreshScriptFromDisk`, so a session-restore after page
  //      reload (or `page.goto` round-trip) picks up edits made via
  //      `update-beat` / `update-script` instead of the stale
  //      toolResult cached in the JSONL.
  //   2. The wait condition after clicking the per-beat update
  //      button watches the textarea closing — successful saves
  //      flip `sourceOpen[index] = false` which removes the entire
  //      editor block via `v-if`. Earlier versions waited for the
  //      button to re-enable, but the button is gone from the DOM
  //      by then so `toBeEnabled` always timed out at 30s.
  test("L-EDIT: beat 編集 → 更新 → 別セッションへ移動 → 戻ると編集が永続化されている", async ({ page }, testInfo) => {
    test.setTimeout(LEDIT_TIMEOUT_MS);
    // Covers issue #1074 — beat edits made via the source-editor
    // textarea were reported to disappear after navigating away and
    // back. We seed the L-03 textSlide fixture under a distinct
    // path so it doesn't collide with media.spec's L-03 run, then
    // round-trip an edit through the update button + navigation.
    const slug = testInfo.project.name;
    const fixtureBasename = `e2e-live-edit-${slug}.json`;
    const workspaceScriptRel = path.posix.join("artifacts/stories", fixtureBasename);
    const wireFilePath = path.posix.join("stories", fixtureBasename);
    await placeFixtureInWorkspace("mulmo/l03-two-beat.json", workspaceScriptRel);
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      const message = [
        `\`${PRESENT_MULMO_SCRIPT_TOOL}\` ツールに \`filePath: "${wireFilePath}"\` を渡して、 既存スクリプトをそのまま表示してください。`,
        "",
        "- ツールには filePath だけを渡し、 script は省略してください",
        "- 動画生成 (Generate Movie / generateMovie ツール) は呼ばないでください",
      ].join("\n");
      await sendChatMessage(page, message);
      await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });
      await waitForAssistantResponseComplete(page);

      const sessionId = getCurrentSessionId(page);
      if (sessionId === null) throw new Error("session id should not be null after presentMulmoScript turn");
      sessionIdForCleanup = sessionId;

      await editBeat0Text(page, "L-EDIT marker via e2e-live");

      // Navigate to /wiki and back. This still triggers the SPA
      // route change + state reload that #1074 reported (the
      // disappearing edit was tied to leaving and re-entering the
      // chat surface), but it does NOT mint a second chat session
      // the way startNewSession() would. Without this swap the
      // cleanup branch would only delete the original session and
      // leak the second one into the user's history every time.
      await page.goto("/wiki");
      await page.waitForURL(/\/wiki/);
      await page.goto(`/chat/${sessionId}`);
      await page.waitForURL(new RegExp(`/chat/${sessionId}$`));
      await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });

      await assertBeat0EditPersisted(page, "L-EDIT marker via e2e-live");
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
      await removeFromWorkspace(workspaceScriptRel);
    }
  });
});

/**
 * Open beat 0's JSON source editor, replace the empty `text` value
 * with the given marker, and click the per-beat update button. Each
 * step is gated on the appropriate testid so the test fails fast on
 * the offending stage instead of bubbling a generic timeout.
 */
async function editBeat0Text(page: import("@playwright/test").Page, marker: string): Promise<void> {
  await page.getByTestId("mulmo-script-beat-source-toggle-0").click();
  const textarea = page.getByTestId("mulmo-script-beat-source-textarea-0");
  await expect(textarea).toBeVisible();
  const originalJson = await textarea.inputValue();
  if (!originalJson.includes('"text": ""')) {
    throw new Error(`fixture beat 0 should have empty text, got: ${originalJson.slice(0, 120)}`);
  }
  await textarea.fill(originalJson.replace('"text": ""', `"text": "${marker}"`));
  await page.getByTestId("mulmo-script-beat-update-button-0").click();
  // On a successful save the View flips `sourceOpen[index] = false`,
  // which unmounts the entire editor block (button + textarea) via
  // `v-if`. Wait for the textarea to detach instead of the button
  // re-enabling — the button isn't in the DOM after a successful
  // save, so `toBeEnabled` would retry against a missing locator
  // until the global timeout. 30s leaves headroom for disk I/O
  // coinciding with another beat's render.
  await expect(textarea).toBeHidden({ timeout: 30_000 });
}

async function assertBeat0EditPersisted(page: import("@playwright/test").Page, marker: string): Promise<void> {
  await page.getByTestId("mulmo-script-beat-source-toggle-0").click();
  const textarea = page.getByTestId("mulmo-script-beat-source-textarea-0");
  await expect(textarea).toBeVisible();
  const reopenedJson = await textarea.inputValue();
  expect(reopenedJson, "beat 0 edit must persist across session navigation (#1074)").toContain(marker);
}
