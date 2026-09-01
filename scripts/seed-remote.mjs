/**
 * Supabase 側にデモ用のデータを入れる。
 *
 *   npm run seed:remote
 *
 * 空の地図から触ると、何が正しく動いているのか分からない。
 * 出品・依頼・応募・購入・判定を一通り入れて、触れる状態にする。
 *
 * 見本の内容は src/data/seed.ts の SEED_PINS / SEED_BOUNTIES をそのまま読む。
 * 書き写すと片方だけ直して食い違う状態が必ず起きるため、複製しない。
 *
 * 入金の手段はアプリにもAPIにも公開していない（残高を作れる口を1つも開けない、
 * というのがこのプロジェクトの前提）。そのため残高が要るもの（依頼・購入）は、
 * 表示される SQL をダッシュボードで一度実行してから、もう一度このスクリプトを
 * 走らせる形になる。2回目は既存のアカウントにログインし直すので重複しない。
 *
 * 確認メールをオフにしてから実行すること。
 */
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- 接続

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

const projectRef = new URL(url).hostname.split('.')[0];
const isNewKey = key.startsWith('sb_publishable_');
const anonHeaders = {
  apikey: key,
  'Content-Type': 'application/json',
  ...(isNewKey ? {} : { Authorization: `Bearer ${key}` }),
};
const userHeaders = (token) => ({
  apikey: key,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function api(path, { token, ...init } = {}) {
  const res = await fetch(`${url}${path}`, {
    headers: token ? userHeaders(token) : anonHeaders,
    ...init,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 本文が JSON でないこともある */
  }
  return { ok: res.ok, status: res.status, body: text.slice(0, 160), json };
}

const rpc = (name, args, token) =>
  api(`/rest/v1/rpc/${name}`, { token, method: 'POST', body: JSON.stringify(args) });

/** 件数が多いので少しだけ並べる。増やすと Storage 側で詰まる */
async function pool(items, size, worker) {
  const queue = [...items];
  const done = [];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        done.push(await worker(item));
      }
    })
  );
  return done;
}

// ---------------------------------------------------------------- 写真

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/**
 * 単色のPNGを作る。デモの写真は「買うと出てくる」ことの確認用なので、
 * 中身は色の違いだけで足りる。外部の画像を持ち込まずに済ませたいので自分で組む。
 * 見本の hue をそのまま使うので、ローカル実装の見え方と色が揃う。
 */
function solidPng(size, hue) {
  const [r, g, b] = hslToRgb(hue / 360, 0.5, 0.62);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // トゥルーカラー
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const off = y * stride;
    raw[off] = 0; // フィルタなし
    for (let x = 0; x < size; x += 1) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadPhoto(token, ownerId, hue) {
  const path = `${ownerId}/${crypto.randomUUID()}.png`;
  const res = await fetch(`${url}/storage/v1/object/photos/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: solidPng(96, hue),
  });
  return res.ok ? path : null;
}

// ---------------------------------------------------------------- アカウント

const PASSWORD = 'Infomap-demo-2026';
const HANDLES = ['かな', 'りん', 'しょう', 'めい', 'たく', 'ゆき', 'とも', 'さき'];

/*
 * Supabase はメールのドメインの実在性まで見るので、作り話のドメインは弾かれる。
 * mailinator は公開の捨てアドで、誰かの私書箱を占有しない。
 * 確認メールをオフにしてあれば送信自体が起きない。
 */
const DOMAINS = env.SEED_DOMAIN ? [env.SEED_DOMAIN] : ['mailinator.com', 'gmail.com'];

async function signIn(email) {
  const res = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return res.json?.access_token
    ? { token: res.json.access_token, userId: res.json.user.id }
    : null;
}

async function signUp(email, handle) {
  const res = await api('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, data: { handle } }),
  });
  return res.json?.access_token
    ? { token: res.json.access_token, userId: res.json.user.id }
    : { error: `HTTP ${res.status} ${res.body}` };
}

let domain = null;
const users = [];

for (const [index, handle] of HANDLES.entries()) {
  let account = null;
  for (const candidate of domain ? [domain] : DOMAINS) {
    const email = `infomap.demo.${index + 1}@${candidate}`;
    account = await signIn(email);
    if (!account) {
      const created = await signUp(email, handle);
      if (created.error) {
        if (/email_address_invalid/.test(created.error)) continue;
        console.error(`${email} を作れませんでした: ${created.error}`);
        process.exit(1);
      }
      account = created;
    }
    domain = candidate;
    users.push({ ...account, handle, email });
    break;
  }
  if (!account) {
    console.error(`使えるメールのドメインがありません（${DOMAINS.join(', ')}）。`);
    console.error('SEED_DOMAIN=... で指定してください。');
    process.exit(1);
  }
}

console.log(`アカウント: ${users.length}件（@${domain}）`);

async function balanceOf(user) {
  const res = await api('/rest/v1/balances?select=available', { token: user.token });
  return res.json?.[0]?.available ?? 0;
}

const balances = await Promise.all(users.map(balanceOf));
const funded = balances.filter((b) => b > 0).length;
console.log(`残高: ${users.map((u, i) => `${u.handle}=${balances[i]}`).join(' ')}`);

const topUpSql = [
  '  insert into public.wallet_entries (user_id, kind, available_delta, pending_delta, memo)',
  "  select id, 'topup', 20000, 0, 'デモ用の初期残高'",
  `  from auth.users where email like 'infomap.demo.%@${domain}'`,
  '    and id not in (select user_id from public.wallet_entries);',
];

// ---------------------------------------------------------------- 見本の読み取り

/**
 * seed.ts の配列リテラルを取り出して評価する。
 * 中身はオブジェクトリテラルだけなので、識別子 ME を実値へ置き換えれば
 * そのまま JavaScript の式として通る。
 */
async function readSeedArray(name) {
  const source = await readFile('src/data/seed.ts', 'utf8');
  const start = source.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} が見つかりません`);
  const open = source.indexOf('[', start);
  const close = source.indexOf('\n];', open);
  if (open < 0 || close < 0) throw new Error(`${name} の範囲を取れません`);
  const literal = source.slice(open, close + 2).replace(/\bME\b/g, "'u_me'");
  return new Function(`return ${literal}`)();
}

/** 東京圏（御茶ノ水から30km）の外は対象外なので入れない */
function insideArea(lat, lng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const [cLat, cLng] = [35.69, 139.75];
  const dLat = toRad(lat - cLat);
  const dLng = toRad(lng - cLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(cLat)) * Math.cos(toRad(lat));
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))) <= 30000;
}

/**
 * create_pin が受ける期限は 15 / 30 / 60 / 無期限。
 * 見本が時計で全部消えないよう、長いものは無期限へ寄せる。
 * 短いものだけ期限つきで残し、急ぎの色が見えるようにする。
 */
function pinTtl(minutes) {
  if (minutes <= 20) return 15;
  if (minutes <= 45) return 30;
  return null;
}

/** create_bounty が受ける期限は30/60/120分だけ */
function bountyTtl(minutes) {
  if (minutes <= 45) return 30;
  if (minutes <= 90) return 60;
  return 120;
}

/** 見本の出品者idを、デモのアカウントへ均等に割り当てる */
function ownerFor(seedId) {
  let hash = 0;
  for (const ch of seedId) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return users[hash % users.length];
}

const seedPins = (await readSeedArray('SEED_PINS')).filter(
  // 取り下げ済みの見本は、作ってから取り下げる意味が薄いので入れない
  (p) => !p.voided && insideArea(p.lat, p.lng)
);
const seedBounties = (await readSeedArray('SEED_BOUNTIES')).filter(
  // 期限切れ・取り下げ済みの見本は、いま作っても再現できない
  (b) => !b.close && insideArea(b.lat, b.lng)
);

// ---------------------------------------------------------------- 出品

const existing = await api('/rest/v1/public_pins?select=id');
const pinCount = Array.isArray(existing.json) ? existing.json.length : 0;

if (pinCount >= 60) {
  console.log(`出品はすでに${pinCount}件あるので追加しません。`);
} else {
  const made = await pool(seedPins, 8, async (spec) => {
    const user = ownerFor(spec.id);
    const path = await uploadPhoto(user.token, user.userId, spec.hue);
    if (!path) return null;

    const res = await rpc(
      'create_pin',
      {
        p_category: 'shelf_stock',
        p_lat: spec.lat,
        p_lng: spec.lng,
        p_place_label: spec.place,
        p_headline: spec.headline,
        p_stock: spec.stock,
        p_payload: spec.payload,
        p_quantity_note: spec.qty,
        p_photo_path: path,
        // 撮影の裏づけ。座標ではなく距離で渡す。
        // farProof は「離れた場所で撮った」見本なので判定に引っかかる距離にする
        p_proof_distance_m: spec.noProof ? null : spec.farProof ? 600 : 30 + Math.random() * 90,
        p_proof_taken_at: spec.noProof ? null : new Date(Date.now() - 90 * 1000).toISOString(),
        p_proof_accuracy_m: spec.noProof ? null : spec.farProof ? 40 : 9 + Math.random() * 12,
        p_proof_mocked: false,
        p_price: spec.price,
        p_slot_total: spec.slots,
        p_ttl_minutes: pinTtl(spec.ttlMin),
      },
      user.token
    );
    return typeof res.json === 'string' ? res.json : null;
  });
  const ok = made.filter(Boolean).length;
  console.log(`出品: ${ok}件（見本${seedPins.length}件のうち）`);
}

if (funded === 0) {
  console.log(
    [
      '',
      '残高がまだありません。依頼と購入はここから先へ進めないので、',
      'SQL Editor で次を1回実行してから、もう一度このコマンドを実行してください。',
      '',
      ...topUpSql,
      '',
      'あなた自身のアカウントにも入れる場合は、続けてこれも実行してください。',
      '',
      '  insert into public.wallet_entries (user_id, kind, available_delta, pending_delta, memo)',
      "  select id, 'topup', 10000, 0, '動作確認用'",
      "  from auth.users where email = 'あなたのアドレス';",
      '',
      `SQL Editor: https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    ].join('\n')
  );
  process.exit(0);
}

if (funded < users.length) {
  console.log(
    [
      '',
      `残高があるのは${funded}/${users.length}人です。増やしたアカウントに入れるには、`,
      'SQL Editor で次を実行してください（すでに残高がある人は二重に入りません）。',
      '',
      ...topUpSql,
      '',
    ].join('\n')
  );
}

// ---------------------------------------------------------------- 依頼

const openBounties = await api('/rest/v1/bounties?select=id&status=eq.open');
const bountyCount = Array.isArray(openBounties.json) ? openBounties.json.length : 0;

if (bountyCount >= 25) {
  console.log(`依頼はすでに${bountyCount}件あるので追加しません。`);
} else {
  const created = await pool(seedBounties, 6, async (spec) => {
    const user = ownerFor(spec.id);
    if (!user) return null;
    const res = await rpc(
      'create_bounty',
      {
        p_category: 'shelf_stock',
        p_lat: spec.lat,
        p_lng: spec.lng,
        p_radius_m: spec.radiusM,
        p_area_label: spec.areaLabel,
        p_target_text: spec.target,
        p_place_hint: spec.placeHint ?? null,
        p_photo_wanted: spec.photoWanted ?? null,
        p_pay_if_absent: !spec.noPayIfAbsent,
        p_reward: spec.reward,
        p_accept_count: spec.acceptCount,
        p_ttl_minutes: bountyTtl(spec.ttlMin),
      },
      user.token
    );
    return typeof res.json === 'string' ? { id: res.json, requester: user.userId } : null;
  });
  const madeBounties = created.filter(Boolean);
  console.log(`依頼: ${madeBounties.length}件（見本${seedBounties.length}件のうち）`);

  /*
   * 「向かっている人数」を出すために応募を入れる。
   * 同時に持てる応募は5件までなので、先頭のいくつかに絞る。
   * ここが埋まっていないと、殺到を抑える表示（3人以上で警告色）が見られない。
   */
  let claims = 0;
  for (const bounty of madeBounties.slice(0, 14)) {
    const applicants = users.filter((u) => u.userId !== bounty.requester).slice(0, 3);
    for (const applicant of applicants) {
      const res = await rpc(
        'apply_to_bounty',
        { p_bounty: bounty.id, p_distance_m: Math.round(150 + Math.random() * 1800) },
        applicant.token
      );
      if (typeof res.json === 'string') claims += 1;
    }
  }
  console.log(`応募（向かっている）: ${claims}件`);
}

// ---------------------------------------------------------------- 購入と判定

/*
 * 出品者に評価が付いた状態にする。
 * 「当たり外れの割合」が出ていないと、買うかどうかの判断材料が見えない。
 */
const sellable = await api(
  '/rest/v1/public_pins?select=id,seller_id,price&order=created_at.desc&limit=45'
);
const alreadyJudged = await api('/rest/v1/purchases?select=id', { token: users[0].token });
const judgedCount = Array.isArray(alreadyJudged.json) ? alreadyJudged.json.length : 0;

let deals = 0;
if (judgedCount >= 15) {
  console.log(`購入と判定はすでに入っているので追加しません。`);
} else {
  for (const pin of Array.isArray(sellable.json) ? sellable.json : []) {
    const buyer = users.find((u) => u.userId !== pin.seller_id);
    if (!buyer) continue;
    const bought = await rpc('purchase_pin_slot', { p_pin: pin.id }, buyer.token);
    if (typeof bought.json !== 'string') continue;
    deals += 1;
    // 5件に1件だけ「違っていた」にして、スコアに幅を作る
    const miss = deals % 5 === 0;
    await rpc(
      'submit_verdict',
      {
        p_purchase: bought.json,
        p_verdict: miss ? 'miss' : 'hit',
        p_reason: miss ? 'gone' : null,
      },
      buyer.token
    );
  }
  console.log(`購入と判定: ${deals}件`);
}

// ---------------------------------------------------------------- 横浜駅西口のコメント見本

const yokohamaComments = [
  {
    handle: 'かな',
    body: '西口改札から特設カウンター、どっちに歩けば着きますか',
    answer: 'きた改札を出て右です。ヨドバシ側の1F、赤い幕が見えます',
  },
  {
    handle: 'りん',
    body: '抽選は本日分だけですか。明日の分も並んでいますか',
    answer: '今日の夕方までの分です。明日の受付は別列なので、今日の掲示だけ撮ってください',
  },
  {
    handle: 'しょう',
    body: '受付終了の紙が出ていたら、その写真だけで報酬は出ますか',
    answer: '出します。締切時刻が写っていると助かります',
  },
  {
    handle: 'めい',
    body: '整理券、いま何番台まで配っていますか。概算でいいですか',
    answer: null,
  },
  {
    handle: 'たく',
    body: '列が駅ナカまで伸びていたら、どこまで写せばいいですか',
    answer: null,
  },
];

const yokohama = await api(
  '/rest/v1/bounties?area_label=eq.' +
    encodeURIComponent('横浜駅西口') +
    '&reward=eq.500&status=eq.open&select=id,requester_id&limit=5'
);
const yokohamaRow = Array.isArray(yokohama.json) ? yokohama.json[0] : null;
if (!yokohamaRow) {
  console.log('横浜駅西口・500円の依頼が見つからないので、コメント見本は入れません。');
} else {
  const existingQ = await api(
    `/rest/v1/bounty_questions?bounty_id=eq.${yokohamaRow.id}&select=id,body`
  );
  const already = new Set((existingQ.json ?? []).map((q) => q.body));
  const requester = users.find((u) => u.userId === yokohamaRow.requester_id);
  let posted = 0;
  for (const sample of yokohamaComments) {
    if (already.has(sample.body)) continue;
    const asker = users.find((u) => u.handle === sample.handle);
    if (!asker || asker.userId === yokohamaRow.requester_id) continue;
    const asked = await rpc('ask_question', { p_bounty: yokohamaRow.id, p_body: sample.body }, asker.token);
    if (typeof asked.json !== 'string') continue;
    posted += 1;
    if (sample.answer && requester) {
      await rpc('answer_question', { p_question: asked.json, p_answer: sample.answer }, requester.token);
    }
  }
  console.log(`横浜駅西口のコメント: ${posted}件追加`);
}

// ---------------------------------------------------------------- まとめ

const [pins, bounties, stats] = await Promise.all([
  api('/rest/v1/public_pins?select=id'),
  api('/rest/v1/bounties?select=id&status=eq.open'),
  api('/rest/v1/bounty_stats?select=heading_count'),
]);
const heading = Array.isArray(stats.json)
  ? stats.json.reduce((sum, s) => sum + (s.heading_count ?? 0), 0)
  : 0;

console.log(
  [
    '',
    `いま地図に出るもの: 出品 ${pins.json?.length ?? '?'}件 / 依頼 ${bounties.json?.length ?? '?'}件`,
    `向かっている人の総数: ${heading}人`,
    '',
    'http://localhost:8081 を開き直してください。',
    '地図の上のトグルで「募集」と「販売」が切り替わります（既定は募集）。',
    '',
    `デモのアカウント（パスワードはすべて ${PASSWORD}）:`,
    ...users.map((u) => `  ${u.handle}  ${u.email}`),
  ].join('\n')
);
