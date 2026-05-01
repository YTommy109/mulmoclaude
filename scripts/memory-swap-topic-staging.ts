// CLI helper that promotes the topic-format staging into
// `conversations/memory/` (#1070 PR-B). Invoked via
// `yarn memory:swap` after the user has reviewed
// `diff -r conversations/memory conversations/memory.next` and
// is satisfied with the LLM's clustering. The swap is one-way
// in the sense that it renames staging into place — but
// `topic-swap.ts` parks the prior atomic layout under
// `conversations/memory/.atomic-backup/<ts>/` so a misclassified
// migration can be rolled back by hand.

import { workspacePath } from "../server/workspace/workspace.js";
import { swapStagingIntoMemory } from "../server/workspace/memory/topic-swap.js";

async function main(): Promise<void> {
  const result = await swapStagingIntoMemory(workspacePath);
  if (!result.swapped) {
    console.error(`memory:swap — did not swap: ${result.reason ?? "unknown"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`memory:swap — promoted staging into conversations/memory/`);
  if (result.backupPath) {
    console.log(`memory:swap — prior atomic layout parked at ${result.backupPath}`);
  } else {
    console.log("memory:swap — no prior memory dir existed; nothing to back up");
  }
}

main().catch((err) => {
  console.error(`memory:swap — failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
