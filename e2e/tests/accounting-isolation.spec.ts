// Hard-constraint regression for the accounting plugin: in the
// default Role environment, the plugin must be invisible. No launcher
// button, no /accounting route. The plugin is opt-in only via custom
// Roles whose `availablePlugins` include `manageAccounting`.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("accounting plugin — isolation regression", () => {
  test("PluginLauncher does not render an accounting button", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The launcher buttons use plugin-launcher-{key} testids; the
    // accounting plugin is NOT supposed to register one.
    await expect(page.getByTestId("plugin-launcher-accounting")).toHaveCount(0);
  });

  test("/accounting URL does not match a route — falls through to /chat", async ({ page }) => {
    await page.goto("/accounting");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    const { pathname } = new URL(page.url());
    // Bounded segment, no nested-quantifier overlap — same rationale as router-guards.spec.ts.
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded `[\w-]+`, single optional group
    expect(pathname).toMatch(/^\/chat(?:\/[\w-]+)?$/);
  });

  test("default Role config does not list manageAccounting in available tools", async ({ page }) => {
    // The /api/roles mock returns the default role list (empty in
    // mockAllApis, which forces the app's built-in defaults). Visit
    // the roles page and assert manageAccounting is not present in
    // any built-in role's plugin selection.
    await page.goto("/roles");
    await page.waitForLoadState("networkidle");
    // Roles UI may render plugins in different surfaces; the
    // strongest invariant is "the literal string is absent from the
    // built-in roles view." Custom-role injection is a separate
    // test surface (and not part of this PR).
    await expect(page.getByText("manageAccounting")).toHaveCount(0);
  });
});
