import { defineConfig } from "oxlint";

export default defineConfig({
  $schema: "./node_modules/oxlint/configuration_schema.json",
  options: {
    typeAware: true,
    typeCheck: true,
  },
  categories: {
    correctness: "error",
    suspicious: "warn",
  },
  plugins: ["typescript", "unicorn", "oxc", "import"],
  rules: {
    "eslint/no-unused-vars": "off",
    "typescript/no-floating-promises": "error",
    "typescript/no-explicit-any": "warn",
  },
  overrides: [
    {
      files: ["scripts/**/*.ts", "scripts/**/*.cjs"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["tests/**/*.ts"],
      env: {
        node: true,
      },
    },
  ],
  ignorePatterns: [
    "dist",
    "target",
    "coverage",
    "vendor",
    "npm",
    "crates/native/index.js",
    "crates/native/index.d.ts",
    "**/*.node",
  ],
});
