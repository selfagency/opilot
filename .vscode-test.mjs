import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "test/integration/**/*.test.js",
  launchArgs: ["--disable-extensions"],
});
