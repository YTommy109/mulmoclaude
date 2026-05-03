// Plugin META aggregation diagnostics.
//
// At boot we collect every collision the aggregators dropped (host
// keys vs plugin keys) plus every intra-plugin duplicate
// (`BUILT_IN_PLUGIN_METAS` checked once at module load) and surface
// them via three channels:
//
//   1. `log.warn(...)`            — always, for stderr / journal
//   2. `publishNotification(...)` — pushed to live bell + toast
//   3. module-level cache         — persisted so a UI mounting after
//                                    boot can still fetch the list
//                                    via GET /api/plugins/diagnostics
//
// Throwing was rejected because a single buggy plugin would brick
// the whole app — especially relevant once user-installed runtime
// plugins (#1043 / #1110) land. Filter-and-warn keeps the host
// running and gives the user a clear signal to fix or remove the
// offending plugin.

import { INTRA_PLUGIN_COLLISIONS, type HostPluginCollision, type IntraPluginCollision } from "../../src/plugins/metas.js";
import { TOOL_NAMES_HOST_COLLISIONS } from "../../src/config/toolNames.js";
import { API_ROUTES_HOST_COLLISIONS } from "../../src/config/apiRoutes.js";
import { PUBSUB_CHANNELS_HOST_COLLISIONS } from "../../src/config/pubsubChannels.js";
import { WORKSPACE_DIRS_HOST_COLLISIONS } from "../workspace/paths.js";
import { log } from "../system/logger/index.js";
import { publishNotification } from "../events/notifications.js";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_PRIORITIES } from "../../src/types/notification.js";

/** Shape returned by `GET /api/plugins/diagnostics`. */
export interface PluginMetaDiagnostic {
  /** Internal id, used for deduplication and toast keys. */
  id: string;
  /** One-line human-readable warning. */
  message: string;
  /** Type of issue — useful when the UI wants to group / icon them. */
  kind: "host-plugin" | "intra-plugin";
  /** Aggregator label (`API_ROUTES`, `WORKSPACE_DIRS`, …) for
   *  host-plugin collisions; the dimension name (`apiRoutesKey`,
   *  …) for intra-plugin duplicates. */
  scope: string;
  /** The colliding key. */
  key: string;
  /** Plugin(s) involved. Length 1 for host-plugin (the plugin that
   *  was dropped); length 2 for intra-plugin (first-registered,
   *  second-registered). */
  plugins: readonly string[];
}

function describeHostCollision(collision: HostPluginCollision): PluginMetaDiagnostic {
  const plugin = collision.plugin || "<unknown plugin>";
  return {
    id: `host:${collision.label}:${collision.key}:${plugin}`,
    message: `Plugin "${plugin}" tried to register the ${collision.label} key "${collision.key}" but it is reserved by the host. The plugin's entry has been dropped.`,
    kind: "host-plugin",
    scope: collision.label,
    key: collision.key,
    plugins: [plugin],
  };
}

function describeIntraCollision(collision: IntraPluginCollision): PluginMetaDiagnostic {
  const [first, second] = collision.plugins;
  return {
    id: `intra:${collision.dimension}:${collision.key}:${first}:${second}`,
    message: `Plugins "${first}" and "${second}" both register ${collision.dimension} "${collision.key}". The second registration is ignored.`,
    kind: "intra-plugin",
    scope: collision.dimension,
    key: collision.key,
    plugins: [first, second],
  };
}

let cachedDiagnostics: readonly PluginMetaDiagnostic[] | null = null;

/** Build (and cache) the full diagnostic list for this process. */
export function collectPluginMetaDiagnostics(): readonly PluginMetaDiagnostic[] {
  if (cachedDiagnostics !== null) return cachedDiagnostics;
  const hostCollisions = [...TOOL_NAMES_HOST_COLLISIONS, ...API_ROUTES_HOST_COLLISIONS, ...PUBSUB_CHANNELS_HOST_COLLISIONS, ...WORKSPACE_DIRS_HOST_COLLISIONS];
  const list: PluginMetaDiagnostic[] = [...hostCollisions.map(describeHostCollision), ...INTRA_PLUGIN_COLLISIONS.map(describeIntraCollision)];
  cachedDiagnostics = Object.freeze(list);
  return cachedDiagnostics;
}

/** Reset the cache. Test-only — production code calls
 *  `collectPluginMetaDiagnostics()` once at boot. */
export function resetPluginMetaDiagnosticsCacheForTest(): void {
  cachedDiagnostics = null;
}

/** Run at server boot AFTER `initNotifications` so the publish call
 *  reaches the pubsub. Logs every diagnostic via `log.warn` and
 *  publishes one notification per item so live UIs see a toast +
 *  bell entry. Returns the diagnostics so the caller can choose to
 *  expose them via an HTTP endpoint. */
export function announcePluginMetaDiagnostics(): readonly PluginMetaDiagnostic[] {
  const diagnostics = collectPluginMetaDiagnostics();
  if (diagnostics.length === 0) {
    log.debug("[plugin-meta]", "no aggregator collisions detected");
    return diagnostics;
  }
  for (const diag of diagnostics) {
    log.warn("[plugin-meta]", diag.message, { id: diag.id, scope: diag.scope, key: diag.key, plugins: diag.plugins });
    publishNotification({
      kind: "system",
      title: "Plugin configuration issue",
      body: diag.message,
      action: { type: NOTIFICATION_ACTION_TYPES.none },
      priority: NOTIFICATION_PRIORITIES.high,
    });
  }
  return diagnostics;
}
