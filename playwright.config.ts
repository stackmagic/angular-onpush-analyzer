import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: true,
  reporter: "list",
  use: { browserName: "chromium" },
});
