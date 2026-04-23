// E2E for the session-tab row (SessionTabBar.vue): verifies that
// each existing session now shows a visible label under the role
// icon so users can tell sessions apart at a glance, and that
// supplemental indicators (unread dot, origin glyph) render on
// the tabs that carry those flags.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

test.describe("session tab bar — visible per-tab info", () => {
  test("shows a short label under the role icon on each tab", async ({ page }) => {
    await mockAllApis(page, { sessions: [SESSION_A, SESSION_B] });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Label is derived from the preview (first 10 chars). SESSION_A's
    // preview is "Hello from session A" → "Hello from".
    await expect(tabA).toContainText("Hello from");
    await expect(tabB).toContainText("Hello from");

    // Tab tooltip keeps the full preview for users who want more.
    await expect(tabA).toHaveAttribute("title", SESSION_A.preview ?? "");
    await expect(tabB).toHaveAttribute("title", SESSION_B.preview ?? "");
  });

  test("shows an unread dot on inactive tabs that have unread replies", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, hasUnread: true },
        { ...SESSION_B, hasUnread: false },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Dot is an aria-labeled span inside the tab.
    await expect(tabA.getByLabel("New reply")).toBeVisible();
    await expect(tabB.getByLabel("New reply")).toBeHidden();
  });

  test("shows an origin glyph for non-human-started sessions", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, origin: "scheduler" },
        { ...SESSION_B, origin: "bridge" },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    await expect(tabA.getByLabel("Started by scheduler")).toBeVisible();
    await expect(tabB.getByLabel("Started by bridge")).toBeVisible();
  });
});
