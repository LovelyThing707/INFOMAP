/**
 * 実際に立てた Supabase プロジェクトへ、外から公開鍵で触って権限を確かめる。
 *
 *   npm run verify:remote
 *
 * scripts/verify-schema.mjs はローカルの Postgres に当てて確かめるので、
 * 「PostgREST が実際にどのRPCを外へ出すか」は分からない。ここはそれを見る。
 * 使うのは .env.local の URL と公開鍵だけで、どちらもアプリのバンドルに
 * 入る前提のもの。sb_secret_ / service_role キーは絶対にここへ持ち込まないこと。
 *
 * 鍵は2種類ある。sb_publishable_ が現行で、anon（JWT）は2026年末に廃止予定。
 * ヘッダーの渡し方が違い、新形式を Authorization: Bearer にも入れると
 * JWT として解釈されて Invalid JWT で弾かれる。それを権限による拒否と
 * 読み違えると、開いているのに閉じていると誤判定するので分けて扱う。
 */
import { readFile } from 'node:fs/promises';

const results = [];
const record = (area, label, ok, detail) => results.push({ area, label, ok, detail });

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await readFile('.env.local', 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match) env[match[1]] ??= match[2].trim();
    }
  } catch {
    // .env.local が無ければ環境変数だけで見る
  }
  return env;
}

/**
 * 鍵やヘッダーの渡し方が違うせいで拒否されていないかを見る。
 * それを「権限で閉じている」と読むと、実際は開いているのに合格にしてしまう。
 */
function looksLikeKeyProblem(body) {
  return /invalid jwt|invalid api key|no api key/i.test(body);
}

function report(url, keyKind) {
  const width = Math.max(...results.map((r) => r.label.length));
  const lines = [`接続先: ${url}`, `鍵の種類: ${keyKind}`];
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
    if (failed.some((f) => f.area === 'RPC' || f.area === 'テーブル' || f.area === 'ビュー')) {
      lines.push(
        '\n権限の項目が通っていません。外から触れる状態なので、直すまで公開しないこと。'
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const env = await loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error(
      '.env.local に EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を入れてから実行してください。'
    );
    return 2;
  }
  if (key.startsWith('sb_secret_') || /service_role/i.test(key)) {
    console.error(
      '秘密鍵（sb_secret_ / service_role）が入っています。これは RLS を無視する全権の鍵です。\n' +
        'クライアント用の公開鍵（sb_publishable_ もしくは anon）に直してください。'
    );
    return 2;
  }

  const isNewKey = key.startsWith('sb_publishable_');
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    // 新形式は apikey だけ。旧 anon キーは JWT なので Bearer にも載せる（supabase-js と同じ）
    ...(isNewKey ? {} : { Authorization: `Bearer ${key}` }),
  };
  const keyKind = isNewKey ? 'sb_publishable_（現行）' : 'anon JWT（2026年末に廃止予定）';

  async function call(path, init) {
    const res = await fetch(`${url}/rest/v1${path}`, { headers, ...init });
    let body = '';
    try {
      body = (await res.text()).slice(0, 160);
    } catch {
      body = '';
    }
    return { status: res.status, body };
  }

  /** 外から呼べてはいけないRPC */
  async function rpcMustFail(name, args) {
    const { status, body } = await call(`/rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
    if (looksLikeKeyProblem(body)) {
      record('RPC', `${name} が外から呼べない`, false, `鍵の問題で判定できず: HTTP ${status}`);
      return;
    }
    const ok = status !== 200 && status !== 204;
    record('RPC', `${name} が外から呼べない`, ok, `HTTP ${status} ${ok ? '' : body}`.trim());
  }

  /** 外から読めてはいけないテーブル */
  async function tableMustFail(name) {
    const { status, body } = await call(`/${name}?select=*&limit=1`);
    if (looksLikeKeyProblem(body)) {
      record('テーブル', `${name} が外から読めない`, false, `鍵の問題で判定できず: HTTP ${status}`);
      return;
    }
    const ok = status !== 200;
    record('テーブル', `${name} が外から読めない`, ok, `HTTP ${status} ${ok ? '' : body}`.trim());
  }

  /*
   * まず public_pins が読めることを確かめる。これは2つの役目を持つ。
   *   1. migration が当たっているか
   *   2. 鍵とヘッダーの渡し方が正しいか
   * ここが通らないまま先へ進むと、拒否が権限のせいなのか鍵のせいなのか区別できない。
   */
  const pins = await call('/public_pins?select=id,headline,price&limit=1');
  const applied = pins.status === 200;
  record(
    '前提',
    'public_pins が公開鍵で読める（スキーマと鍵が正しい）',
    applied,
    `HTTP ${pins.status} ${applied ? '' : pins.body}`.trim()
  );

  if (!applied) {
    console.log(report(url, keyKind));
    if (looksLikeKeyProblem(pins.body)) {
      console.log(
        '\n鍵の問題のようです。以降の検証は意味を持たないので中断しました。' +
          '\nsb_publishable_ の鍵は apikey ヘッダーだけで送る必要があります。'
      );
    } else {
      console.log(
        '\nスキーマがまだ当たっていません。migration を当ててから、もう一度実行してください。' +
          '\n  npx supabase login && npx supabase link --project-ref <ref> && npm run db:push'
      );
    }
    return 1;
  }

  await rpcMustFail('post_entry', {
    p_user: '00000000-0000-4000-8000-000000000000',
    p_kind: 'topup',
    p_available: 999999,
    p_pending: 0,
    p_memo: 'probe',
    p_ref: null,
  });
  await rpcMustFail('available_of', { p_user: '00000000-0000-4000-8000-000000000000' });
  await rpcMustFail('run_tick', {});
  await rpcMustFail('handle_new_user', {});
  // 公開しているRPCも、ログインしていなければ通ってはいけない
  await rpcMustFail('purchase_pin_slot', { p_pin: '00000000-0000-4000-8000-000000000000' });

  for (const table of ['pins', 'wallet_entries', 'reports', 'bounty_applications', 'purchases']) {
    await tableMustFail(table);
  }

  const insert = await call('/wallet_entries', {
    method: 'POST',
    body: JSON.stringify({
      user_id: '00000000-0000-4000-8000-000000000000',
      kind: 'topup',
      available_delta: 999999,
      pending_delta: 0,
      memo: 'probe',
    }),
  });
  record(
    'テーブル',
    'wallet_entries へ外から insert できない',
    insert.status !== 201 && insert.status !== 200,
    `HTTP ${insert.status}`
  );

  // 本文が公開ビューに含まれていないこと
  const leak = await call('/public_pins?select=payload_text&limit=1');
  record(
    'ビュー',
    'public_pins から payload_text を選べない',
    leak.status !== 200,
    `HTTP ${leak.status}`
  );

  /*
   * 写真。バケットが private なので、パスを知っていても直接は取れない。
   * ここが開いていると、public_pins が本文を持たない設計が写真側から破られる。
   */
  const object = await fetch(`${url}/storage/v1/object/photos/probe.jpg`, { headers });
  record(
    '写真',
    'photos の中身を公開鍵で直接取れない',
    object.status !== 200,
    `HTTP ${object.status}`
  );

  const listing = await fetch(`${url}/storage/v1/object/list/photos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefix: '', limit: 10 }),
  });
  let listed = [];
  try {
    listed = await listing.json();
  } catch {
    listed = [];
  }
  record(
    '写真',
    'photos の一覧を公開鍵で取れない',
    listing.status !== 200 || !Array.isArray(listed) || listed.length === 0,
    `HTTP ${listing.status} ${Array.isArray(listed) ? `${listed.length}件` : ''}`.trim()
  );

  // 署名URLの発行も、読める権限が無ければ通ってはいけない
  const signed = await fetch(`${url}/storage/v1/object/sign/photos/probe.jpg`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expiresIn: 60 }),
  });
  record('写真', '署名URLを公開鍵で発行できない', signed.status !== 200, `HTTP ${signed.status}`);

  // 定期処理が登録されているか（cron.job は外から読めてはいけない）
  const cron = await call('/rpc/run_tick', { method: 'POST', body: '{}' });
  record('定期処理', 'run_tick は外から起動できない', cron.status !== 200, `HTTP ${cron.status}`);

  /*
   * サインアップで profiles が自動生成されるか。
   *   VERIFY_SIGNUP=you@example.jp npm run verify:remote
   *
   * 利用者を1件作るので既定では走らせない。アドレスを引数で受けるのは、
   * Supabase がドメインの実在性まで見るため（example.com や未登録ドメインは弾かれる）。
   * この確認が要るのは、トリガが動かないまま移行すると「動かないから profiles に
   * insert を許す」ことになり、当たり回数を自己申告できる穴が開くから。
   */
  const signupEmail = process.env.VERIFY_SIGNUP;
  if (signupEmail && signupEmail.includes('@')) {
    const email = signupEmail;
    const signup = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password: `Verify-${Date.now()}`,
        data: { handle: 'verify' },
      }),
    });
    const payload = await signup.json().catch(() => ({}));
    const userId = payload?.user?.id ?? payload?.id ?? null;
    record(
      '登録',
      'サインアップが通る',
      signup.status === 200 && Boolean(userId),
      `HTTP ${signup.status} ${userId ? email : JSON.stringify(payload).slice(0, 120)}`
    );

    if (userId) {
      const profile = await call(`/profiles?id=eq.${userId}&select=id,handle`);
      let created = false;
      try {
        created = JSON.parse(profile.body).length === 1;
      } catch {
        created = false;
      }
      record(
        '登録',
        'handle_new_user トリガが profiles を作る',
        created,
        created ? profile.body : `HTTP ${profile.status} ${profile.body}`
      );
    }
  }

  console.log(report(url, keyKind));
  if (!signupEmail) {
    console.log(
      '\nサインアップと profiles トリガの確認は、利用者を1件作るので既定では走らせていません。' +
        '\n見るときは実在するアドレスを渡してください: VERIFY_SIGNUP=you@example.jp'
    );
  }
  return results.some((r) => !r.ok) ? 1 : 0;
}

// process.exit() は通信のハンドルが残っている状態だと Windows で libuv の
// assertion に当たる。終了コードだけ立てて、自然に終わらせる。
process.exitCode = await main();
