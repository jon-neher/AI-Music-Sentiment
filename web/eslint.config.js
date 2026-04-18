import js from "@eslint/js";
import tseslint from "typescript-eslint";

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  ResizeObserver: "readonly",
  KeyboardEvent: "readonly",
  HTMLElement: "readonly",
  Element: "readonly",
  SVGElement: "readonly",
  SVGSVGElement: "readonly",
  SVGPathElement: "readonly",
  URLSearchParams: "readonly",
  fetch: "readonly",
  performance: "readonly",
  queueMicrotask: "readonly",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      // tsc -b emits .js siblings next to .ts sources; lint the TS only.
      "src/**/*.js",
      "src/**/*.d.ts",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "e2e/**/*.ts", "vitest.config.ts", "playwright.config.ts", "vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      // d3 chains frequently return `any` at the boundary; don't block on it.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // Node-side scripts (prod server, tooling) use Node globals, not browser globals.
  {
    files: ["server.mjs", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        globalThis: "readonly",
        fetch: "readonly",
      },
    },
  },
];
