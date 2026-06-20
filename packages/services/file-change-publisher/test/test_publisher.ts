import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configureFileChangePublisher, resetFileChangePublisher, publishFileChange, pluginFileChannel } from "../src/index.ts";

afterEach(() => resetFileChangePublisher());

function withWorkspace(): { ws: string; rel: string } {
  const ws = mkdtempSync(path.join(tmpdir(), "fcp-"));
  const rel = "artifacts/html/page.html";
  const abs = path.join(ws, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "<html></html>");
  return { ws, rel };
}

test("publishes the primary channel + every matching plugin scope (and skips non-matches)", async () => {
  const { ws, rel } = withWorkspace();
  const events: Array<{ channel: string; path: string; mtimeMs: number }> = [];
  configureFileChangePublisher({
    publish: (channel, payload) => events.push({ channel, ...payload }),
    workspaceRoot: ws,
    toPosix: (p) => p.split(path.sep).join("/"),
    primaryChannel: (posix) => `file:${posix}`,
    pluginScopes: [
      { scope: "html", matches: (p) => p.endsWith(".html") },
      { scope: "markdown", matches: (p) => p.endsWith(".md") }, // shouldn't match
    ],
  });
  try {
    await publishFileChange(rel);
    const channels = events.map((e) => e.channel);
    assert.deepEqual(channels.sort(), [`file:${rel}`, pluginFileChannel("html", rel)].sort());
    assert.ok(events.every((e) => e.path === rel && typeof e.mtimeMs === "number" && e.mtimeMs > 0));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runs onPublished after publishing", async () => {
  const { ws, rel } = withWorkspace();
  let seen: string | null = null;
  configureFileChangePublisher({
    publish: () => {},
    workspaceRoot: ws,
    toPosix: (p) => p,
    onPublished: (posix) => {
      seen = posix;
    },
  });
  try {
    await publishFileChange(rel);
    assert.equal(seen, rel);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("no-op until configured; falls back to Date.now() when stat fails", async () => {
  await publishFileChange("anything"); // unconfigured → no throw, no-op
  const ws = mkdtempSync(path.join(tmpdir(), "fcp-"));
  const events: Array<{ mtimeMs: number }> = [];
  configureFileChangePublisher({
    publish: (_c, payload) => events.push(payload),
    workspaceRoot: ws,
    toPosix: (p) => p,
    primaryChannel: (p) => `file:${p}`,
  });
  try {
    await publishFileChange("missing-file.txt"); // stat fails → Date.now() fallback, still publishes
    assert.equal(events.length, 1);
    assert.ok(events[0].mtimeMs > 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
