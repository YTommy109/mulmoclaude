// Watch each dev plugin's `dist/` and emit one event per change burst
// (PR3 of #1159). Vite writes 4-5 files within ~100ms on a single
// rebuild, so debounce → 1 reload per save instead of 5.
//
// Uses Node's built-in `fs.watch` with `recursive: true` rather than
// chokidar to avoid pulling another runtime dependency. Recursive
// watching is supported on macOS / Linux / Windows since Node 20.
//
// The publish + warnServerSideChange callbacks are injected so tests
// can exercise the debounce + classification logic without booting the
// pubsub or hitting the structured logger.

import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import type { RuntimePlugin } from "./runtime-loader.js";

const DEFAULT_DEBOUNCE_MS = 300;
const SERVER_ENTRY_FILENAME = "index.js";

export interface DevPluginChangedPayload {
  /** Files changed during the debounce window (relative to dist/). */
  changedFiles: string[];
  /** True iff `dist/index.js` was among them — caller surfaces a
   *  prominent log so the dev knows server-side hot-reload is not
   *  possible and they need to restart mulmoclaude. */
  serverSideChange: boolean;
}

export interface WatchDevPluginsOptions {
  /** Called once per debounce burst per plugin. */
  publish: (pluginName: string, payload: DevPluginChangedPayload) => void;
  /** Called when `dist/index.js` is in the burst. The watcher still
   *  publishes (the browser reload is harmless), but the dev needs
   *  this hint to know why their server-side change didn't take. */
  warnServerSideChange?: (pluginName: string) => void;
  /** Override for testing. */
  debounceMs?: number;
  /** Override the watcher factory for tests. Default uses node:fs. */
  watcherFactory?: (absDistPath: string, onChange: (relativePath: string) => void) => FSWatcher;
}

export interface DevWatcherHandle {
  /** Stop every watcher. Safe to call multiple times. */
  close: () => void;
}

function defaultWatcherFactory(absDistPath: string, onChange: (relativePath: string) => void): FSWatcher {
  return watch(absDistPath, { recursive: true }, (_eventType, filename) => {
    if (typeof filename === "string" && filename.length > 0) {
      onChange(filename);
    }
  });
}

/** Attach a debounced watcher to each dev plugin's `dist/`. Returns a
 *  handle whose `close()` shuts every watcher down — call it from the
 *  graceful shutdown path. */
export function watchDevPlugins(plugins: readonly RuntimePlugin[], opts: WatchDevPluginsOptions): DevWatcherHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const factory = opts.watcherFactory ?? defaultWatcherFactory;
  const watchers: FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingFiles = new Map<string, Set<string>>();

  for (const plugin of plugins) {
    const absDistPath = path.join(plugin.cachePath, "dist");
    const watcher = factory(absDistPath, (relativePath) => {
      const buffer = pendingFiles.get(plugin.name) ?? new Set<string>();
      buffer.add(relativePath);
      pendingFiles.set(plugin.name, buffer);

      const existing = timers.get(plugin.name);
      if (existing) clearTimeout(existing);
      timers.set(
        plugin.name,
        setTimeout(() => {
          const files = pendingFiles.get(plugin.name);
          pendingFiles.delete(plugin.name);
          timers.delete(plugin.name);
          if (!files || files.size === 0) return;
          const changedFiles = Array.from(files).sort();
          const serverSideChange = changedFiles.some((file) => path.basename(file) === SERVER_ENTRY_FILENAME);
          if (serverSideChange) opts.warnServerSideChange?.(plugin.name);
          opts.publish(plugin.name, { changedFiles, serverSideChange });
        }, debounceMs),
      );
    });
    watchers.push(watcher);
  }

  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pendingFiles.clear();
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // Ignore — the watcher might have already errored out.
        }
      }
    },
  };
}
