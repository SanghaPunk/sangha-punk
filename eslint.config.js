import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["dist", ".astro", ".sst", "sst-env.d.ts"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // SST config requires a triple-slash reference to its generated platform types
    files: ["sst.config.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
])
