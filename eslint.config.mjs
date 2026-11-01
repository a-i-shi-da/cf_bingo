import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Agent の this.sql`...` はタグ付きテンプレートを文として使う
      "@typescript-eslint/no-unused-expressions": ["warn", { allowTaggedTemplates: true }],
      // _ で始まる名前は「使わない」ことを表す
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext・wrangler の生成物
    ".open-next/**",
    ".wrangler/**",
    ".pnpm-store/**",
    "cloudflare-env.d.ts",
  ]),
]);

export default eslintConfig;
