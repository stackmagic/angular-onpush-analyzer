import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "report", "testbed", "test/fixtures"] },
  eslint.configs.recommended,
  tseslint.configs.strict,
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
  { files: ["src/report/assets/**/*.js"], languageOptions: { globals: globals.browser } },
);
