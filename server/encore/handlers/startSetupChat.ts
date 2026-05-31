// `startSetupChat` handler — user-initiated chat for creating a new
// obligation. Reached from the dashboard "+ Add" button (`/encore`
// landing); NOT exposed in the LLM-facing tool schema.
//
// Parallel to `startObligationChat` (which discusses an existing
// obligation) — this one has no obligation yet, so the seed prompt
// only asks the LLM to walk the user through setup. The LLM has
// the encore-dsl help file + `manageEncore({kind:"setup"})` already
// in its toolbelt; we don't need to teach it the schema here.

import { z } from "zod";
import { randomUUID } from "node:crypto";

import { startChat } from "../../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../../src/types/session.js";
import { ENCORE_SEED_ROLE_ID } from "../../../src/config/roles.js";
import { ENCORE_PLUGIN_PKG } from "../notifier.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, type EncoreDispatchResult } from "./shared.js";

export const StartSetupChatArgs = z.object({
  kind: z.literal("startSetupChat"),
  // Locale-aware seed prompt composed by the dashboard via vue-i18n
  // (`encoreDashboard.seedPrompts.setup`). The dashboard sends it only
  // for non-English locales; for `en` (and any caller that omits it)
  // we fall back to the canonical English constant below. The seed is
  // the user's own first chat turn, so accepting it from the client
  // crosses no trust boundary — it just lets the visible card and the
  // LLM's response language match the user's locale (#1545).
  seedPrompt: z.string().min(1).optional(),
});

// Canonical English seed. `src/lang/en.ts` carries a byte-identical
// copy as the i18n source of truth for the 7 translations; this stays
// the authoritative fallback so the `en` path never depends on the
// client echoing it back.
export const SETUP_SEED_PROMPT =
  "I'd like to set up a new recurring obligation in Encore. " +
  "Please walk me through what to track (kind, cadence, targets, fields), " +
  "then compose the DSL and call defineEncore when ready.";

export async function handleStartSetupChat(args: z.infer<typeof StartSetupChatArgs>): Promise<EncoreDispatchResult> {
  const chatSessionId = randomUUID();
  const result = await startChat({
    message: args.seedPrompt ?? SETUP_SEED_PROMPT,
    roleId: ENCORE_SEED_ROLE_ID,
    chatSessionId,
    origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${ENCORE_PLUGIN_PKG}`,
  });
  if (result.kind === "error") {
    throw new EncoreError(result.status ?? 500, `startSetupChat: startChat failed — ${result.error}`);
  }

  log.info("encore", "startSetupChat: chat seeded", { chatSessionId });

  return {
    ok: true,
    message: `Encore: opened setup chat ${chatSessionId}.`,
    chatId: chatSessionId,
    navigateTo: `/chat/${chatSessionId}`,
  };
}
