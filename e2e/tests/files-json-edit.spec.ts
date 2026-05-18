// #833 Phase 1 — inline JSON editor in the Files Explorer.
//
// Pins the observable contract:
//   - policy-editable JSON (config/settings.json → user-editable)
//     shows an Edit button; edit → Save round-trips through
//     PUT /api/files/content
//   - a server 400 (invalid JSON) surfaces in the inline error banner
//     and the editor stays open
//   - agent-managed JSON (config/scheduler/tasks.json) shows NO Edit
//     button (gated by editPolicy in systemFileDescriptors)

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { API_ROUTES } from "../../src/config/apiRoutes";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const EDITABLE = "config/settings.json";
const AGENT_MANAGED = "config/scheduler/tasks.json";
const EDITABLE_BODY = '{\n  "theme": "dark"\n}';
const AGENT_BODY = '{\n  "tasks": []\n}';

async function mockJsonFiles(page: Page) {
  await page.route(
    (url) => url.pathname === API_ROUTES.files.dir,
    (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      if (path === "") {
        return route.fulfill({
          json: { name: "", path: "", type: "dir", children: [{ name: "config", path: "config", type: "dir" }] },
        });
      }
      if (path === "config") {
        return route.fulfill({
          json: {
            name: "config",
            path: "config",
            type: "dir",
            children: [
              { name: "settings.json", path: EDITABLE, type: "file", size: EDITABLE_BODY.length },
              { name: "scheduler", path: "config/scheduler", type: "dir" },
            ],
          },
        });
      }
      if (path === "config/scheduler") {
        return route.fulfill({
          json: {
            name: "scheduler",
            path: "config/scheduler",
            type: "dir",
            children: [{ name: "tasks.json", path: AGENT_MANAGED, type: "file", size: AGENT_BODY.length }],
          },
        });
      }
      return route.fulfill({ json: { name: path, path, type: "dir", children: [] } });
    },
  );

  await page.route(
    (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === EDITABLE,
    (route) => route.fulfill({ json: { kind: "text", path: EDITABLE, content: EDITABLE_BODY, size: EDITABLE_BODY.length, modifiedMs: Date.now() } }),
  );
  await page.route(
    (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === AGENT_MANAGED,
    (route) => route.fulfill({ json: { kind: "text", path: AGENT_MANAGED, content: AGENT_BODY, size: AGENT_BODY.length, modifiedMs: Date.now() } }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockJsonFiles(page);
});

test.describe("Files Explorer — JSON inline editor (#833)", () => {
  test("editable JSON: edit → save round-trips through PUT, server-validated", async ({ page }) => {
    const puts: { path: string; content: string }[] = [];
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content,
      async (route, req) => {
        if (req.method() === "PUT") {
          const body = req.postDataJSON() as { path: string; content: string };
          // Mirror the server: invalid JSON → 400.
          try {
            JSON.parse(body.content);
          } catch (err) {
            await route.fulfill({ status: 400, json: { error: `Invalid JSON: ${(err as Error).message}` } });
            return;
          }
          puts.push(body);
          await route.fulfill({ json: { path: body.path, size: body.content.length, modifiedMs: Date.now() } });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto(`/files/${EDITABLE}`);

    const editBtn = page.getByTestId("files-json-edit-btn");
    await expect(editBtn).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await editBtn.click();

    const editor = page.getByTestId("files-json-editor");
    await expect(editor).toHaveValue(EDITABLE_BODY);
    await editor.fill('{\n  "theme": "light"\n}');
    await page.getByTestId("files-json-save-btn").click();

    await expect(() => {
      expect(puts).toHaveLength(1);
      expect(puts[0].path).toBe(EDITABLE);
      expect(puts[0].content).toBe('{\n  "theme": "light"\n}');
    }).toPass({ timeout: 5 * ONE_SECOND_MS });

    // Successful save exits edit mode (read-only pre returns).
    await expect(page.getByTestId("files-json-editor")).toBeHidden();
    await expect(page.getByTestId("files-json-edit-btn")).toBeVisible();
  });

  test("invalid JSON: server 400 surfaces in the inline error banner, editor stays open", async ({ page }) => {
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content,
      async (route, req) => {
        if (req.method() === "PUT") {
          await route.fulfill({ status: 400, json: { error: "Invalid JSON: Unexpected end of JSON input" } });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto(`/files/${EDITABLE}`);
    await page.getByTestId("files-json-edit-btn").click();
    const editor = page.getByTestId("files-json-editor");
    await editor.fill("{ broken");
    await page.getByTestId("files-json-save-btn").click();

    const banner = page.getByTestId("files-json-save-error");
    await expect(banner).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(banner).toContainText("Invalid JSON");
    // Still in edit mode so the user can fix the value.
    await expect(editor).toBeVisible();
  });

  test("agent-managed JSON shows no Edit button", async ({ page }) => {
    await page.goto(`/files/${AGENT_MANAGED}`);
    // Wait for the JSON pretty-print to render, then assert the Edit
    // button is absent (editPolicy = agent-managed).
    await expect(page.getByText('"tasks"')).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.getByTestId("files-json-edit-btn")).toHaveCount(0);
  });
});
