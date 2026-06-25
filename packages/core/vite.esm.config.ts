import { defineConfig } from "vite";

// Pass 2 — workspace-setup, ESM-only. `import.meta.url` (asset resolution in
// assets.ts) isn't available under CJS, and both hosts run the server as ESM via
// tsx, so these entries ship ESM only and carry no `require` condition. No dts
// here (pass 1's dts already emitted declarations for all src); `emptyOutDir:
// false` preserves pass 1's output.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        "workspace-setup/index": "src/workspace-setup/index.ts",
        "workspace-setup/slug": "src/workspace-setup/slug.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^node:/],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
