// Hard-constraint regression for the accounting plugin: in the
// default (General) Role environment, the plugin must be invisible.
// No launcher button, no /accounting route. Reaching the plugin
// requires actively switching into the built-in Accounting role
// (or a custom role) whose `availablePlugins` include
// `manageAccounting`.

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

  test("/roles surfaces no manageAccounting plugin on a fresh workspace", async ({ page }) => {
    // The /api/roles mock returns the default role list (empty in
    // mockAllApis, which forces the app's built-in defaults). On a
    // fresh workspace /roles only renders the (empty) custom-roles
    // list — built-in roles are not displayed there, so no plugin
    // names should appear regardless of which built-ins ship.
    //
    // The built-in Accounting role *does* list manageAccounting in
    // its definition (that role is the curated entry point for the
    // plugin), but it isn't shown on /roles, so the page-wide
    // text-count assertion still holds. If a future RolesView
    // change starts surfacing built-in role plugin lists, this
    // test will fail and force a deliberate decision about whether
    // surfacing manageAccounting there is intended.
    await page.goto("/roles");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("manageAccounting")).toHaveCount(0);
  });
});
