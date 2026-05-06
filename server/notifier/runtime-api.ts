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

/** Caller-supplied input for the plugin-facing `publish`. Same shape
 *  as `PublishInput` minus `pluginPkg`, which the host fills in
 *  automatically from the calling plugin's pkg name. */
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
   *  a UUID synchronously and returns it. */
  publish: <TPluginData = unknown>(input: PluginPublishInput<TPluginData>) => Promise<{ id: string }>;
  /** Clear an entry by id. No-op (no throw) if the id is unknown. */
  clear: (id: string) => Promise<void>;
}

/** The runtime shape MulmoClaude actually provides — the
 *  gui-chat-protocol `PluginRuntime` plus the host's notifier
 *  extension. */
export type MulmoclaudeRuntime = PluginRuntime & {
  notifier: NotifierRuntimeApi;
};
