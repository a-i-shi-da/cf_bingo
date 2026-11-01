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
    }),
  ],
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
