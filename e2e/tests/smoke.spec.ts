import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test("app loads and shows the title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("MulmoClaude")).toBeVisible();
});

test("send button and input are visible and enabled", async ({ page }) => {
  await page.goto("/");
  const input = page.locator("textarea");
  await expect(input).toBeVisible();
  const sendBtn = page.locator('button:has(span.material-icons:text("send"))');
  await expect(sendBtn).toBeEnabled();
});

test("unknown route still shows the app (catch-all redirect)", async ({
  page,
}) => {
  await page.goto("/some/random/path");
  await expect(page.getByText("MulmoClaude")).toBeVisible();
});
