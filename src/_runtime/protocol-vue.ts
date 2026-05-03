// Re-export `gui-chat-protocol/vue` so a runtime-loaded plugin (#1110)
// can share the host's `useRuntime()` / `PLUGIN_RUNTIME_KEY` instances
// via importmap.
//
// Why a re-export at all: PLUGIN_RUNTIME_KEY is a `Symbol` created at
// module load time. If two copies of `gui-chat-protocol/vue` were
// loaded — one bundled into the host, another inlined in the plugin —
// they would each create their own Symbol, and `provide(K, runtime)`
// from the host would land on a different key than the plugin's
// `inject(K)` — `useRuntime()` would throw "called outside of
// <PluginScopedRoot>" even though the wrapper IS in the tree.
//
// The importmap entry in `index.html` (`gui-chat-protocol/vue` →
// `/src/_runtime/protocol-vue.ts`) makes the browser resolve the
// plugin's bare `import { useRuntime } from "gui-chat-protocol/vue"`
// to this same file the host already loaded — guaranteeing one
// shared module instance / one Symbol / one working inject path.
//
// `export *` mirrors the runtime-vue pattern next door: plugins compile
// against an evolving surface; we don't want to whitelist names here.
export * from "gui-chat-protocol/vue";
