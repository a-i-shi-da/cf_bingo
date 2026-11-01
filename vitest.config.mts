import { cloudflareTest } from "@cloudflare/vitest-plugin";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // @callable() の TC39 デコレーターを変換する（Vite 8 の Oxc は未対応のため）
    agents(),
    cloudflareTest({
      // OpenNext の生成物を使わないテスト用のエントリ
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      // テスト用の合言葉（.dev.vars の値より優先する）
      miniflare: { bindings: { ADMIN_PASSPHRASE: "test-passphrase-0123" } },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
