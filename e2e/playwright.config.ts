import { defineConfig } from "@playwright/test";

const port = Number(process.env.VITE_PORT) || 8000;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "yarn dev:client",
    port,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
