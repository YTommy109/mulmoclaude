// E2E for the collection Contribute button (#1827): clicking it on an Installed
// card launches a single new chat seeded with the contribute prompt (the agent
// then exports the collection + opens a registry PR) WITHOUT navigating to the
// collection's detail view. Guards the @click.stop and the single-invocation
// regression (a native button must not also bind @keydown, which would double-fire).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const COLLECTIONS_LIST = {
  collections: [{ slug: "reading-list", title: "Reading List", icon: "bookmark", source: "user" }],
};

async function mockCollections(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections",
    (route) => route.fulfill({ json: COLLECTIONS_LIST }),
  );
}

// Capture every agent run (the chat-send sink) so we can assert how many chats
// a single activation launches and what prompt they carry. Registered AFTER
// mockAllApis so it wins Playwright's reverse-order route matching.
async function captureAgentRuns(page: Page): Promise<string[]> {
  const messages: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/agent",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      messages.push(route.request().postData() ?? "");
      return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
    },
  );
  return messages;
}

test.describe("collection Contribute button", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollections(page);
  });

  test("click → confirm launches one contribute chat and does not open the collection", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await expect(page.getByTestId("collections-index-card-reading-list")).toBeVisible();
    await page.getByTestId("collections-contribute-reading-list").click();

    // A confirm dialog gates the share — no chat (agent run) starts until accepted.
    await expect(page.getByTestId("host-confirm-modal")).toBeVisible();
    expect(agentRuns).toHaveLength(0);
    await page.getByTestId("host-confirm-ok").click();

    await expect.poll(() => agentRuns.length, { timeout: 2000 }).toBe(1);
    // A double-fire would arrive right after the first; give it a beat, then
    // confirm there was only one launch.
    await page.waitForTimeout(250);
    expect(agentRuns).toHaveLength(1);
    expect(agentRuns[0]).toContain("reading-list");
    expect(agentRuns[0]).toContain("registry");

    // @click.stop must keep the card from navigating to the collection detail.
    await expect(page).not.toHaveURL(/\/collections\/reading-list/);
  });

  test("cancelling the confirm dialog launches no chat", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    await expect(page.getByTestId("collections-index-card-reading-list")).toBeVisible();
    await page.getByTestId("collections-contribute-reading-list").click();

    await expect(page.getByTestId("host-confirm-modal")).toBeVisible();
    await page.getByTestId("host-confirm-cancel").click();

    await page.waitForTimeout(300);
    expect(agentRuns).toHaveLength(0);
    await expect(page).not.toHaveURL(/\/collections\/reading-list/);
  });

  test("keyboard activation (Enter) → confirm launches exactly one chat", async ({ page }) => {
    const agentRuns = await captureAgentRuns(page);
    await page.goto("/collections");

    const button = page.getByTestId("collections-contribute-reading-list");
    await button.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("host-confirm-modal")).toBeVisible();
    await page.getByTestId("host-confirm-ok").click();

    await expect.poll(() => agentRuns.length, { timeout: 2000 }).toBe(1);
    await page.waitForTimeout(250);
    expect(agentRuns).toHaveLength(1);
    expect(agentRuns[0]).toContain("reading-list");
    await expect(page).not.toHaveURL(/\/collections\/reading-list/);
  });
});
