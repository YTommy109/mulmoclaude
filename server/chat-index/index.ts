// Public entry point for the chat index. The agent route calls
// `maybeIndexSession({ sessionId, activeSessionIds })` from its
// `finally` block — fire-and-forget. This module:
//
//   - skips sessions still being written by a concurrent request
//   - holds a per-session lock so double-fires for the same id
//     become no-ops (two sessions can still index in parallel)
//   - catches ClaudeCliNotFoundError and disables itself for the
//     rest of the process lifetime to avoid spamming warnings
//   - catches unexpected errors and logs them so nothing bubbles
//     back into the request handler
//
// All functions accept an explicit `workspaceRoot` so tests can
// point at a `mkdtempSync` directory.

import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { ClaudeCliNotFoundError } from "../journal/archivist.js";
import { indexSession, type IndexerDeps } from "./indexer.js";

// Per-session lock. Indexing different sessions in parallel is
// fine; indexing the same session twice concurrently would just
// burn CLI budget for no benefit.
const running = new Set<string>();

// Flipped once we hit ENOENT on the `claude` CLI so we stop
// trying for the lifetime of the server process. Reset on
// restart.
let disabled = false;

export interface MaybeIndexSessionOptions {
  sessionId: string;
  // Skip indexing if the session is still being appended to by a
  // concurrent /api/agent request — the jsonl may be mid-write.
  activeSessionIds?: ReadonlySet<string>;
  workspaceRoot?: string;
  deps?: IndexerDeps;
}

// Fire-and-forget entry point. Errors are swallowed here; a
// defensive `.catch(...)` at the call site is still recommended.
export async function maybeIndexSession(
  opts: MaybeIndexSessionOptions,
): Promise<void> {
  if (disabled) return;

  const { sessionId } = opts;
  if (opts.activeSessionIds?.has(sessionId)) return;
  if (running.has(sessionId)) return;

  running.add(sessionId);
  try {
    await indexSession(
      opts.workspaceRoot ?? defaultWorkspacePath,
      sessionId,
      opts.deps,
    );
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      disabled = true;
      // eslint-disable-next-line no-console
      console.warn(err.message);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[chat-index] unexpected failure, continuing:", err);
  } finally {
    running.delete(sessionId);
  }
}

// Internal hook: tests need to reset the module-level `disabled`
// and `running` state between cases because node:test doesn't
// reload modules. Not part of the public runtime contract.
export function __resetForTests(): void {
  disabled = false;
  running.clear();
}
