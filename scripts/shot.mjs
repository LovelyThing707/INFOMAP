import { chromium } from 'playwright';

// 表示の確認用。実機を触らずに、地図とシートが崩れていないかを見る。
//   node scripts/shot.mjs /            shots/map.png
//   SHOT_CLICK=販売 node scripts/shot.mjs / shots/sale.png
//
// 環境変数
//   SHOT_CLICK      押してから撮る。'css=' 始まりで CSS セレクタ、'|' 区切りで順に押す
//   SHOT_RELOAD     1 で一度リロードする（保存済みデータから復元する経路）
//   SHOT_AGE_HOURS  保存済みデータの時刻を過去へずらす（期限切れの挙動を見る）
//   SHOT_WHEEL      'x,y,delta' でホイールを回し、スクロール量を報告する
//   SHOT_PORT       開発サーバーのポート（既定 8081）。別設定のサーバーを並べて撮るときに使う

const AREA_CENTER = { latitude: 35.69845, longitude: 139.77313 };

const path = process.argv[2] ?? '/';
const out = process.argv[3] ?? 'shot.png';
const waitMs = Number(process.argv[4] ?? 7000);
const dpr = Number(process.argv[5] ?? 2);
const width = Number(process.argv[6] ?? 430);
const height = Number(process.argv[7] ?? 900);

const browser = await chromium.launch({
  // CI やリモートデスクトップでは GPU がなく、WebGL を使う地図が黙って落ちる
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  geolocation: AREA_CENTER,
  permissions: ['geolocation'],
});

const page = await context.newPage();
const problems = [];
const tiles = { ok: 0, failed: 0, sample: null };

page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  const url = res.url();
  if (!/basemaps|tile|\.png/.test(url)) return;
  if (res.ok()) {
    tiles.ok += 1;
    tiles.sample ??= url;
  } else {
    tiles.failed += 1;
    problems.push(`tile ${res.status()}: ${url}`);
  }
});
page.on('requestfailed', (req) => problems.push(`failed: ${req.url()}`));

const port = process.env.SHOT_PORT ?? '8081';
await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(waitMs);

// 保存済みデータの時刻を過去へずらして、放置したあとの状態を作る。
// 期限で消えることが前提のサービスなので、寿命まわりを確かめる手段が要る。
if (process.env.SHOT_AGE_HOURS) {
  await page.evaluate((hours) => {
    const key = 'infomap:db:v1';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const shift = hours * 3600 * 1000;
    // 保存されている時刻はすべてエポックミリ秒（13桁）。金額や件数と桁が被らない
    localStorage.setItem(
      key,
      raw.replace(/1[0-9]{12}/g, (match) => String(Number(match) - shift))
    );
  }, Number(process.env.SHOT_AGE_HOURS));
  await page.reload({ waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(waitMs);
}

if (process.env.SHOT_RELOAD) {
  await page.reload({ waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(waitMs);
}

const clickSpec = process.env.SHOT_CLICK;
if (clickSpec) {
  for (const step of clickSpec.split('|')) {
    const target = step.startsWith('css=')
      ? page.locator(step.slice(4))
      : page.getByText(step, { exact: false });
    await target
      .first()
      .click({ timeout: 5000 })
      .catch((error) => problems.push(`click "${step}" failed: ${error.message}`));
    await page.waitForTimeout(1800);
  }
}

const wheel = process.env.SHOT_WHEEL;
let wheelResult = null;
if (wheel) {
  const [x, y, delta, times = 1] = wheel.split(',').map(Number);
  const maxScrollTop = () =>
    page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('*')]
          .filter((el) => el.scrollHeight > el.clientHeight + 4)
          .map((el) => el.scrollTop)
      )
    );
  const before = await maxScrollTop();
  await page.mouse.move(x, y);
  // 地図のズームは1回のホイールで数段しか動かないので、必要なら繰り返す
  for (let i = 0; i < times; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1200);
  wheelResult = { at: `${x},${y}`, times, before, after: await maxScrollTop() };
}

// SHOT_CLICK2 はホイールのあとに押す。一覧をスクロールしてから選ぶときに使う
const clickAfter = process.env.SHOT_CLICK2;
if (clickAfter) {
  for (const step of clickAfter.split('|')) {
    const target = step.startsWith('css=')
      ? page.locator(step.slice(4))
      : page.getByText(step, { exact: false });
    await target
      .first()
      .click({ timeout: 5000 })
      .catch((error) => problems.push(`click2 "${step}" failed: ${error.message}`));
    await page.waitForTimeout(1800);
  }
}

// SHOT_DRAG='x1,y1,x2,y2,times' で地図を掴んで動かす。
// 世界地図まで引いた状態で横に回し、ピンが消えないかを見るのに使う
const drag = process.env.SHOT_DRAG;
if (drag) {
  const [x1, y1, x2, y2, times = 1] = drag.split(',').map(Number);
  for (let i = 0; i < times; i += 1) {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    // 一気に飛ばすとドラッグと見なされないので、何度かに分けて動かす
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(x1 + ((x2 - x1) * step) / 8, y1 + ((y2 - y1) * step) / 8);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1200);
}

await page.screenshot({ path: out });

const probe = await page.evaluate(() => ({
  // 保存はブラウザで1つのキーに全部入る。上限（おおむね5MB）までの余裕を見る
  storageKB: Math.round((localStorage.getItem('infomap:db:v1')?.length ?? 0) / 1024),
  leafletPanes: document.querySelectorAll('.leaflet-pane').length,
  tileCount: document.querySelectorAll('.leaflet-tile').length,
  markerCount: document.querySelectorAll('.im-pin').length,
  // 高さが 0 のまま置かれているスクロール領域は、中身が見えず操作もできない
  scrollers: [...document.querySelectorAll('*')]
    .filter((el) => {
      const style = getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    })
    .slice(0, 6)
    .map((el) => {
      const box = el.getBoundingClientRect();
      return `client=${el.clientHeight} scroll=${el.scrollHeight} top=${Math.round(
        box.top
      )} bottom=${Math.round(box.bottom)}`;
    }),
}));

console.log(JSON.stringify({ ...probe, tiles, wheelResult }, null, 1));
console.log(problems.length ? problems.slice(0, 15).join('\n') : 'no console errors');
await browser.close();
