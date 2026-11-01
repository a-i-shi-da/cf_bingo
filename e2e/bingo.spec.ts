import { expect, test } from "@playwright/test";
import { cardCells, closeAll, createRoom, draw, drawnCount, issueCodes, joinAsPlayer, networkSwitch } from "./helpers";

// docs/test-plan.md 4章の E2E シナリオ。`pnpm test:e2e` で動かす（pnpm preview を自動で起動する）

test("本番の流れ：作成 → コード発行 → 投影 → 3人参加 → 開始 → ビンゴまで抽選 → 終了 → CSV", async ({ page, browser }) => {
  const { roomId, hostUrl } = await createRoom(page, "E2E 本番の流れ");

  // 司会画面（?t= はすぐ消える）
  await page.goto(hostUrl);
  await expect(page.getByRole("tab", { name: "進行" })).toBeVisible();
  const codes = await issueCodes(page, 3);

  // 投影画面
  const screenContext = await browser.newContext();
  const screen = await screenContext.newPage();
  await screen.goto(`/screen/${roomId}`);
  await screen.getByRole("button", { name: /音を有効にする/ }).click();
  await expect(screen.getByText("参加 0人")).toBeVisible();

  const players = await Promise.all(
    ["あおい", "ひかる", "そら"].map((name, i) => joinAsPlayer(browser, roomId, codes[i], name)),
  );
  await expect(screen.getByText("参加 3人")).toBeVisible();
  await expect(page.getByText("3人（オンライン 3）")).toBeVisible();

  await page.getByRole("button", { name: "開始" }).click();
  await expect(players[0].page.getByText(/抽選 0回/)).toBeVisible();

  // だれかがビンゴになるまで引く（3人なら多くても75回で必ず出る）
  while ((await page.getByText(/^\d+人 ／ [1-9]\d*人$/).count()) === 0) {
    expect(await drawnCount(page)).toBeLessThan(75);
    await draw(page);
  }
  const count = await drawnCount(page);

  // 投影画面：演出のあとに最新の番号の回数とビンゴの人が出る
  await expect(screen.getByText(`抽選 ${count}回目`)).toBeVisible();
  await expect(screen.getByRole("heading", { name: "🏆 ビンゴ" })).toBeVisible();

  // 参加者：だれかのお祝い表示、全員に勝者一覧
  for (const p of players) await expect(p.page.getByRole("heading", { name: "🏆 ビンゴした人" })).toBeVisible();
  const celebrated = await Promise.all(players.map((p) => p.page.getByRole("dialog", { name: "ビンゴ" }).isVisible()));
  expect(celebrated).toContain(true);

  // 終了（確認あり）
  await page.getByRole("button", { name: "終了", exact: true }).click();
  await page.getByRole("button", { name: "終了する" }).click();
  await expect(page.getByText("終了しました")).toBeVisible();
  await expect(screen.getByText("ビンゴ大会 終了！")).toBeVisible();

  // CSV
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV を書き出す" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const csv = (await (await download.createReadStream()).toArray()).join("");
  expect(csv).toContain("順位,ニックネーム");
  for (const name of ["あおい", "ひかる", "そら"]) expect(csv).toContain(name);

  await closeAll([screenContext, ...players.map((p) => p.context)]);
});

test("再接続：オフラインの間に引いた番号が、戻ったときに追いつく", async ({ page, browser }) => {
  const { roomId, hostUrl } = await createRoom(page, "E2E 再接続");
  await page.goto(hostUrl);
  const [code] = await issueCodes(page, 1);
  const network = networkSwitch();
  const player = await joinAsPlayer(browser, roomId, code, "みなと", network.install);
  await page.getByRole("button", { name: "開始" }).click();
  await draw(page);

  await network.goOffline();
  await expect(player.page.getByText("○ 再接続中")).toBeVisible();
  await draw(page);
  await draw(page);
  // 切れている間の番号はまだ出ていない
  await expect(player.page.getByText(/抽選 1回/)).toBeVisible();
  network.goOnline();

  await expect(player.page.getByText(/抽選 3回/)).toBeVisible({ timeout: 30_000 });
  await expect(player.page.getByText("● 接続中")).toBeVisible();
  await expect(player.page.getByText("切れている間に 2個の番号が引かれました")).toBeVisible();
  // 戻ったあとのカードのマークは、司会画面で見えている番号と一致する
  const drawn = (await page.locator("p", { hasText: "引いた番号：" }).textContent())!.match(/\d+/g)!.map(Number);
  const cells = await cardCells(player.page);
  for (const cell of cells) {
    const n = Number(cell.split(" ")[0]);
    if (Number.isNaN(n)) continue; // FREE
    expect(cell.includes("マーク済み")).toBe(drawn.includes(n));
  }
  await player.context.close();
});

test("開き直し：同じブラウザでも別のブラウザでも、同じカードに戻る", async ({ page, browser }) => {
  const { roomId, hostUrl } = await createRoom(page, "E2E 開き直し");
  await page.goto(hostUrl);
  const [code] = await issueCodes(page, 1);
  const player = await joinAsPlayer(browser, roomId, code, "ゆう");
  const card = await cardCells(player.page);

  // タブを閉じて開き直す（URL にコードはないが、保存したコードで戻る）
  await player.page.close();
  const reopened = await player.context.newPage();
  await reopened.goto(`/room/${roomId}`);
  await expect(reopened.getByRole("heading", { name: "ゆう さん" })).toBeVisible();
  expect(await cardCells(reopened)).toEqual(card);

  // 別のブラウザでコードを手で入れる
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`/room/${roomId}`);
  await otherPage.getByLabel("参加コード").fill(code.toLowerCase().replace("-", " "));
  await otherPage.getByRole("button", { name: "参加する" }).click();
  await expect(otherPage.getByRole("heading", { name: "ゆう さん" })).toBeVisible();
  expect(await cardCells(otherPage)).toEqual(card);

  await closeAll([player.context, other]);
});

test("確認ポップアップ：「やめる」「いいえ」では何も起きない", async ({ page, browser }) => {
  const roomName = `E2E 確認 ${Date.now()}`;
  const { roomId, hostUrl } = await createRoom(page, roomName);
  await page.goto(hostUrl);
  const [code] = await issueCodes(page, 1);
  const player = await joinAsPlayer(browser, roomId, code, "りん");

  // ルームの削除（管理画面）→「いいえ」。ゲーム中は削除できないので開始の前に確かめる
  const admin = await browser.newPage();
  await admin.goto("/");
  await admin.getByLabel("合言葉").fill(process.env.E2E_ADMIN_PASSPHRASE!);
  await admin.getByRole("button", { name: "開く" }).click();
  const row = admin.getByRole("listitem").filter({ hasText: roomName }).first();
  await row.getByRole("button", { name: "削除" }).click();
  await admin.getByRole("button", { name: "いいえ" }).click();
  await expect(player.page.getByRole("heading", { name: "りん さん" })).toBeVisible();
  await expect(row).toBeVisible();


  await page.getByRole("button", { name: "開始" }).click();

  // 抽選 →「やめる」
  await page.getByRole("button", { name: "抽選", exact: true }).click();
  await expect(page.getByRole("button", { name: "抽選する" })).toBeVisible();
  await page.getByRole("button", { name: "やめる" }).click();
  await expect(page.getByRole("button", { name: "抽選する" })).toHaveCount(0);
  // スペースで開いて Esc でやめる
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "抽選する" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "抽選する" })).toHaveCount(0);
  expect(await drawnCount(page)).toBe(0);

  // 終了 →「いいえ」（最初に選ばれているのは「いいえ」なので Enter でも閉じる）
  await page.getByRole("button", { name: "終了", exact: true }).click();
  await expect(page.getByRole("button", { name: "いいえ" })).toBeFocused();
  await page.getByRole("button", { name: "いいえ" }).click();
  await expect(page.getByText("ゲーム中")).toBeVisible();

  // 参加者の削除 →「いいえ」
  await page.getByRole("tab", { name: "参加者" }).click();
  await page.getByRole("button", { name: "りん の操作" }).click();
  await page.getByRole("menuitem", { name: "削除" }).click();
  await page.getByRole("button", { name: "いいえ" }).click();
  await expect(page.getByText("1人", { exact: true })).toBeVisible();
  await expect(player.page.getByRole("heading", { name: "りん さん" })).toBeVisible();

  await closeAll([player.context, admin.context()]);
});

test("URL の秘密の値：?t= と ?c= はアドレスバーから消える", async ({ page, browser }) => {
  const { roomId, hostUrl } = await createRoom(page, "E2E URL");
  expect(hostUrl).toContain("?t=");
  await page.goto(hostUrl);
  await expect(page.getByRole("tab", { name: "進行" })).toBeVisible();
  expect(page.url()).not.toContain("t=");
  const [code] = await issueCodes(page, 1);

  // 印刷ページは同じタブで開き、トークンは URL に出ない
  await page.getByRole("tab", { name: "参加コード" }).click();
  await page.getByRole("link", { name: "印刷ページを開く" }).click();
  await page.waitForURL(/\/print$/);
  await expect(page.locator("article").getByText(code)).toBeVisible();
  await expect(page.getByRole("button", { name: "印刷する" })).toBeEnabled();

  const player = await joinAsPlayer(browser, roomId, code, "かい");
  expect(player.page.url()).not.toContain("c=");
  await player.context.close();
});
