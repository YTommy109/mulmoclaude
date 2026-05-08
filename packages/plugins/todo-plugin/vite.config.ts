import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Mirrors `packages/plugins/bookmarks-plugin/vite.config.ts`. See that file
// for the full rationale on per-entry externals — `dist/index.js`
// (server) is self-contained because the runtime loader extracts the
// tarball into a cache dir with no node_modules; `dist/vue.js`
// (browser) defers `vue` and `gui-chat-protocol/vue` to the host
// importmap so the inject Symbol stays singleton across the boundary.
export default defineConfig({
  // No `rollupTypes: true`: that would route the d.ts emit through
  // `@microsoft/api-extractor`, which (as of 7.58.7) bundles a TS
  // 5.9.3 compiler engine and silently drops every export when the
  // workspace runs on TS 6+. Per-file d.ts emit by `vite-plugin-dts`
  // uses the workspace's own tsc, so it tracks the toolchain.
  // No `rollupTypes: true`: that would route the d.ts emit through
  // `@microsoft/api-extractor`, which (as of 7.58.7) bundles a TS
  // 5.9.3 compiler engine and silently drops every export when the
  // workspace runs on TS 6+. Per-file d.ts emit by `vite-plugin-dts`
  // uses the workspace's own tsc, so it tracks the toolchain.
  //
  // `compilerOptions.rootDir: "src"` + `outDir: "dist"` make the d.ts
  // paths match the package.json `exports` map (otherwise the emit
  // lands under `dist/src/...` and the subpath imports break).
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
      entry: { index: "src/index.ts", vue: "src/vue.ts", shared: "src/shared.ts", composables: "src/composables/index.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
        // Pin CSS asset name to `style.css` so the host runtime loader
        // (src/tools/runtimeLoader.ts) finds it at the contracted path.
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
