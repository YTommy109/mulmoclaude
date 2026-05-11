import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Mirror of recipe-book-plugin / bookmarks-plugin: two bundles, two
// externals strategies. Server bundle inlines `gui-chat-protocol` +
// `zod`; browser bundle leaves `vue` + `gui-chat-protocol/vue`
// external so the host's Vue instance and runtime composables resolve.
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
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
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
