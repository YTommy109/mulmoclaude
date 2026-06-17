// Dispatch registry for BUILT-IN plugins (task #6). Runtime-loaded
// plugins answer `POST /api/plugins/runtime/:pkg/dispatch` out of the
// runtime registry (see runtime-registry.ts). Built-in plugins — the
// ones bundled by Vite and wrapped with `wrapWithScope` — get the same
// `useRuntime().dispatch({ kind })` channel by registering a handler
// here keyed by their scope name (e.g. "markdown"). The dispatch route
// falls back to this registry when a name isn't a runtime plugin.
//
// Built-ins use this (rather than the runtime registry) because they
// need HOST backends — Puppeteer, Gemini, the document store — injected
// via gui-chat-protocol's `ToolContext.app`, which the generic runtime
// path (scoped files/fetch only) doesn't carry.

export type BuiltinDispatchHandler = (args: Record<string, unknown>) => Promise<unknown>;

const registry = new Map<string, BuiltinDispatchHandler>();

/** Register a built-in plugin's dispatch handler under its scope name.
 *  Last registration wins (modules are imported once at boot). */
export function registerBuiltinDispatch(scope: string, handler: BuiltinDispatchHandler): void {
  registry.set(scope, handler);
}

/** Look up a built-in dispatch handler. Returns undefined when the
 *  name belongs to a runtime plugin (or nothing at all). */
export function getBuiltinDispatch(scope: string): BuiltinDispatchHandler | undefined {
  return registry.get(scope);
}
