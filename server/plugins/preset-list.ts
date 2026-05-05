// Preset plugins shipped with the repo (#1043 C-2 follow-up).
//
// Each entry is a published npm package that lives in mulmoclaude's
// `node_modules`; the boot loader registers it through the same path
// as a user-installed runtime plugin (workspace ledger), so the
// frontend dynamic-import + Vue View pipeline runs end-to-end on
// every fresh checkout — no manual `yarn plugin:install` needed for
// testing or for first-launch UX.
//
// Presets and user-installed plugins share the runtime registry. On
// tool-name collision the preset wins (loaded first; static MCP
// built-ins still win over both).
//
// Adding a preset:
//   1. `yarn add <package>` (or extend an existing dep)
//   2. Append a row below
//   3. Restart the server
//
// Removing a preset:
//   1. Remove the row
//   2. Optionally `yarn remove <package>`
//   3. Restart

export interface PresetPlugin {
  /** npm package name (the directory under `node_modules`). */
  packageName: string;
}

export const PRESET_PLUGINS: readonly PresetPlugin[] = [
  // #1145 — runtime-plugin shape of the built-in todo plugin.
  // Loaded as a preset (resolved via `node_modules/@mulmoclaude/todo-plugin/`
  // through the yarn-workspaces symlink) so it boots on every fresh
  // checkout. Owns `manageTodoList` end-to-end now that the static
  // entry under `src/plugins/todo/` has been removed.
  { packageName: "@mulmoclaude/todo-plugin" },
  // #1162 — Spotify integration (Liked Songs / playlists / recently
  // played). PR 1 ships OAuth + token persistence; PR 2 adds the
  // listening-data kinds and the Vue View. Loaded the same way as
  // todo-plugin via the workspace symlink at
  // `node_modules/@mulmoclaude/spotify-plugin/`.
  { packageName: "@mulmoclaude/spotify-plugin" },
];
