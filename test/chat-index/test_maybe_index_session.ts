import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  maybeIndexSession,
  __resetForTests,
} from "../../server/chat-index/index.js";
import { indexEntryPathFor } from "../../server/chat-index/paths.js";
import { ClaudeCliNotFoundError } from "../../server/journal/archivist.js";
import type { SummaryResult } from "../../server/chat-index/types.js";

let workspace: string;

beforeEach(() => {
  __resetForTests();
  workspace = mkdtempSync(join(tmpdir(), "chat-index-maybe-"));
  mkdirSync(join(workspace, "chat"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function seedSession(id: string): void {
  const chatDir = join(workspace, "chat");
  writeFileSync(
    join(chatDir, `${id}.json`),
    JSON.stringify({
      roleId: "general",
      startedAt: "2026-04-12T10:00:00.000Z",
    }),
  );
  writeFileSync(
    join(chatDir, `${id}.jsonl`),
    JSON.stringify({ source: "user", type: "text", message: "hello" }) + "\n",
  );
}

function stubSummarize(
  result: SummaryResult = {
    title: "t",
    summary: "s",
    keywords: ["k"],
  },
): { fn: (input: string) => Promise<SummaryResult>; calls: number } {
  const state = { calls: 0 };
  return {
    fn: async () => {
      state.calls++;
      return result;
    },
    get calls() {
      return state.calls;
    },
  };
}

describe("maybeIndexSession — active session guard", () => {
  it("skips when the session is still being written (activeSessionIds)", async () => {
    seedSession("live-sess");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "live-sess",
      activeSessionIds: new Set(["live-sess", "other"]),
      workspaceRoot: workspace,
      deps: { summarize: stub.fn, now: () => 0 },
    });

    assert.equal(stub.calls, 0);
    await assert.rejects(() =>
      readFile(indexEntryPathFor(workspace, "live-sess"), "utf-8"),
    );
  });

  it("runs when the session is NOT in activeSessionIds", async () => {
    seedSession("done-sess");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "done-sess",
      activeSessionIds: new Set(["other"]),
      workspaceRoot: workspace,
      deps: { summarize: stub.fn, now: () => 0 },
    });

    assert.equal(stub.calls, 1);
    const raw = await readFile(
      indexEntryPathFor(workspace, "done-sess"),
      "utf-8",
    );
    assert.match(raw, /"title": "t"/);
  });
});

describe("maybeIndexSession — per-session lock", () => {
  it("double-fire for the same session is a no-op while the first is in flight", async () => {
    seedSession("slow-sess");
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSummarize = async (): Promise<SummaryResult> => {
      await gate;
      return { title: "t", summary: "s", keywords: [] };
    };

    const first = maybeIndexSession({
      sessionId: "slow-sess",
      workspaceRoot: workspace,
      deps: { summarize: slowSummarize, now: () => 0 },
    });
    // Call again while `first` is still blocked on the gate. This
    // second call should short-circuit via the in-process lock.
    const second = await maybeIndexSession({
      sessionId: "slow-sess",
      workspaceRoot: workspace,
      deps: {
        summarize: async () => {
          throw new Error("second call should not run summarize");
        },
        now: () => 0,
      },
    });
    assert.equal(second, undefined);

    // Let the first finish and await it to avoid leaking the
    // promise into the next test.
    release?.();
    await first;
  });

  it("different sessions can run concurrently", async () => {
    seedSession("sess-1");
    seedSession("sess-2");
    const stub = stubSummarize();

    await Promise.all([
      maybeIndexSession({
        sessionId: "sess-1",
        workspaceRoot: workspace,
        deps: { summarize: stub.fn, now: () => 0 },
      }),
      maybeIndexSession({
        sessionId: "sess-2",
        workspaceRoot: workspace,
        deps: { summarize: stub.fn, now: () => 0 },
      }),
    ]);

    assert.equal(stub.calls, 2);
  });
});

describe("maybeIndexSession — claude CLI missing sentinel", () => {
  it("disables the module after ClaudeCliNotFoundError is thrown", async () => {
    seedSession("sess-miss-1");
    seedSession("sess-miss-2");
    const throwing = async (): Promise<SummaryResult> => {
      throw new ClaudeCliNotFoundError();
    };

    // First call hits the sentinel and flips `disabled`.
    await maybeIndexSession({
      sessionId: "sess-miss-1",
      workspaceRoot: workspace,
      deps: { summarize: throwing, now: () => 0 },
    });

    // Second call should be a no-op: even though we hand it a
    // working summarizer, the disabled flag short-circuits the
    // whole module.
    const workingStub = stubSummarize();
    await maybeIndexSession({
      sessionId: "sess-miss-2",
      workspaceRoot: workspace,
      deps: { summarize: workingStub.fn, now: () => 0 },
    });
    assert.equal(workingStub.calls, 0);
  });
});

describe("maybeIndexSession — unexpected error swallowing", () => {
  it("does not throw when summarize throws an unrelated error", async () => {
    seedSession("sess-err");
    const failing = async (): Promise<SummaryResult> => {
      throw new Error("boom");
    };

    // This must resolve, not reject — the agent finally block
    // relies on it.
    await maybeIndexSession({
      sessionId: "sess-err",
      workspaceRoot: workspace,
      deps: { summarize: failing, now: () => 0 },
    });
  });

  it("does not disable the module on unrelated errors", async () => {
    seedSession("sess-err-1");
    seedSession("sess-err-2");
    const failing = async (): Promise<SummaryResult> => {
      throw new Error("transient network blip");
    };
    await maybeIndexSession({
      sessionId: "sess-err-1",
      workspaceRoot: workspace,
      deps: { summarize: failing, now: () => 0 },
    });

    // Subsequent call with a working summarizer should still run.
    const stub = stubSummarize();
    await maybeIndexSession({
      sessionId: "sess-err-2",
      workspaceRoot: workspace,
      deps: { summarize: stub.fn, now: () => 0 },
    });
    assert.equal(stub.calls, 1);
  });
});
