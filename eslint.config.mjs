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
      // Hard correctness & async safety gates
      "no-control-regex": "off",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSInterfaceDeclaration[id.name=/Repository$/]",
          message:
            "Avoid single-implementation *Repository abstractions; use named SQL functions with Pool | PoolClient.",
        },
        {
          selector: "ClassDeclaration[id.name=/Repository$/]",
          message:
            "Avoid *Repository wrapper classes; use named SQL functions with Pool | PoolClient.",
        },
        {
          selector: "ClassDeclaration[id.name=/^InMemory/]",
          message:
            "Avoid InMemory* repository fakes; test database behavior against isolated PG16.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "prisma",
              message: "Mainline runtime forbids ORMs; use parameterized pg SQL.",
            },
            {
              name: "@prisma/client",
              message: "Mainline runtime forbids ORMs; use parameterized pg SQL.",
            },
            {
              name: "typeorm",
              message: "Mainline runtime forbids ORMs; use parameterized pg SQL.",
            },
            {
              name: "drizzle-orm",
              message: "Mainline runtime forbids ORMs; use parameterized pg SQL.",
            },
            {
              name: "bullmq",
              message: "Mainline runtime uses the PG-backed job table, not Redis/BullMQ.",
            },
            {
              name: "ioredis",
              message: "Mainline runtime stays Redis-free within the 4 GB single-node budget.",
            },
            {
              name: "playwright",
              message: "Headless browsers belong in tests or external L3 sidecars, never mainline runtime.",
            },
            {
              name: "puppeteer",
              message: "Headless browsers belong in tests or external L3 sidecars, never mainline runtime.",
            },
          ],
          patterns: [
            {
              group: [
                "**/application/services/**",
                "**/domain/repositories/**",
                "**/storage/repositories/**",
                "**/src/runtime/**",
                "**/arctic-shift*",
                "**/twitterapi-io*",
              ],
              message: "Retired architecture path or connector must not be re-introduced.",
            },
          ],
        },
      ],

      // New high-complexity findings block CI; existing findings are tracked in eslint-suppressions.json.
      "@typescript-eslint/no-explicit-any": "warn",
      complexity: ["error", { max: 25 }],
      "max-lines": ["warn", { max: 650, skipBlankLines: true, skipComments: true }],
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
