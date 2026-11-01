import { expect, type Browser, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";

const CODE_PATTERN = /[A-Z2-9]{3}-[A-Z2-9]{3}/g;

export function passphrase(): string {
  const value = process.env.E2E_ADMIN_PASSPHRASE;
  if (!value) throw new Error(".dev.vars に ADMIN_PASSPHRASE を入れてください（.dev.vars.example を参照）");
  return value;
}

/** 管理画面でルームを作り、司会用 URL（?t= 付き）を返す */
export async function createRoom(page: Page, name: string): Promise<{ roomId: string; hostUrl: string }> {
  await page.goto("/");
  await page.getByLabel("合言葉").fill(passphrase());
  await page.getByRole("button", { name: "開く" }).click();
  await page.getByPlaceholder(/ルーム名/).fill(name);
  await page.getByRole("button", { name: "作成" }).click();
  const hostUrl = await page.getByLabel("司会用 URL").inputValue();
  const roomId = new URL(hostUrl).pathname.split("/")[2];
  await page.getByRole("button", { name: "閉じる" }).click();
  return { roomId, hostUrl };
}

/** 司会画面の参加コードタブで発行し、一覧に出たコードを返す */
export async function issueCodes(host: Page, count: number): Promise<string[]> {
  await host.getByRole("tab", { name: "参加コード" }).click();
  await host.getByLabel("追加で発行する枚数").fill(String(count));
  await host.getByRole("button", { name: /追加で発行/ }).click();
  const list = host.getByRole("tabpanel").getByRole("list");
  await expect(list.getByText(CODE_PATTERN)).toHaveCount(count);
  const codes = (await list.textContent())?.match(CODE_PATTERN) ?? [];
  await host.getByRole("tab", { name: "進行" }).click();
  return codes;
}

/** 新しいブラウザ（別の端末の代わり）で、個別 QR の URL から参加する */
export async function joinAsPlayer(
  browser: Browser,
  roomId: string,
  code: string,
  nickname: string,
  setup?: (context: BrowserContext) => Promise<void>,
) {
  const context = await browser.newContext();
  await setup?.(context);
  const page = await context.newPage();
  await page.goto(`/room/${roomId}?c=${code}`);
  await page.getByLabel("ニックネーム").fill(nickname);
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page.getByRole("heading", { name: `${nickname} さん` })).toBeVisible();
  return { context, page };
}

/** 抽選の回数（司会画面の「抽選 n / 75 回」） */
export async function drawnCount(host: Page): Promise<number> {
  const text = await host.getByText(/^\d+ \/ 75 回$/).textContent();
  return Number(text?.split(" ")[0]);
}

/** 抽選ボタン → 確認の「抽選する」を押し、番号が1つ増えるまで待つ */
export async function draw(host: Page) {
  const before = await drawnCount(host);
  // 前の抽選から3秒は押せない（ボタンに残り秒数が出る）
  const button = host.getByRole("button", { name: "抽選", exact: true });
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  // 確認は 0.5秒たってから押せるようになる
  await host.getByRole("button", { name: "抽選する" }).click();
  await expect(host.getByText(`${before + 1} / 75 回`, { exact: true })).toBeVisible();
}

/** カードの数字（マークの有無を含む）。同じカードかを比べるのに使う */
export async function cardCells(page: Page): Promise<string[]> {
  return page.getByRole("table", { name: "ビンゴカード" }).getByRole("cell").evaluateAll((cells) =>
    cells.map((c) => c.querySelector("[aria-label]")?.getAttribute("aria-label") ?? c.textContent ?? ""),
  );
}

export async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((c) => c.close()));
}

/**
 * ルームへの WebSocket を仲介して、テストから「通信が切れた」状態を作る。
 * （Chromium のオフライン切り替えでは、開いている WebSocket は切れないため）
 */
export function networkSwitch() {
  let online = true;
  const open = new Set<WebSocketRoute>();
  return {
    async install(context: BrowserContext) {
      await context.routeWebSocket(/\/agents\//, (ws) => {
        if (!online) {
          // つなぎ直そうとしても失敗させる（4000番台はクライアントが諦めるので使わない）
          void ws.close({ code: 1011, reason: "offline" });
          return;
        }
        ws.connectToServer();
        open.add(ws);
      });
    },
    async goOffline() {
      online = false;
      await Promise.all([...open].map((ws) => ws.close({ code: 1011, reason: "offline" })));
      open.clear();
    },
    goOnline() {
      online = true;
    },
  };
}
