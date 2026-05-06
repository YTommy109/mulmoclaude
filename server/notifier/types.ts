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
  /** Optional in-app deep-link target (relative URL). The bell popup
   *  routes here on row click, with `&notificationId=<id>` appended
   *  so the landing page can identify which entry to clear. The
   *  engine doesn't read this — it's a UI hint stored on the entry. */
  navigateTarget?: string;
  /** Opaque to the engine. Round-trips through JSON unchanged; only
   *  the originating plugin's UI knows the shape. */
  pluginData?: TPluginData;
  /** ISO-8601 timestamp set at `publish()` time. */
  createdAt: string;
}

/** A history entry — a `NotifierEntry` after it has been cleared or
 *  cancelled, with the terminal type and timestamp recorded. The
 *  bell popup's "History" section renders these read-only. */
export interface NotifierHistoryEntry<TPluginData = unknown> extends NotifierEntry<TPluginData> {
  terminalType: "cleared" | "cancelled";
  terminalAt: string;
}

/** Caller-supplied input for `publish()`. The engine fills in `id`
 *  and `createdAt`; everything else flows through verbatim. */
export interface PublishInput<TPluginData = unknown> {
  pluginPkg: string;
  severity: NotifierSeverity;
  title: string;
  body?: string;
  lifecycle?: NotifierLifecycle;
  navigateTarget?: string;
  pluginData?: TPluginData;
}

/** On-disk shape of `~/mulmoclaude/data/notifier/active.json`. Holds
 *  only entries that haven't been cleared or cancelled — the file is
 *  a snapshot, not an event log. */
export interface NotifierFile {
  entries: Record<string, NotifierEntry>;
}

/** On-disk shape of `~/mulmoclaude/data/notifier/history.json`. Array
 *  of terminated entries newest-first, capped at `HISTORY_CAP` with
 *  FIFO eviction (push at index 0, slice from the tail). */
export interface NotifierHistoryFile {
  entries: NotifierHistoryEntry[];
}

/** History size cap. The bell popup's History section renders this
 *  many entries; older ones fall off when new terminations land. */
export const HISTORY_CAP = 50;

/** Pub-sub event published on `PUBSUB_CHANNELS.notifier` after every
 *  successful state change. Discriminated union — subscribers switch
 *  on `type` to keep TypeScript narrowing the rest of the payload. */
export type NotifierEvent = { type: "published"; entry: NotifierEntry } | { type: "cleared"; id: string } | { type: "cancelled"; id: string };
