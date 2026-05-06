import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Mirror of recipe-book-plugin / bookmarks-plugin: two bundles, two
// externals strategies. Server bundle inlines `gui-chat-protocol` +
// `zod`; browser bundle leaves `vue` + `gui-chat-protocol/vue`
// external so the host's Vue instance and runtime composables resolve.
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
