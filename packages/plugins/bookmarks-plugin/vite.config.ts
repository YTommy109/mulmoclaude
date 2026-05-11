import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Two bundles, two externals strategies (#1110):
//
// - `dist/index.js` (server) — self-contained. The runtime loader
//   extracts the tarball into `~/mulmoclaude/plugins/.cache/<pkg>/<ver>/`
//   and dynamic-imports it. There's no node_modules underneath, so any
//   bare import that's left as `external` will fail to resolve at load
//   time. Inline `gui-chat-protocol` (just the identity `definePlugin`
//   function — tiny) and `zod` (~50KB) so the server module loads
//   without any module-resolution gymnastics.
//
// - `dist/vue.js` (browser) — `vue` and `gui-chat-protocol/vue` stay
//   external; the host provides Vue via the importmap and the
//   `useRuntime()` composable resolves to the host's instance through
//   `gui-chat-protocol/vue` (also via importmap).
export default defineConfig({
  // No `rollupTypes: true`: that would route the d.ts emit through
  // `@microsoft/api-extractor`, which (as of 7.58.7) bundles a TS
  // 5.9.3 compiler engine and silently drops every export when the
  // workspace runs on TS 6+. Per-file d.ts emit by `vite-plugin-dts`
  // uses the workspace's own tsc, so it tracks the toolchain.
  // `compilerOptions.rootDir: "src"` strips `src/` from the d.ts
  // paths so `dist/index.d.ts` matches the package.json `exports`
  // map (would otherwise emit to `dist/src/index.d.ts`).
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.{ts,vue}"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // `vue` and `gui-chat-protocol/vue` are always host-provided
      // (importmap on the browser side). `gui-chat-protocol` (just the
      // identity `definePlugin` helper) and `zod` are inlined so the
      // server bundle is self-contained — needed because the cache dir
      // the loader extracts into has no node_modules.
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
        // The host runtime loader (src/tools/runtimeLoader.ts) injects
        // a stylesheet from `${assetBase}/dist/style.css`. Vite's
        // default would name the CSS after the package
        // (`bookmarks-plugin.css`); pin it to `style.css` so the host
        // doesn't have to special-case per plugin.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return assetInfo.name ?? "[name]";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
