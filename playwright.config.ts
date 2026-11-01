import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E テスト（docs/test-plan.md 4章）。`pnpm preview` の Worker 全体（画面＋Agent）を相手に動かす。
// 管理画面の合言葉は .dev.vars から読む（値は表示しない・コードに書かない）
function readDevVar(name: string): string | undefined {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") || undefined;
  } catch {
    return undefined;
  }
}
process.env.E2E_ADMIN_PASSPHRASE ??= readDevVar("ADMIN_PASSPHRASE");

const PORT = 8787;

export default defineConfig({
  testDir: "./e2e",
  // 抽選は3秒に1回しかできないので、ビンゴまで引くテストは長くかかる
  timeout: 8 * 60_000,
  expect: { timeout: 15_000 },
  // ルームを作る回数が少ないほうが速いので、1つずつ順に動かす
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm preview",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 5 * 60_000,
  },
});
