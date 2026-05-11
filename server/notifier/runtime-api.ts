// Plugin-facing notifier API. The host attaches a per-plugin
// instance of `NotifierRuntimeApi` to the `PluginRuntime` it
// constructs for each plugin (see `server/plugins/runtime.ts`).
// `pluginPkg` is auto-bound to the calling plugin's pkg name so
// plugins cannot publish under another plugin's namespace.
//
// Plugin authors access this surface via type assertion:
//
//   import type { PluginRuntime } from "gui-chat-protocol";
//   import type { MulmoclaudeRuntime } from "<mulmoclaude>/notifier/runtime-api";
//   export default definePlugin((runtime: PluginRuntime) => {
//     const { notifier } = runtime as MulmoclaudeRuntime;
//     // notifier.publish(...) / notifier.clear(...)
//   });
//
// Once the API stabilises, this is a candidate for upstreaming
// into gui-chat-protocol so the cast goes away.

import type { PluginRuntime } from "gui-chat-protocol";
import type { NotifierLifecycle, NotifierSeverity } from "./types.js";
import type { TasksRuntimeApi } from "../plugins/runtime-tasks-api.js";
import type { ChatRuntimeApi } from "../plugins/runtime-chat-api.js";

export type { TasksRuntimeApi, PluginTaskRegistration, PluginTaskSchedule } from "../plugins/runtime-tasks-api.js";
export type { ChatRuntimeApi, ChatStartInput, ChatStartResult } from "../plugins/runtime-chat-api.js";

/** Caller-supplied input for the plugin-facing `publish`. Same shape
 *  as `PublishInput` minus `pluginPkg`, which the host fills in
 *  automatically from the calling plugin's pkg name.
 *
 *  Two publish-time rules apply to `action` lifecycle, enforced by the
 *  engine (and also by the HTTP layer for parity):
 *
 *    - `navigateTarget` MUST be a non-empty string.
 *    - `severity` MUST NOT be `"info"`.
 *
 *  Violations cause `publish()` to throw. The runtime check exists in
 *  addition to (not instead of) any future type-level discriminated
 *  union; for now it's plain runtime validation. */
export interface PluginPublishInput<TPluginData = unknown> {
  severity: NotifierSeverity;
  title: string;
  body?: string;
  lifecycle?: NotifierLifecycle;
  navigateTarget?: string;
  pluginData?: TPluginData;
}

export interface NotifierRuntimeApi {
  /** Publish a notification scoped to this plugin. The engine assigns
   *  a UUID synchronously and returns it. **Throws** if the input
   *  violates the `action` lifecycle rules (see `PluginPublishInput`):
   *  `action` requires a non-empty `navigateTarget` and cannot pair
   *  with `info` severity. */
  publish: <TPluginData = unknown>(input: PluginPublishInput<TPluginData>) => Promise<{ id: string }>;
  /** Clear an entry by id. No-op (no throw) when:
   *   - the id is unknown, OR
   *   - the entry exists but belongs to a different plugin.
   *
   *  The latter keeps per-plugin isolation: a plugin holding another
   *  plugin's id (e.g. via a future leak) silently can't dismiss it.
   *  Internally backed by `engine.clearForPlugin(pluginPkg, id)`. */
  clear: (id: string) => Promise<void>;
}

/** The runtime shape MulmoClaude actually provides — the
 *  gui-chat-protocol `PluginRuntime` plus the host's extensions:
 *  notifier (publish/clear), tasks (one periodic tick per plugin),
 *  and chat (seed a new chat with an instruction prompt). */
export type MulmoclaudeRuntime = PluginRuntime & {
  notifier: NotifierRuntimeApi;
  tasks: TasksRuntimeApi;
  chat: ChatRuntimeApi;
};
