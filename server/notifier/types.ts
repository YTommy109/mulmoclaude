// Notifier value types. Kept separate from `engine.ts` so the API
// route layer (server/api/routes/notifier.ts) can validate inbound
// payloads against the same enum constants the engine accepts —
// importing the engine just for its types would pull in fs / pubsub
// dependencies the route doesn't need.

/** UI hint only. The engine never reads `lifecycle` — it's stored
 *  on the entry and forwarded to subscribers so the UI can render
 *  rows differently:
 *
 *    `fyi`    — bell panel renders a checkbox + "Acknowledge selected"
 *               button; the host calls `clear` when the user acks.
 *    `action` — row is a hyperlink routing to the plugin's view; the
 *               plugin calls `clear` (on view mount for read-once
 *               notifications, or after a domain action completes).
 *
 *  An earlier draft split `action` into `read` and `action` based on
 *  who fires the close — but from the engine's perspective both are
 *  "the plugin owns the close call", so the distinction was bookkeeping
 *  with no runtime effect. */
export const NOTIFIER_LIFECYCLES = ["fyi", "action"] as const;
export type NotifierLifecycle = (typeof NOTIFIER_LIFECYCLES)[number];

/** Severity drives badge color and (in a future iteration) channel
 *  routing. The engine itself only stores it on the entry. */
export const NOTIFIER_SEVERITIES = ["info", "nudge", "urgent"] as const;
export type NotifierSeverity = (typeof NOTIFIER_SEVERITIES)[number];

export interface NotifierEntry<TPluginData = unknown> {
  /** Engine-assigned UUID. Generated synchronously inside `publish()`
   *  so the caller can use it before persistence completes. */
  id: string;
  /** Plugin namespace (e.g. `"encore"`, `"debug__system"`). The
   *  engine never inspects it — used only for `listFor()` filtering
   *  and as a UI grouping key. */
  pluginPkg: string;
  severity: NotifierSeverity;
  lifecycle?: NotifierLifecycle;
  title: string;
  body?: string;
  /** Opaque to the engine. Round-trips through JSON unchanged; only
   *  the originating plugin's UI knows the shape. */
  pluginData?: TPluginData;
  /** ISO-8601 timestamp set at `publish()` time. */
  createdAt: string;
}

/** Caller-supplied input for `publish()`. The engine fills in `id`
 *  and `createdAt`; everything else flows through verbatim. */
export interface PublishInput<TPluginData = unknown> {
  pluginPkg: string;
  severity: NotifierSeverity;
  title: string;
  body?: string;
  lifecycle?: NotifierLifecycle;
  pluginData?: TPluginData;
}

/** On-disk shape of `~/mulmoclaude/data/notifier/active.json`. Holds
 *  only entries that haven't been cleared or cancelled — the file is
 *  a snapshot, not an event log. */
export interface NotifierFile {
  entries: Record<string, NotifierEntry>;
}

/** Pub-sub event published on `PUBSUB_CHANNELS.notifier` after every
 *  successful state change. Discriminated union — subscribers switch
 *  on `type` to keep TypeScript narrowing the rest of the payload. */
export type NotifierEvent = { type: "published"; entry: NotifierEntry } | { type: "cleared"; id: string } | { type: "cancelled"; id: string };
