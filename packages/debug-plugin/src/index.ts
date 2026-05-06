// Debug plugin — server side. Experimental playground used as the
// integration bed for upcoming host features (the Notifier engine in
// the Encore plan, etc.). Loaded as a preset runtime plugin so it
// appears on every fresh checkout in dev mode.
//
// `node:fs` / `node:path` / `console` / direct `fetch` are unused —
// the gui-chat-protocol eslint preset bans them at lint time.

import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const Args = z.discriminatedUnion("kind", [z.object({ kind: z.literal("echo"), message: z.string() })]);

export default definePlugin(({ log }) => {
  return {
    TOOL_DEFINITION,

    async manageDebug(rawArgs: unknown) {
      const args = Args.parse(rawArgs);

      switch (args.kind) {
        case "echo": {
          log.info("echo", { message: args.message });
          return { ok: true, kind: "echo", message: args.message };
        }

        default: {
          const exhaustive: never = args.kind;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
