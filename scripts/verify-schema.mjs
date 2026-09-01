/**
 * supabase/migrations/ を実際の Postgres に当てて、権限の境界を実測する。
 *
 *   node scripts/verify-schema.mjs
 *
 * PGlite（WASM版 Postgres）を使うので Docker もクラウドのプロジェクトも要らない。
 * 見たいのは「関数を書いた時点で APIを公開したことになる」という Supabase の性質に対して、
 * migration 末尾の revoke / grant が本当に効いているか。
 *
 * Supabase の素の状態を再現するため、migration を当てる前に
 * `alter default privileges ... grant all ... to anon, authenticated` を入れてある。
 * これが Supabase 側の既定なので、入れずに試すと通って当然の甘い検証になる。
 */
import { readdir, readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const db = await PGlite.create();
const results = [];
const note = [];

function record(area, label, ok, detail) {
  results.push({ area, label, ok, detail });
}

/** そのロールで実行して、拒否されることを期待する */
async function denied(area, label, role, sql, uid = null) {
  await as(role, uid);
  try {
    await db.query(sql);
    record(area, label, false, '通ってしまった');
  } catch (error) {
    const message = String(error.message).split('\n')[0];
    // RLS は書き込みでは例外を出す（読み取りと削除では行を絞るだけで例外にならない）
    const isPermission = /permission denied|must be owner|not allowed|row-level security/i.test(
      message
    );
    record(area, label, isPermission, isPermission ? message : `別の理由で失敗: ${message}`);
  }
}

/** そのロールで実行して、通ることを期待する */
async function allowed(area, label, role, sql, uid = null) {
  await as(role, uid);
  try {
    const res = await db.query(sql);
    record(area, label, true, `${res.rows.length}行`);
    return res.rows;
  } catch (error) {
    record(area, label, false, String(error.message).split('\n')[0]);
    return null;
  }
}

async function as(role, uid) {
  await db.exec('reset role;');
  await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', uid ?? '']);
  if (role) await db.exec(`set role ${role};`);
}

// ------------------------------------------------------------------ 前提

// Supabase が用意している部分。auth.uid() は JWT の sub を読む形に合わせる
await db.exec(`
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;

  create table auth.users (
    id                 uuid primary key,
    email              text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  -- Storage の最小構成。列と関数は Supabase 側に合わせてある。
  -- ここが無いと写真の migration を検証できない
  create table storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id        uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets,
    name      text not null,
    owner_id  text
  );

  alter table storage.objects enable row level security;

  -- 'uid/file.jpg' を {uid} に分解する。先頭のフォルダ名で持ち主を判定するため
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $$
    select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
  $$;

  -- pg_cron の最小構成。PGlite には拡張が無いので、登録されたかだけ見られる形にする
  create schema if not exists cron;

  create table cron.job (
    jobid    bigserial primary key,
    jobname  text unique,
    schedule text,
    command  text
  );

  create or replace function cron.schedule(job_name text, schedule text, command text)
  returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command)
    values (job_name, schedule, command) returning jobid;
  $$;

  create or replace function cron.unschedule(job_name text)
  returns boolean language sql as $$
    delete from cron.job where jobname = job_name;
    select true;
  $$;

  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;

  -- Supabase では Storage のAPIが利用者のJWTで RLS を通す。
  -- テーブル権限は開いていて、絞っているのはポリシー側なので、そこを再現する
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;

  -- ここが要点。Supabase は public スキーマの新規オブジェクトを
  -- anon / authenticated に自動で開ける設定を最初から持っている。
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

// ファイル名を決め打ちにせず、CLI と同じ順序（名前の昇順）で全部当てる。
// migration を足したときに、この検証が古いものだけを見続ける事故を防ぐ
const dir = 'supabase/migrations';
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
let sql = (
  await Promise.all(files.map((f) => readFile(`${dir}/${f}`, 'utf8')))
).join('\n');
note.push(`当てた migration: ${files.join(', ')}`);

// PGlite には拡張が同梱されていないので、create extension は落とす。
// pgcrypto の gen_random_uuid() は PG13 以降の組み込みなので影響しない。
// pg_cron は上で最小構成を用意してあり、登録されたかどうかは確認できる。
const extensions = sql.match(/create extension[^;]+;/g) ?? [];
if (extensions.length) {
  sql = sql.replace(/create extension[^;]+;/g, '-- (検証時は除外)');
  note.push(`create extension を${extensions.length}件除外（拡張は PGlite に無い）`);
}

try {
  await db.exec(sql);
  record('適用', 'migration がエラーなく通る', true, `${files.length}ファイル / ${sql.split('\n').length}行`);
} catch (error) {
  record('適用', 'migration がエラーなく通る', false, String(error.message).split('\n')[0]);
  console.log(report());
  process.exit(1);
}

// ------------------------------------------------------------------ 下ごしらえ

await db.exec('reset role;');
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'a@example.com', '{"handle":"seller"}'),
    ('${B}', 'b@example.com', '{"handle":"buyer"}'),
    ('${C}', 'c@example.com', '{"handle":"third"}'),
    ('${D}', 'd@example.com', '{"handle":"fourth"}');
`);

const profiles = await db.query('select id, handle from public.profiles order by handle');
record(
  '登録',
  'auth.users への insert で profiles が自動生成される',
  profiles.rows.length === 4,
  profiles.rows.map((r) => r.handle).join(', ') || '0件'
);

// 残高を入れる。post_entry は外から呼べないので、ここは所有者として直接入れる
for (const user of [B, C, D]) {
  await db.query(
    `insert into public.wallet_entries (user_id, kind, available_delta, pending_delta, memo)
     values ($1, 'topup', 5000, 0, '検証用')`,
    [user]
  );
}

const PHOTO = `${A}/shelf.jpg`;
const pin = await db.query(
  `insert into public.pins (
     seller_id, category, lat, lng, place_label, headline, stock_state,
     payload_text, photo_path, price, slot_total, expires_at
   ) values ($1, 'shelf_stock', 35.7, 139.76, '御茶ノ水', '在庫あり', 'in_stock',
     '3階の棚に4点', $2, 300, 1, now() + interval '30 minutes')
   returning id`,
  [A, PHOTO]
);
const pinId = pin.rows[0].id;

// 出品者が置いた写真の実体。Storage のポリシーを試すために入れておく
await db.query(
  `insert into storage.objects (bucket_id, name, owner_id) values ('photos', $1, $2)`,
  [PHOTO, A]
);

// ------------------------------------------------------------------ 検証

// 0. public スキーマの全関数を機械的に突き合わせる。
// 個別テストだけだと、あとから足した関数を見落とす
const INTERNAL_ONLY = [
  'post_entry',      // 呼べると残高を無限に作れる
  'available_of',    // 他人の残高を引ける
  'run_tick',        // 金を動かす処理を外部から起動できる
  'handle_new_user', // profiles を任意の内容で作れる
  'platform_fee',
  'distance_m',
  'assert_own_photo_path', // 出品・報告の写真パス検査。外から直接呼ぶ必要はない
];

await db.exec('reset role;');
const funcs = await db.query(`
  select p.proname,
         has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_ok,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by p.proname
`);

const anonCallable = funcs.rows.filter((r) => r.anon_ok).map((r) => r.proname);
record('関数の公開範囲', 'anon から呼べる関数が1つも無い', anonCallable.length === 0,
  anonCallable.length ? `呼べる: ${anonCallable.join(', ')}` : `${funcs.rows.length}個すべて閉じている`);

const internalOpen = funcs.rows
  .filter((r) => INTERNAL_ONLY.includes(r.proname) && r.auth_ok)
  .map((r) => r.proname);
record('関数の公開範囲', '内部専用の関数が authenticated からも閉じている',
  internalOpen.length === 0,
  internalOpen.length ? `開いている: ${internalOpen.join(', ')}` : INTERNAL_ONLY.join(', '));

const exposed = funcs.rows.filter((r) => r.auth_ok).map((r) => r.proname);
note.push(`authenticated に公開している関数は${exposed.length}個`);

// 1. 台帳へ書く関数と内部処理。ここが開いていると残高を無限に作れる
const postEntry = `select public.post_entry('${B}', 'topup', 999999, 0, 'x', null)`;
await denied('関数', 'post_entry を anon が呼べない', 'anon', postEntry);
await denied('関数', 'post_entry を authenticated が呼べない', 'authenticated', postEntry, B);
await denied('関数', 'available_of を authenticated が呼べない', 'authenticated',
  `select public.available_of('${A}')`, B);
await denied('関数', 'run_tick を authenticated が呼べない', 'authenticated',
  'select public.run_tick()', B);

// 2. 公開してよい関数は、ちゃんと呼べる必要がある
await denied('関数', 'purchase_pin_slot を anon が呼べない', 'anon',
  `select public.purchase_pin_slot('${pinId}')`);

// 3. テーブルへの直接アクセス
await denied('テーブル', 'pins を anon が直接読めない', 'anon', 'select * from public.pins');
await denied('テーブル', 'pins を authenticated が直接読めない', 'authenticated',
  'select * from public.pins', B);
await denied('テーブル', 'pins へ authenticated が insert できない', 'authenticated',
  `insert into public.pins (seller_id, category, lat, lng, place_label, headline,
     stock_state, payload_text, price, slot_total, expires_at)
   values ('${B}', 'shelf_stock', 35.7, 139.76, 'x', 'y', 'in_stock', 'z', 100, 1,
     now() + interval '10 minutes')`, B);
await denied('テーブル', 'wallet_entries へ authenticated が insert できない', 'authenticated',
  `insert into public.wallet_entries (user_id, kind, available_delta, pending_delta, memo)
   values ('${B}', 'topup', 999999, 0, 'x')`, B);
await denied('テーブル', 'wallet_entries を anon が読めない', 'anon',
  'select * from public.wallet_entries');
await denied('テーブル', 'reports を anon が読めない', 'anon', 'select * from public.reports');

// 4. ビューの列と絞り込み
const cols = await db.query(
  `select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'public_pins'`
);
const leaked = cols.rows
  .map((r) => r.column_name)
  .filter((c) => ['payload_text', 'photo_path', 'stock_state', 'quantity_note'].includes(c));
record('ビュー', 'public_pins に本文・写真・在庫状態が無い', leaked.length === 0,
  leaked.length ? `漏れている列: ${leaked.join(', ')}` : `${cols.rows.length}列すべて公開可`);

await allowed('ビュー', 'public_pins は anon でも読める', 'anon',
  'select id, headline, price from public.public_pins');

const balB = await allowed('ビュー', 'balances は本人の分だけ返す', 'authenticated',
  'select user_id, available from public.balances', B);
record('ビュー', 'balances に他人の行が出ない',
  balB !== null && balB.length === 1 && balB[0].user_id === B,
  balB ? `${balB.length}行: ${balB.map((r) => r.available).join(',')}` : '取得できず');

await as('authenticated', C);
const revealedBefore = await db.query('select count(*)::int as n from public.my_revealed_pins');
record('ビュー', '買っていない人に my_revealed_pins が中身を返さない',
  revealedBefore.rows[0].n === 0, `${revealedBefore.rows[0].n}行`);

// 5. 購入の流れが、権限を締めた状態でも通るか
const bought = await allowed('取引', 'authenticated は purchase_pin_slot を呼べる',
  'authenticated', `select public.purchase_pin_slot('${pinId}') as id`, B);

await as('authenticated', B);
const revealedAfter = await db.query('select payload_text from public.my_revealed_pins');
record('取引', '買った人には本文が届く',
  revealedAfter.rows.length === 1 && revealedAfter.rows[0].payload_text === '3階の棚に4点',
  revealedAfter.rows[0]?.payload_text ?? '取得できず');

/*
 * 写真。public_pins が本文を持たないことと対になっていて、
 * 「パスだけ漏れても中身は取れない」状態になっているかを見る。
 */
await db.exec('reset role;');
const bucket = await db.query(`select public from storage.buckets where id = 'photos'`);
record('写真', 'photos バケットが private', bucket.rows[0]?.public === false,
  bucket.rows.length ? `public=${bucket.rows[0].public}` : 'バケットが無い');

await denied('写真', '他人のフォルダへ置けない', 'authenticated',
  `insert into storage.objects (bucket_id, name) values ('photos', '${A}/steal.jpg')`, C);

await as('authenticated', C);
const ownFolder = await db.query(
  `insert into storage.objects (bucket_id, name) values ('photos', '${C}/mine.jpg') returning name`
);
record('写真', '自分のフォルダへは置ける', ownFolder.rows.length === 1, ownFolder.rows[0]?.name ?? '');

await as('authenticated', C);
const notBought = await db.query(
  `select name from storage.objects where name = '${PHOTO}'`
);
record('写真', '買っていない人は出品者の写真を読めない', notBought.rows.length === 0,
  `${notBought.rows.length}行`);

await as('authenticated', B);
const bought2 = await db.query(`select name from storage.objects where name = '${PHOTO}'`);
record('写真', '買った人は写真を読める', bought2.rows.length === 1, `${bought2.rows.length}行`);

await as('authenticated', A);
const seller = await db.query(`select name from storage.objects where name = '${PHOTO}'`);
record('写真', '出品者は自分の写真を読める', seller.rows.length === 1, `${seller.rows.length}行`);

/*
 * 削除はポリシーが行を除外するだけなので、例外は出ず0行削除になる。
 * 「エラーが出たか」ではなく「消えていないか」で見る必要がある。
 */
await as('authenticated', C);
await db.query(`delete from storage.objects where name = '${PHOTO}'`);
await db.exec('reset role;');
const survived = await db.query(`select name from storage.objects where name = '${PHOTO}'`);
record('写真', '他人の写真を消せない', survived.rows.length === 1,
  survived.rows.length ? '残っている' : '消えてしまった');

// 定期処理が登録されているか
await db.exec('reset role;');
const job = await db.query(`select jobname, schedule, command from cron.job`);
record('定期処理', 'run_tick が毎分で登録される',
  job.rows.length === 1 && job.rows[0].jobname === 'infomap-tick',
  job.rows.length ? `${job.rows[0].jobname} / ${job.rows[0].schedule} / ${job.rows[0].command}` : '未登録');

// 先着1枠なので、2人目は弾かれる
await as('authenticated', C);
try {
  await db.query(`select public.purchase_pin_slot('${pinId}')`);
  record('取引', '売り切れた枠は買えない', false, '2人目が買えてしまった');
} catch (error) {
  const msg = String(error.message).split('\n')[0];
  record('取引', '売り切れた枠は買えない', /sold_out/.test(msg), msg);
}

// 他人の購入を勝手に確定・返金できないか
const purchaseId = bought?.[0]?.id;
if (purchaseId) {
  await as('authenticated', C);
  try {
    await db.query(`select public.submit_verdict('${purchaseId}', 'miss', 'wrong_place')`);
    record('取引', '他人の購入を判定できない', false, '通ってしまった');
  } catch (error) {
    const msg = String(error.message).split('\n')[0];
    record('取引', '他人の購入を判定できない', /forbidden/.test(msg), msg);
  }
}

// 6. 通報
const reportSql = (uid) => `select public.create_report('pin', '${pinId}', 'false_info') as r`;
await as('authenticated', B);
const r1 = await db.query(reportSql(B));
await as('authenticated', B);
const r2 = await db.query(reportSql(B));
record('通報', '同じ人の重ね押しは1件に丸める',
  r1.rows[0].r === 'recorded' && r2.rows[0].r === 'already',
  `1回目=${r1.rows[0].r} 2回目=${r2.rows[0].r}`);

await as('authenticated', C);
await db.query(reportSql(C));
await as('authenticated', D);
const r4 = await db.query(reportSql(D));
record('通報', '別々の3人で自動的に取り下げる', r4.rows[0].r === 'voided', `3人目=${r4.rows[0].r}`);

await db.exec('reset role;');
const voided = await db.query('select status from public.pins where id = $1', [pinId]);
record('通報', '取り下げでピンが voided になる', voided.rows[0].status === 'voided',
  voided.rows[0].status);

const refunded = await db.query(
  `select escrow from public.purchases where pin_id = $1`, [pinId]
);
record('通報', '預かっていた代金が返金に回る',
  refunded.rows.every((r) => r.escrow === 'refunded'),
  refunded.rows.map((r) => r.escrow).join(',') || '購入なし');

// ------------------------------------------------------------------ 出力

function report() {
  const width = Math.max(...results.map((r) => r.label.length));
  const lines = [];
  let area = '';
  for (const r of results) {
    if (r.area !== area) {
      area = r.area;
      lines.push(`\n[${area}]`);
    }
    const mark = r.ok ? ' OK ' : 'FAIL';
    lines.push(`  ${mark}  ${r.label.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  lines.push('');
  lines.push(`${results.length - failed.length} / ${results.length} 件が期待どおり`);
  if (note.length) lines.push(`注記: ${note.join(' / ')}`);
  if (failed.length) lines.push(`\n通らなかった項目:\n${failed.map((f) => `  - ${f.label}: ${f.detail}`).join('\n')}`);
  return lines.join('\n');
}

console.log(report());
await db.close();
process.exit(results.some((r) => !r.ok) ? 1 : 0);
