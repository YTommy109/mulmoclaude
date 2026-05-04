import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Mirrors `packages/bookmarks-plugin/vite.config.ts`. See that file
// for the full rationale on per-entry externals — `dist/index.js`
// (server) is self-contained because the runtime loader extracts the
// tarball into a cache dir with no node_modules; `dist/vue.js`
// (browser) defers `vue` and `gui-chat-protocol/vue` to the host
// importmap so the inject Symbol stays singleton across the boundary.
export default defineConfig({
  plugins: [vue(), dts({ include: ["src/**/*.{ts,vue}"], rollupTypes: true })],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts" },
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
