import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeProjectSkill,
  removeProjectSkill,
  selectRole,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const L21_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L22_TIMEOUT_MS = ONE_MINUTE_MS;
const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

// L-21 talks to the live LLM; L-22 only hits the local /skills
// route (no agent turn). They share no state — run in parallel
// to cut wall time, mirroring the other category specs.
test.describe.configure({ mode: "parallel" });

test.describe("skills (real LLM / static)", () => {
  test("L-21: Office role + presentChart で deferred-tool dispatch が成功し chart-canvas が描画される", async ({ page }) => {
    test.setTimeout(L21_TIMEOUT_MS);
    // Covers B-41: Claude CLI auto-flips into deferred-tools mode
    // when the registered tool count crosses its threshold (~18+),
    // and a regression in that path historically broke first-turn
    // tool dispatch across every role. L-03 already exercises this
    // through presentMulmoScript on the General role; L-21 is a
    // second canary on a different role/tool combination so a
    // regression that shears just one branch (e.g. `presentChart`
    // schema mis-published in deferred mode) is caught even when
    // the L-03 path keeps working. The chart plugin renders
    // quickly, has no external API dependency, and exposes a
    // stable `chart-card-0` / `chart-canvas-0` testid
    // (`src/plugins/chart/View.vue`).
    //
    // Why Office: General's `availablePlugins` (`src/config/roles.ts`)
    // does NOT include `presentChart` — Office, Tutor, Spreadsheet,
    // and Accounting do. The first iteration on this spec hit
    // exactly that: the LLM replied "I can't find a presentChart
    // tool" because the role gate hid it. Switching to Office
    // here keeps the canary on a role/tool pair where dispatch is
    // genuinely available.
    //
    // Prompt names the exact tool and forbids the alternatives so
    // the LLM does not wander to presentHtml or textResponse.
    const userPrompt = [
      "Use the `presentChart` tool to render a bar chart titled 'L-21 sales' with data Jan 100, Feb 150, Mar 120.",
      "Do not use presentHtml. Do not use any other tool. Do not narrate the result in text.",
    ].join(" ");
    const sessionsToCleanup: string[] = [];
    try {
      // selectRole spawns a fresh /chat/<id> in the new role on
      // chat pages (App.vue's onRoleChange). Mirroring the
      // roles.spec.ts cleanup pattern: capture both the auto-
      // created General session id and the role-switched Office
      // session id so neither leaks into history.
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "office");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const officeSessionId = getCurrentSessionId(page);
      if (officeSessionId !== null && officeSessionId !== generalSessionId) {
        sessionsToCleanup.push(officeSessionId);
      }
      await expect(page.getByTestId("role-selector-btn"), "role chip must reflect office after switch").toHaveAttribute("data-role", "office");
      await sendChatMessage(page, userPrompt);
      // The chart tool result mounts ChartView, which renders one
      // `[data-testid="chart-card-${idx}"]` per chart spec. The
      // first card is enough — extra cards (rare LLM-authored
      // multi-chart payloads) do not invalidate the dispatch
      // signal. `chart-canvas-0` going visible proves both the
      // tool round-trip and the v-for hydration; an upstream
      // failure in deferred-tools mode would land us in a
      // textResponse view instead, with no chart-* testid in DOM.
      await expect(page.getByTestId("chart-card-0"), "chart card must mount after the tool call (B-41 canary)").toBeVisible({ timeout: 2 * ONE_MINUTE_MS });
      await expect(page.getByTestId("chart-canvas-0"), "chart canvas must hydrate (deferred-tool dispatch reached the view)").toBeVisible();

      await waitForAssistantResponseComplete(page);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
    }
  });

  test("L-22: /skills で seed したプロジェクト skill が一覧 + 詳細描画される (B-08 dangling 検出)", async ({ page }, testInfo) => {
    test.setTimeout(L22_TIMEOUT_MS);
    // Covers B-08: when `~/.claude/skills` (or the workspace's
    // `.claude/skills/`) is managed via symlinks, sandbox / path
    // resolution bugs used to leave the links dangling and the
    // skills list empty (or the detail body unreadable). The
    // non-Docker canary here asserts the positive shape:
    //   * /skills is reachable and the API populated the list
    //   * a freshly seeded project skill row renders (testid present)
    //   * clicking it loads the detail body (skill-body-rendered
    //     appears with the seeded markdown — the very read that
    //     fails when the underlying SKILL.md target is missing)
    //
    // Seeding our own project skill avoids depending on whatever
    // skills the developer happens to have on disk. The mulmoclaude
    // skill discovery does fresh readdir+stat (no cache), so the
    // newly-written SKILL.md is visible to the very next `GET
    // /api/skills` without a dev restart.
    //
    // Run button is intentionally NOT clicked. The dangling failure
    // mode trips at detail-load (before /run is reachable), and
    // running a synthetic skill spawns a real agent turn — adds
    // flake + tokens without strengthening the B-08 signal.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    // Slug must satisfy isValidSlug (lowercase / digit / hyphen).
    // randomUUID() is hex+hyphen, so the slice survives the rule.
    const skillSlug = `e2e-live-l22-${projectSlug}-${nonce}`;
    const description = `L-22 canary skill ${nonce}`;
    const bodyMarker = `L-22 body marker ${nonce}`;
    const body = ["## L-22 canary", "", bodyMarker, "", "Synthetic skill seeded by e2e-live spec; remove via cleanup."].join("\n");
    try {
      await placeProjectSkill(skillSlug, description, body);
      await page.goto("/skills");

      // List populated — the row is keyed by the seeded slug.
      // If the workspace's `.claude/skills/` were unreadable
      // (dangling symlink, permission error), the seeded file would
      // not surface and the row would never appear.
      const skillRow = page.getByTestId(`skill-item-${skillSlug}`);
      await expect(skillRow, "seeded project skill must appear in /skills list (B-08 canary)").toBeVisible({ timeout: ONE_MINUTE_MS });

      // Click → detail fetch → body renders. The detail endpoint
      // reads the SKILL.md body on demand; a dangling link returns
      // an error and skill-body-rendered never mounts.
      await skillRow.click();
      const bodyView = page.getByTestId("skill-body-rendered");
      await expect(bodyView, "detail body must hydrate (proves SKILL.md is readable, not dangling)").toBeVisible({ timeout: ONE_MINUTE_MS });
      // Strong content check: the rendered markdown must contain
      // the seeded marker we just wrote. Ensures the detail load
      // returned the seeded file, not a stale row from somewhere
      // else, and rules out the softer regression shape (file
      // exists but body load failed → empty render).
      await expect(bodyView, "rendered body must echo the seeded marker").toContainText(bodyMarker);
    } finally {
      await removeProjectSkill(skillSlug);
    }
  });
});
