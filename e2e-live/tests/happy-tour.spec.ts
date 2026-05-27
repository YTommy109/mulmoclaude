// L-HAPPY-TOUR: capability-axis sweep of the major Views / endpoints.
//
// This spec is intentionally shallow. Per-feature regressions belong
// in their own L-XX specs (`/wiki` linking → wiki-nav.spec.ts, todo
// schema → unit tests, etc.); happy-tour exists to catch the class of
// regression where an *individual feature* works in its own spec but
// the *whole app* is broken in production. The canonical incident is
// 2026-05-25, where `@mulmoclaude/todo-plugin` was dropped from the
// published `mulmoclaude` tarball — every per-feature spec passed
// against the dev checkout, but `npx mulmoclaude@latest` failed to
// load `/todos`.
//
// Each step is wrapped in `test.step()` so a happy-tour failure
// reports the broken station directly (Playwright surfaces the step
// title in the trace tree). Assertions are extracted into
// `e2e-live/lib/health-checks.ts` as pure functions so a future
// doctor CLI / pre-release smoke harness can reuse them without
// importing Playwright.
//
// Plan: search for "L-HAPPY-TOUR" in `plans/feat-e2e-live.md`.

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { API_ROUTES } from "../../src/config/apiRoutes.ts";
import {
  SESSION_URL_PATTERN,
  deleteSession,
  fetchAuthedJsonViaPage,
  getCurrentSessionId,
  listNotifierEntries,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";
import { assertHealthBody, assertNoPluginDiagnostics, assertRuntimePluginsRegistered } from "../lib/health-checks.ts";

// 3-minute wall-time budget per the plan ("実行時間目標: 3 分以内");
// the LLM-bearing step (step 5) reuses the same 2-minute window the
// per-role L-06..L-09 specs settle on. All other steps are
// sub-second navigations / authed JSON fetches.
const HAPPY_TOUR_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SINGLE_TURN_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const VIEW_MOUNT_TIMEOUT_MS = 30 * ONE_SECOND_MS;

const NO_LLM = process.env.E2E_LIVE_NO_LLM === "1";

// Single-word echo prompt borrowed from L-06: deterministic, no tool
// dispatch, no MCP fan-out. The happy-tour LLM check only has to
// prove the chat round-trip survives boot — not exercise reasoning.
const SINGLE_WORD_PROMPT = "Reply with the single word: hellotour";

test.describe.configure({ mode: "serial" });

test.describe("happy-tour (capability sweep)", () => {
  test("L-HAPPY-TOUR: 主要 View / endpoint を 1 spec で薄く広く touch", async ({ page }) => {
    test.setTimeout(HAPPY_TOUR_TIMEOUT_MS);

    // Land on `/` once up front so subsequent `fetchAuthedJsonViaPage`
    // calls have the `<meta name="mulmoclaude-auth">` token to read.
    // Asserting the sidebar testid here doubles as Step 4 (`/` mounts
    // with chrome visible) — splitting it into its own `test.step`
    // would be process theatre, the navigation IS the check.
    await test.step("4. / が mount し sidebar が見える", async () => {
      await page.goto("/");
      await expect(page.getByTestId("chat-sidebar"), "sidebar must render — chrome is the canary that the SPA mounted at all").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
    });

    await test.step("1. /api/health が 200 + 期待ボディを返す", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.health);
      expect(probe.ok, probe.ok ? "" : `health probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      const result = assertHealthBody(probe.body);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    await test.step("2. /api/plugins/runtime/list が preset を全件含む", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.plugins.runtimeList);
      expect(probe.ok, probe.ok ? "" : `runtime list probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      // `requireDevOnly: true` because the dev checkout (`yarn dev`)
      // has all four presets resolvable via yarn-workspace symlinks.
      // A published-tarball doctor harness will flip this to false.
      const result = assertRuntimePluginsRegistered(probe.body, true);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    await test.step("3. /api/plugins/diagnostics が collision 無し", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.plugins.diagnostics);
      expect(probe.ok, probe.ok ? "" : `diagnostics probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      const result = assertNoPluginDiagnostics(probe.body);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    // Step 5 is the only LLM-bearing step. The CI no-LLM matrix
    // entry uses `MULMOCLAUDE_FAKE_AGENT=1` which returns a stub
    // response, so the marker echo wouldn't hold; skip there and
    // let real-LLM runs cover it.
    await test.step("5. /chat で 1 ターン送信 → assistant 応答が返る", async () => {
      test.skip(NO_LLM, "E2E_LIVE_NO_LLM=1: fake-echo backend does not echo the prompt deterministically enough for this assertion shape");
      await runSingleTurnSmoke(page);
    });

    await test.step("6. /todos が mount + 読み込みエラー無し", async () => {
      await page.goto("/todos");
      await expect(page.getByTestId("todo-view-root"), "todo view root must render — 2026-05-25 preset-drop regression net").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
      await expect(page.getByTestId("todo-api-error"), "todo-api-error banner must NOT appear on a fresh /todos visit").toHaveCount(0);
    });

    await test.step("7. /calendar が mount", async () => {
      await page.goto("/calendar");
      await expect(page.getByTestId("scheduler-view-root"), "scheduler view root must render under /calendar").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
      await expect(page.getByTestId("scheduler-api-error"), "scheduler-api-error banner must NOT appear on a fresh /calendar visit").toHaveCount(0);
    });

    await test.step("8. /wiki が mount", async () => {
      await page.goto("/wiki");
      // The wiki index is gated on data/wiki/index.md being readable;
      // `wiki-lint-chat-button` lives in the always-rendered header
      // and is the cheapest "view mounted" sentinel here.
      await expect(page.getByTestId("wiki-lint-chat-button"), "wiki header must render under /wiki").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("9. /files が mount", async () => {
      await page.goto("/files");
      await expect(page.getByTestId("files-view-root"), "files view root must render under /files").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("10. /skills が mount + catalog セクション visible", async () => {
      await page.goto("/skills");
      // `skill-section-catalog` is the always-rendered catalog
      // accordion header. We do NOT assert any specific preset row
      // exists — L-33 / L-33B already cover that — happy-tour just
      // proves the route mounts at all.
      await expect(page.getByTestId("skill-section-catalog"), "skills view catalog section must render under /skills").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
    });

    await test.step("11. /sources が mount", async () => {
      await page.goto("/sources");
      await expect(page.getByTestId("sources-view-root"), "sources view root must render under /sources").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("12. NotificationBell に startup-time の警告 entry が無い", async () => {
      // `/api/plugins/diagnostics` is the structured source for boot
      // collisions (step 3 already asserted empty). This step looks
      // at the live notifier ledger to catch the *secondary* class
      // of startup warnings — anything a preset / host module
      // published via `publishNotification(...)` during boot. We
      // filter by severity to ignore informational fyi entries the
      // user may have accumulated in their workspace already.
      const entries = await listNotifierEntries(page);
      const startupWarnings = entries.filter((entry) => entry.severity === "urgent");
      expect(startupWarnings, `unexpected urgent notifier entries (startup-time warnings): ${JSON.stringify(startupWarnings)}`).toHaveLength(0);
    });
  });
});

/**
 * The chat-turn leg of step 5. Kept under 20 lines so the spec's
 * top-level reads as a top-down checklist; the cleanup `try/finally`
 * has its own scope so the session id capture is impossible to leak
 * even if the assertion throws mid-turn.
 */
async function runSingleTurnSmoke(page: Page): Promise<void> {
  let sessionIdForCleanup: string | null = null;
  try {
    await startNewSession(page);
    await sendChatMessage(page, SINGLE_WORD_PROMPT);
    await expect(
      page.getByTestId("text-response-assistant-body").last(),
      "assistant body must echo the marker — proves the boot → agent → response loop is alive",
    ).toContainText("hellotour", { timeout: SINGLE_TURN_TIMEOUT_MS });
    await waitForAssistantResponseComplete(page);
    await page.waitForURL(SESSION_URL_PATTERN, { timeout: ONE_MINUTE_MS });
    sessionIdForCleanup = getCurrentSessionId(page);
  } finally {
    if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
  }
}
