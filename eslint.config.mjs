import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "*.mjs",
      "src/runtime/harness-context.ts",
      "src/runtime/register-events.ts",
      "src/runtime/register-harness.ts",
      "src/runtime/register-lifecycle.ts",
      "src/runtime/session-runtime.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    // Test fakes stub the pi extension API; `any` is the accepted mock idiom there.
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
