// Debug plugin — server side. Experimental playground used as the
// integration bed for upcoming host features (the Notifier engine in
// the Encore plan, etc.). Loaded as a preset runtime plugin so it
// appears on every fresh checkout in dev mode.
//
// `node:fs` / `node:path` / `console` / direct `fetch` are unused —
// the gui-chat-protocol eslint preset bans them at lint time.
//
// The notifier dispatches below assume a MulmoClaude-augmented
// runtime that exposes `runtime.notifier` (host extension over
// `gui-chat-protocol`'s `PluginRuntime`). The cast is the contract
// — once that API stabilises and lands in `gui-chat-protocol`, the
// cast goes away.

import { definePlugin, type PluginRuntime } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const NotifierSeverity = z.enum(["info", "nudge", "urgent"]);
const NotifierLifecycle = z.enum(["fyi", "action"]);

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("echo"), message: z.string() }),
  z.object({
    kind: z.literal("publish"),
    severity: NotifierSeverity,
    lifecycle: NotifierLifecycle,
    title: z.string().min(1),
    body: z.string().optional(),
    navigateTarget: z.string().optional(),
  }),
  z.object({ kind: z.literal("clear"), id: z.string().min(1) }),
]);

interface MulmoclaudeNotifierApi {
  publish(input: {
    severity: z.infer<typeof NotifierSeverity>;
    lifecycle?: z.infer<typeof NotifierLifecycle>;
    title: string;
    body?: string;
    navigateTarget?: string;
    pluginData?: unknown;
  }): Promise<{ id: string }>;
  clear(id: string): Promise<void>;
}

type MulmoclaudeRuntime = PluginRuntime & { notifier: MulmoclaudeNotifierApi };

export default definePlugin((runtime) => {
  const { log } = runtime;
  const { notifier } = runtime as MulmoclaudeRuntime;

  return {
    TOOL_DEFINITION,

    async manageDebug(rawArgs: unknown) {
      const args = Args.parse(rawArgs);

      switch (args.kind) {
        case "echo": {
          log.info("echo", { message: args.message });
          return { ok: true, kind: "echo", message: args.message };
        }

        case "publish": {
          const { id } = await notifier.publish({
            severity: args.severity,
            lifecycle: args.lifecycle,
            title: args.title,
            body: args.body,
            navigateTarget: args.navigateTarget,
          });
          log.info("publish", { id, lifecycle: args.lifecycle, severity: args.severity });
          return { ok: true, kind: "publish", id };
        }

        case "clear": {
          await notifier.clear(args.id);
          log.info("clear", { id: args.id });
          return { ok: true, kind: "clear" };
        }

        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
