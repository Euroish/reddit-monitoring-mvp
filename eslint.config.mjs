import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "apps/web/**",
      "node_modules/**",
      "output/**",
      "plugins/**",
      "**/*.d.ts",
      "**/*.d.mts",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "no-unused-vars": "off", "@typescript-eslint/no-unused-vars": "off" } },
  {
    files: ["src/**/*.ts", "apps/api/**/*.ts", "packages/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Correctness and async safety
      "no-control-regex": "off",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-control-regex": "off",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreVoid: true,
          allowForKnownSafeCalls: [
            { from: "package", name: ["test", "describe", "it", "suite"], package: "node:test" },
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
