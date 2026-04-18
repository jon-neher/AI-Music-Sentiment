import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    globals: false,
    restoreMocks: true,
  },
});
