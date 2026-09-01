/**
 * 実データで通しの検証。
 *
 *   npm run verify:flow
 *
 * verify-schema はローカルのPostgresに当てて権限を見る。
 * verify-remote は未ログインで外から触れないことを見る。
 * ここは「ログインした利用者として実際に使う」層を見る。
 * RPC の引数名、ビューの列名、Storage のパスの決まりが噛み合っているかは
 * ここでしか分からない。
 *
 * 利用者を2件と出品を1件作る。プロジェクトのダッシュボードから消せる。
 * 確認メールをオフにしてから実行すること（オンだとセッションが返らない）。
 */
import { readFile } from 'node:fs/promises';

const results = [];
const record = (area, label, ok, detail) => results.push({ area, label, ok, detail });

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile('.env.local', 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) env[m[1]] ??= m[2].trim();
    }
  } catch {
    /* 環境変数だけで見る */
  }
  return env;
}

const env = await loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('.env.local に URL と公開鍵を入れてから実行してください。');
  process.exit(2);
}
if (key.startsWith('sb_secret_') || /service_role/i.test(key)) {
  console.error('秘密鍵が入っています。公開鍵に直してください。');
  process.exit(2);
}

const isNewKey = key.startsWith('sb_publishable_');

/** 未ログインの呼び出し */
function anonHeaders() {
  return {
    apikey: key,
    'Content-Type': 'application/json',
    ...(isNewKey ? {} : { Authorization: `Bearer ${key}` }),
  };
}

/** ログイン済みの呼び出し。公開鍵は apikey、利用者のJWTは Bearer に載せる */
function userHeaders(token) {
  return { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function call(path, { token, ...init } = {}) {
  const res = await fetch(`${url}${path}`, {
    headers: token ? userHeaders(token) : anonHeaders(),
    ...init,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 本文が JSON でないこともある */
  }
  return { status: res.status, body: text.slice(0, 200), json };
}

async function signUp(email, password) {
  const res = await call('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, data: { handle: email.split('@')[0].slice(0, 20) } }),
  });
  return {
    ok: res.status === 200 && Boolean(res.json?.access_token),
    token: res.json?.access_token ?? null,
    userId: res.json?.user?.id ?? null,
    status: res.status,
    body: res.body,
  };
}

/*
 * Supabase はメールのドメインの実在性まで見るので、作り話のドメインは弾かれる。
 * 確認メールをオフにしてあれば送信は起きないため、実在するドメインを使っても
 * 誰にもメールは届かない。使える最初のものを選ぶ。
 */
const DOMAINS = (env.VERIFY_FLOW_DOMAIN ? [env.VERIFY_FLOW_DOMAIN] : ['gmail.com', 'outlook.com']);
const stamp = Date.now();
const password = `Verify-${stamp}-aA1`;

let a = null;
let usedDomain = null;
for (const domain of DOMAINS) {
  const attempt = await signUp(`infomap.check.${stamp}.a@${domain}`, password);
  if (attempt.ok) {
    a = attempt;
    usedDomain = domain;
    break;
  }
  if (!/email_address_invalid/.test(attempt.body)) {
    record('登録', 'サインアップが通る', false, `HTTP ${attempt.status} ${attempt.body}`);
    break;
  }
}

if (!a) {
  if (!results.length) {
    record(
      '登録',
      'サインアップが通る',
      false,
      `どのドメインも弾かれた（${DOMAINS.join(', ')}）。VERIFY_FLOW_DOMAIN で指定してください`
    );
  }
  report();
  process.exit(1);
}

record('登録', 'サインアップでセッションが返る', true, `${usedDomain} / ${a.userId}`);

const b = await signUp(`infomap.check.${stamp}.b@${usedDomain}`, password);
record('登録', '2人目も作れる', b.ok, b.ok ? b.userId : `HTTP ${b.status} ${b.body}`);

// profiles がトリガで作られているか
const profile = await call(`/rest/v1/profiles?id=eq.${a.userId}&select=id,handle,hit_count`);
const created = Array.isArray(profile.json) && profile.json.length === 1;
record(
  '登録',
  'handle_new_user トリガが profiles を作る',
  created,
  created ? JSON.stringify(profile.json[0]) : `HTTP ${profile.status} ${profile.body}`
);

// 残高は0から始まる（入金の手段を公開していないことの裏づけ）
const balance = await call('/rest/v1/balances?select=available,pending', { token: a.token });
const noBalance = Array.isArray(balance.json) && balance.json.length === 0;
record(
  '残高',
  '新規利用者に残高が付いていない',
  noBalance,
  noBalance ? '0行（台帳が空）' : JSON.stringify(balance.json)
);

// 自分で台帳に書けないこと
const mint = await call('/rest/v1/rpc/post_entry', {
  token: a.token,
  method: 'POST',
  body: JSON.stringify({
    p_user: a.userId,
    p_kind: 'topup',
    p_available: 999999,
    p_pending: 0,
    p_memo: 'probe',
    p_ref: null,
  }),
});
record('残高', 'ログイン済みでも残高を作れない', mint.status !== 200, `HTTP ${mint.status}`);

// ---------------------------------------------------------------- 写真と出品

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const photoPath = `${a.userId}/${stamp}.png`;

const upload = await fetch(`${url}/storage/v1/object/photos/${photoPath}`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${a.token}`, 'Content-Type': 'image/png' },
  body: Buffer.from(PNG, 'base64'),
});
record('写真', '自分のフォルダへ上げられる', upload.ok, `HTTP ${upload.status}`);

// 他人のフォルダへは置けない
const intrude = await fetch(`${url}/storage/v1/object/photos/${a.userId}/steal-${stamp}.png`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${b.token}`, 'Content-Type': 'image/png' },
  body: Buffer.from(PNG, 'base64'),
});
record('写真', '他人のフォルダへは置けない', !intrude.ok, `HTTP ${intrude.status}`);

const pin = await call('/rest/v1/rpc/create_pin', {
  token: a.token,
  method: 'POST',
  body: JSON.stringify({
    p_category: 'shelf_stock',
    p_lat: 35.6985,
    p_lng: 139.7731,
    p_place_label: '御茶ノ水（検証）',
    p_headline: '検証用の出品',
    p_stock: 'in_stock',
    p_payload: '3階の棚に4点ありました',
    p_quantity_note: '残り4点',
    p_photo_path: photoPath,
    p_proof_distance_m: 40,
    p_proof_taken_at: new Date(stamp - 60000).toISOString(),
    p_proof_accuracy_m: 12,
    p_proof_mocked: false,
    p_price: 300,
    p_slot_total: 1,
    p_ttl_minutes: 15,
  }),
});
const pinId = typeof pin.json === 'string' ? pin.json : null;
record('出品', 'create_pin が通る', Boolean(pinId), pinId ?? `HTTP ${pin.status} ${pin.body}`);

if (pinId) {
  // 未購入者に見える形
  const pub = await call(
    `/rest/v1/public_pins?id=eq.${pinId}&select=headline,price,proof_distance_m,proof_mocked,seller_handle`
  );
  const visible = Array.isArray(pub.json) && pub.json.length === 1;
  record(
    '出品',
    'public_pins に出て、撮影の裏づけも見える',
    visible,
    visible ? JSON.stringify(pub.json[0]) : `HTTP ${pub.status} ${pub.body}`
  );

  // 買っていない人に本文が渡らない
  const revealed = await call(`/rest/v1/my_revealed_pins?id=eq.${pinId}&select=payload_text`, {
    token: b.token,
  });
  const hidden = Array.isArray(revealed.json) && revealed.json.length === 0;
  record('出品', '買っていない人に本文が渡らない', hidden, `${revealed.json?.length ?? '?'}行`);

  // 買っていない人は写真の署名URLも取れない
  const sign = await fetch(`${url}/storage/v1/object/sign/photos/${photoPath}`, {
    method: 'POST',
    headers: userHeaders(b.token),
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record('写真', '買っていない人は署名URLを取れない', !sign.ok, `HTTP ${sign.status}`);

  // 出品者は自分の写真の署名URLを取れる
  const signSelf = await fetch(`${url}/storage/v1/object/sign/photos/${photoPath}`, {
    method: 'POST',
    headers: userHeaders(a.token),
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record('写真', '出品者は署名URLを取れる', signSelf.ok, `HTTP ${signSelf.status}`);

  // 残高が無いので買えない。金の判断がサーバー側にあることの裏づけ
  const buy = await call('/rest/v1/rpc/purchase_pin_slot', {
    token: b.token,
    method: 'POST',
    body: JSON.stringify({ p_pin: pinId }),
  });
  record(
    '購入',
    '残高が無いと買えない',
    buy.status !== 200 && /insufficient_balance/.test(buy.body),
    `HTTP ${buy.status} ${buy.body.slice(0, 80)}`
  );

  // 自分の出品は自分では買えない
  const selfBuy = await call('/rest/v1/rpc/purchase_pin_slot', {
    token: a.token,
    method: 'POST',
    body: JSON.stringify({ p_pin: pinId }),
  });
  record(
    '購入',
    '自分の出品は買えない',
    selfBuy.status !== 200 && /own_pin/.test(selfBuy.body),
    `HTTP ${selfBuy.status} ${selfBuy.body.slice(0, 80)}`
  );

  // 他人の出品を取り下げられない
  const steal = await call('/rest/v1/rpc/void_pin', {
    token: b.token,
    method: 'POST',
    body: JSON.stringify({ p_pin: pinId }),
  });
  record('出品', '他人の出品を取り下げられない', steal.status !== 200, `HTTP ${steal.status}`);

  // 出品者は取り下げられる
  const drop = await call('/rest/v1/rpc/void_pin', {
    token: a.token,
    method: 'POST',
    body: JSON.stringify({ p_pin: pinId }),
  });
  record('出品', '出品者は取り下げられる', drop.status === 200 || drop.status === 204,
    `HTTP ${drop.status} ${drop.body.slice(0, 80)}`);
}

// ---------------------------------------------------------------- 依頼

const bounty = await call('/rest/v1/rpc/create_bounty', {
  token: a.token,
  method: 'POST',
  body: JSON.stringify({
    p_category: 'shelf_stock',
    p_lat: 35.6985,
    p_lng: 139.7731,
    p_radius_m: 500,
    p_area_label: '御茶ノ水（検証）',
    p_target_text: '検証用の依頼',
    p_place_hint: null,
    p_photo_wanted: null,
    p_pay_if_absent: true,
    p_reward: 200,
    p_accept_count: 1,
    p_ttl_minutes: 30,
  }),
});
record(
  '依頼',
  '残高が無いと依頼を出せない',
  bounty.status !== 200 && /insufficient_balance/.test(bounty.body),
  `HTTP ${bounty.status} ${bounty.body.slice(0, 80)}`
);

// 集計ビューは誰でも読める（人数の表示に使う）
const stats = await call('/rest/v1/bounty_stats?select=bounty_id,heading_count&limit=1');
record('依頼', 'bounty_stats は公開鍵で読める', stats.status === 200, `HTTP ${stats.status}`);

// ---------------------------------------------------------------- 片付け

await fetch(`${url}/storage/v1/object/photos/${photoPath}`, {
  method: 'DELETE',
  headers: userHeaders(a.token),
});

function report() {
  const width = Math.max(...results.map((r) => r.label.length));
  const lines = [`接続先: ${url}`];
  let area = '';
  for (const r of results) {
    if (r.area !== area) {
      area = r.area;
      lines.push(`\n[${area}]`);
    }
    lines.push(`  ${r.ok ? ' OK ' : 'FAIL'}  ${r.label.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  lines.push('');
  lines.push(`${results.length - failed.length} / ${results.length} 件が期待どおり`);
  if (failed.length) {
    lines.push('\n通らなかった項目:');
    for (const f of failed) lines.push(`  - ${f.label}: ${f.detail}`);
  }
  if (a?.userId) {
    lines.push(
      `\n検証で作った利用者: ${a.userId}${b?.userId ? `, ${b.userId}` : ''}` +
        '\nダッシュボードの Authentication から消せます。'
    );
  }
  console.log(lines.join('\n'));
}

report();
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
