// Todo plugin — server side (PR1 scaffold for #1145).
//
// PR1 intent: register the plugin via the runtime-loader factory
// pattern WITHOUT actually changing behaviour. The static built-in
// todo plugin is still present in `src/plugins/todo/` and on the
// server in `server/api/routes/todos*.ts`; the runtime registry's
// collision policy makes the static side win on the shared
// `TOOL_DEFINITION.name = "manageTodoList"`. So this handler is
// dormant — it exists, but the dispatch route never invokes it.
//
// Subsequent PRs (PR2 / PR3) move actual handler logic in here. PR5
// deletes the static side, after which this becomes the real handler.

import { definePlugin } from "gui-chat-protocol";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

export default definePlugin(({ log }) => ({
  TOOL_DEFINITION,

  async manageTodoList(_args: unknown) {
    // PR1 stub. PR2/3 fills this in with the items + columns +
    // dispatch logic moved out of `server/api/routes/todos*.ts`.
    log.warn(
      "manageTodoList runtime-plugin handler called — PR1 scaffold should not be the active handler. Static plugin's collision-win policy was bypassed somehow. Returning explicit error to avoid silent no-op.",
    );
    return {
      ok: false as const,
      error:
        "todo-plugin handler not yet migrated; falling back to the built-in static plugin (which should win the collision). If you see this in production, the runtime-vs-static collision policy regressed.",
    };
  },
}));
