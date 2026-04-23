import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: ["extension-tests/**", "**/node_modules/**"],
  },
});
