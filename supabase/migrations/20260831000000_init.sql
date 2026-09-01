-- INFOMAP 初期スキーマ
--
-- 守るべき不変条件は4つ。
--   1. 先着枠を超えて売れない        -> purchase_pin_slot() が行ロックを取る
--   2. 採用枠を超えて採用されない    -> accept_bounty_application() が行ロックを取る
--   3. 未購入者に本文と写真が漏れない -> pins への直接アクセスを与えず、ビュー越しにだけ読ませる
--   4. 残高を勝手に作れない          -> wallet_entries への書き込み口を1つも公開しない
--
-- 権限の考え方（ここが最重要）
--   Postgres は関数の実行権限を既定で PUBLIC に与える。テーブルとは逆で、
--   明示的に閉じない限り開いている。さらに Supabase は public スキーマの関数を
--   REST の RPC として外へ出すため、「関数を書く」ことが「APIを公開する」ことになる。
--   そのため、このファイルは最後にすべてを revoke してから、必要なものだけ grant する。
--
-- SECURITY DEFINER には必ず `set search_path = ''` を付け、すべて schema 修飾で書く。
-- 付けないと、呼び出し側が search_path を差し替えて別の関数を実行させられる。

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------- 列挙型

create type public.pin_status         as enum ('active', 'voided');
create type public.stock_state        as enum ('in_stock', 'few', 'out');
create type public.escrow_state       as enum ('held', 'released', 'refunded');
create type public.verdict_kind       as enum ('hit', 'miss');
-- gone は返金するが出品者の落ち度ではない。スコアと制限には数えない
create type public.miss_reason        as enum ('gone', 'wrong_place', 'too_thin');
create type public.bounty_status      as enum ('open', 'filled', 'expired', 'cancelled');
create type public.application_status as enum ('heading', 'reported', 'accepted', 'rejected', 'lapsed');
create type public.ask_target_kind    as enum ('pin', 'bounty');
create type public.ledger_kind        as enum (
  'topup', 'purchase_hold', 'purchase_settle', 'purchase_refund',
  'sale_income', 'platform_fee', 'bounty_hold', 'bounty_return',
  'bounty_payout', 'bounty_income', 'payout'
);

-- ---------------------------------------------------------------- 定数と補助

create or replace function public.platform_fee(p_amount integer)
returns integer language sql immutable as $$
  select floor(p_amount * 0.2)::integer;
$$;

/**
 * 2点間の距離(m)。
 * 生の座標は保存しないので、受け取った時点で距離へ落とすために使う。
 */
create or replace function public.distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
) returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
    cos(radians(p_lat1)) * cos(radians(p_lat2)) *
    power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )));
$$;

-- ---------------------------------------------------------------- テーブル

create table public.profiles (
  id               uuid primary key references auth.users on delete cascade,
  handle           text not null check (length(handle) between 1 and 20),
  emoji            text not null default '🙂',
  hit_count        integer not null default 0 check (hit_count >= 0),
  -- 出品者の落ち度によるものだけ。売り切れ(gone)はここに入れない
  miss_count       integer not null default 0 check (miss_count >= 0),
  gone_count       integer not null default 0 check (gone_count >= 0),
  restricted_until timestamptz,
  created_at       timestamptz not null default now()
);

create table public.pins (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references public.profiles on delete cascade,
  category      text not null,
  lat           double precision not null,
  lng           double precision not null,
  place_label   text not null check (length(place_label) between 1 and 80),
  headline      text not null check (length(headline) between 1 and 40),
  -- ここから3つは購入者にだけ見せる。public_pins ビューには含めない
  stock_state   public.stock_state not null,
  payload_text  text not null check (length(payload_text) between 1 and 2000),
  quantity_note text check (quantity_note is null or length(quantity_note) <= 80),
  photo_path    text,
  /**
   * 撮影の裏づけ。生の緯度経度は保存しない。
   * 住宅地の座標が残ると「私人の所在は扱わない」という自分たちの方針と食い違うので、
   * 受け取った座標はピンからの距離に落として捨てる。
   */
  proof_distance_m double precision,
  proof_taken_at   timestamptz,
  proof_accuracy_m double precision,
  price         integer not null check (price between 50 and 2000),
  slot_total    integer not null check (slot_total between 1 and 3),
  slot_taken    integer not null default 0 check (slot_taken >= 0),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  status        public.pin_status not null default 'active',
  constraint slot_not_oversold check (slot_taken <= slot_total),
  constraint expires_after_created check (expires_at > created_at)
);

create index pins_live_idx on public.pins (expires_at) where status = 'active';
create index pins_geo_idx on public.pins (lat, lng);

create table public.purchases (
  id          uuid primary key default gen_random_uuid(),
  pin_id      uuid not null references public.pins on delete cascade,
  buyer_id    uuid not null references public.profiles on delete cascade,
  price       integer not null check (price > 0),
  fee         integer not null check (fee >= 0),
  created_at  timestamptz not null default now(),
  escrow      public.escrow_state not null default 'held',
  verdict     public.verdict_kind,
  miss_reason public.miss_reason,
  verdict_at  timestamptz,
  -- 同じ人が同じピンを二重に買えない
  unique (pin_id, buyer_id),
  constraint reason_only_on_miss check (miss_reason is null or verdict = 'miss')
);

create table public.bounties (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references public.profiles on delete cascade,
  category       text not null,
  lat            double precision not null,
  lng            double precision not null,
  radius_m       integer not null check (radius_m between 100 and 5000),
  area_label     text not null,
  target_text    text not null check (length(target_text) between 1 and 200),
  -- 応募者に必ず聞かれる3つ。先に書かせて質問を減らす
  place_hint     text,
  photo_wanted   text,
  pay_if_absent  boolean not null default true,
  reward         integer not null check (reward between 50 and 2000),
  accept_count   integer not null check (accept_count between 1 and 3),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  status         public.bounty_status not null default 'open',
  constraint accept_not_over check (accepted_count <= accept_count)
);

create index bounties_open_idx on public.bounties (expires_at) where status = 'open';

create table public.bounty_applications (
  id           uuid primary key default gen_random_uuid(),
  bounty_id    uuid not null references public.bounties on delete cascade,
  applicant_id uuid not null references public.profiles on delete cascade,
  status       public.application_status not null default 'heading',
  created_at   timestamptz not null default now(),
  -- 応募した地点も距離だけ持つ。依頼者に生の座標を渡さないため
  claim_distance_m double precision,
  reported_at  timestamptz,
  report_text  text check (report_text is null or length(report_text) <= 2000),
  photo_path   text,
  proof_distance_m double precision,
  proof_taken_at   timestamptz,
  proof_accuracy_m double precision,
  decided_at   timestamptz
);

-- 同じ依頼に、生きている応募をひとりひとつだけ
create unique index bounty_one_active_application
  on public.bounty_applications (bounty_id, applicant_id)
  where status in ('heading', 'reported', 'accepted');

create table public.bounty_questions (
  id          uuid primary key default gen_random_uuid(),
  bounty_id   uuid not null references public.bounties on delete cascade,
  asked_by    uuid not null references public.profiles on delete cascade,
  asked_at    timestamptz not null default now(),
  body        text not null check (length(body) between 1 and 200),
  answer      text check (length(answer) <= 200),
  answered_at timestamptz
);

-- 答え待ちを何本も積まれると依頼者が捌けない。1人1本まで
create unique index question_one_open_per_user
  on public.bounty_questions (bounty_id, asked_by)
  where answer is null;

-- 「この額なら動く」という一票。交渉ではなく、持ち主が一度で決めるための材料
create table public.price_asks (
  id          uuid primary key default gen_random_uuid(),
  target_kind public.ask_target_kind not null,
  target_id   uuid not null,
  user_id     uuid not null references public.profiles on delete cascade,
  desired     integer not null check (desired between 50 and 2000),
  created_at  timestamptz not null default now(),
  unique (target_kind, target_id, user_id)
);

-- 残高カラムは持たない。増減の記録だけを積む
create table public.wallet_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles on delete cascade,
  kind            public.ledger_kind not null,
  available_delta integer not null default 0,
  pending_delta   integer not null default 0,
  memo            text not null,
  ref_id          uuid,
  created_at      timestamptz not null default now()
);

create index wallet_user_idx on public.wallet_entries (user_id, created_at desc);

create table public.payout_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  amount     integer not null check (amount > 0),
  status     text not null default 'requested',
  created_at timestamptz not null default now()
);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles on delete cascade,
  target_kind public.ask_target_kind not null,
  target_id   uuid not null,
  reason      text not null check (length(reason) between 1 and 40),
  created_at  timestamptz not null default now(),
  -- 同じ人の重ね押しで閾値を超えられないようにする
  unique (reporter_id, target_kind, target_id)
);

-- ---------------------------------------------------------------- ビュー
--
-- ビューは既定で「作った人の権限」で動き、元テーブルの行レベル制限を通らない。
-- ここではそれを意図的に使い、列を絞ることで保護する。
-- 迂回してよい理由が言えないビューには、必ず auth.uid() の条件を書くこと。

/** 本人の残高だけ。絞り込みを書き忘れると全員分が見えるので、ここは必ず要る */
create view public.balances
with (security_barrier = true) as
select
  user_id,
  coalesce(sum(available_delta), 0)::integer as available,
  coalesce(sum(pending_delta), 0)::integer   as pending
from public.wallet_entries
where user_id = (select auth.uid())
group by user_id;

/** 未購入者に渡してよい列だけ。本文・写真・在庫状態は含めない */
create view public.public_pins
with (security_barrier = true) as
select
  p.id, p.seller_id, p.category, p.lat, p.lng, p.place_label, p.headline,
  p.price, p.slot_total, p.slot_taken, p.created_at, p.expires_at, p.status,
  -- 撮影の裏づけは買う前に見せる。距離と時刻だけなので、場所は特定されない
  p.proof_taken_at, p.proof_distance_m,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.hit_count + pr.miss_count = 0 then null
       else pr.hit_count::numeric / (pr.hit_count + pr.miss_count) end as seller_score,
  pr.hit_count + pr.miss_count as seller_deals
from public.pins p
join public.profiles pr on pr.id = p.seller_id
where p.status = 'active' and p.expires_at > now();

/** 買った人にだけ中身を返す。この where が唯一の防御なので消さないこと */
create view public.my_revealed_pins
with (security_barrier = true) as
select p.*, pu.id as purchase_id, pu.escrow, pu.verdict, pu.miss_reason
from public.pins p
join public.purchases pu on pu.pin_id = p.id
where pu.buyer_id = (select auth.uid());

/** 自分が出したものは中身も見える */
create view public.my_pins
with (security_barrier = true) as
select * from public.pins where seller_id = (select auth.uid());

/** 応募の一覧。依頼者にも応募者にも、生の座標は渡さない */
create view public.bounty_applications_view
with (security_barrier = true) as
select
  a.id, a.bounty_id, a.applicant_id, a.status, a.created_at,
  a.claim_distance_m, a.reported_at, a.report_text, a.photo_path,
  a.proof_distance_m, a.proof_taken_at, a.decided_at
from public.bounty_applications a
join public.bounties b on b.id = a.bounty_id
where a.applicant_id = (select auth.uid()) or b.requester_id = (select auth.uid());

-- ---------------------------------------------------------------- RLS

alter table public.profiles            enable row level security;
alter table public.pins                enable row level security;
alter table public.purchases           enable row level security;
alter table public.bounties            enable row level security;
alter table public.bounty_applications enable row level security;
alter table public.bounty_questions    enable row level security;
alter table public.price_asks          enable row level security;
alter table public.wallet_entries      enable row level security;
alter table public.payout_requests     enable row level security;
alter table public.reports             enable row level security;

-- 読み取りだけを許す。書き込みはすべて関数を通す
create policy profiles_read on public.profiles for select using (true);

create policy bounties_read on public.bounties for select using (true);

create policy questions_read on public.bounty_questions for select using (true);

create policy asks_read on public.price_asks for select using (true);

create policy purchases_read on public.purchases for select
  using (buyer_id = (select auth.uid()) or exists (
    select 1 from public.pins where pins.id = purchases.pin_id
      and pins.seller_id = (select auth.uid())
  ));

create policy wallet_read on public.wallet_entries for select
  using (user_id = (select auth.uid()));

create policy payouts_read on public.payout_requests for select
  using (user_id = (select auth.uid()));

-- pins / bounty_applications / reports には select ポリシーを置かない。
-- 直接読ませず、上のビュー越しにだけ渡す。

-- ---------------------------------------------------------------- 権限（テーブル）
--
-- テーブルとビューはこの時点で全部作り終えているので、ここで閉じて開け直せる。
-- 関数はまだ作っていないため、ファイル末尾の「権限（関数）」で扱う。
-- 作る前に revoke しても、あとから作った関数には効かない。

revoke all on all tables in schema public from anon, authenticated;
revoke usage on schema public from anon;

-- 以後に作られるテーブルも既定で閉じておく
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- 読み取りは、行レベル制限が働くテーブルとビューにだけ許す
grant select on public.profiles            to anon, authenticated;
grant select on public.bounties            to anon, authenticated;
grant select on public.bounty_questions    to anon, authenticated;
grant select on public.price_asks          to anon, authenticated;
grant select on public.purchases           to authenticated;
grant select on public.wallet_entries      to authenticated;
grant select on public.payout_requests     to authenticated;

grant select on public.public_pins              to anon, authenticated;
grant select on public.my_revealed_pins         to authenticated;
grant select on public.my_pins                  to authenticated;
grant select on public.balances                 to authenticated;
grant select on public.bounty_applications_view to authenticated;

-- pins, wallet_entries への insert/update/delete は誰にも与えない。
-- reports と bounty_applications も同様。すべて関数経由にする。

-- ---------------------------------------------------------------- 関数
--
-- すべて security definer + `set search_path = ''`。
-- search_path を固定しないと、呼び出し側が別スキーマの同名関数を差し込める。

/**
 * 台帳へ1行書く。
 * これが外から呼べると残高を無限に作れるので、最後に必ず revoke する（下の権限節を参照）。
 */
create or replace function public.post_entry(
  p_user uuid, p_kind public.ledger_kind, p_available integer, p_pending integer,
  p_memo text, p_ref uuid
) returns void language sql security definer set search_path = '' as $$
  insert into public.wallet_entries (user_id, kind, available_delta, pending_delta, memo, ref_id)
  values (p_user, p_kind, p_available, p_pending, p_memo, p_ref);
$$;

create or replace function public.available_of(p_user uuid)
returns integer language sql security definer set search_path = '' as $$
  select coalesce(sum(available_delta), 0)::integer
  from public.wallet_entries where user_id = p_user;
$$;

/** 出品。写真の座標は距離へ落として捨てる */
create or replace function public.create_pin(
  p_category text, p_lat double precision, p_lng double precision,
  p_place_label text, p_headline text, p_stock public.stock_state,
  p_payload text, p_quantity_note text, p_photo_path text,
  p_proof_lat double precision, p_proof_lng double precision,
  p_proof_taken_at timestamptz, p_proof_accuracy_m double precision,
  p_price integer, p_slot_total integer, p_ttl_minutes integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_seller uuid := (select auth.uid());
  v_restricted timestamptz;
  v_pin uuid;
begin
  if v_seller is null then raise exception 'unauthenticated'; end if;
  if p_photo_path is null then raise exception 'photo_required'; end if;
  if p_ttl_minutes not in (15, 30, 60) then raise exception 'invalid_ttl'; end if;
  if length(p_headline) not between 1 and 40 then raise exception 'invalid'; end if;
  if length(p_payload) not between 1 and 2000 then raise exception 'invalid'; end if;

  select restricted_until into v_restricted from public.profiles where id = v_seller;
  if v_restricted is not null and v_restricted > now() then raise exception 'restricted'; end if;

  insert into public.pins (
    seller_id, category, lat, lng, place_label, headline, stock_state,
    payload_text, quantity_note, photo_path,
    proof_distance_m, proof_taken_at, proof_accuracy_m,
    price, slot_total, expires_at
  ) values (
    v_seller, p_category, p_lat, p_lng, p_place_label, p_headline, p_stock,
    p_payload, p_quantity_note, p_photo_path,
    case when p_proof_lat is null then null
         else public.distance_m(p_proof_lat, p_proof_lng, p_lat, p_lng) end,
    p_proof_taken_at, p_proof_accuracy_m,
    p_price, p_slot_total, now() + make_interval(mins => p_ttl_minutes)
  ) returning id into v_pin;

  return v_pin;
end;
$$;

/**
 * 先着枠の確保。
 * 二人が同時に最後の1枠を叩いても、行ロックで直列化されるので売り越さない。
 */
create or replace function public.purchase_pin_slot(p_pin uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_pin      public.pins%rowtype;
  v_buyer    uuid := (select auth.uid());
  v_fee      integer;
  v_purchase uuid;
begin
  if v_buyer is null then raise exception 'unauthenticated'; end if;

  select * into v_pin from public.pins where id = p_pin for update;

  if not found then raise exception 'pin_not_found'; end if;
  if v_pin.status <> 'active' then raise exception 'voided'; end if;
  if v_pin.expires_at <= now() then raise exception 'expired'; end if;
  if v_pin.slot_taken >= v_pin.slot_total then raise exception 'sold_out'; end if;
  if v_pin.seller_id = v_buyer then raise exception 'own_pin'; end if;
  if public.available_of(v_buyer) < v_pin.price then raise exception 'insufficient_balance'; end if;

  v_fee := public.platform_fee(v_pin.price);

  update public.pins set slot_taken = slot_taken + 1 where id = p_pin;

  insert into public.purchases (pin_id, buyer_id, price, fee)
  values (p_pin, v_buyer, v_pin.price, v_fee)
  returning id into v_purchase;

  perform public.post_entry(
    v_buyer, 'purchase_hold', -v_pin.price, v_pin.price,
    '購入（預かり）' || v_pin.headline, v_purchase
  );

  return v_purchase;
end;
$$;

/** 情報が合っていたかの申告。売り切れ(gone)は返金しても落ち度に数えない */
create or replace function public.submit_verdict(
  p_purchase uuid, p_verdict public.verdict_kind, p_reason public.miss_reason
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pu     public.purchases%rowtype;
  v_pin    public.pins%rowtype;
  v_hit    integer;
  v_miss   integer;
begin
  select * into v_pu from public.purchases where id = p_purchase for update;
  if not found then raise exception 'purchase_not_found'; end if;
  if v_pu.buyer_id <> (select auth.uid()) then raise exception 'forbidden'; end if;
  if v_pu.escrow <> 'held' then raise exception 'already_settled'; end if;
  if p_verdict = 'miss' and p_reason is null then raise exception 'reason_required'; end if;

  select * into v_pin from public.pins where id = v_pu.pin_id;

  update public.purchases
     set verdict = p_verdict,
         miss_reason = case when p_verdict = 'miss' then p_reason else null end,
         verdict_at = now(),
         escrow = case when p_verdict = 'hit' then 'released' else 'refunded' end
   where id = p_purchase;

  if p_verdict = 'hit' then
    perform public.post_entry(v_pu.buyer_id, 'purchase_settle', 0, -v_pu.price,
      '購入確定 ' || v_pin.headline, p_purchase);
    perform public.post_entry(v_pin.seller_id, 'sale_income', v_pu.price, 0,
      '売上 ' || v_pin.headline, p_purchase);
    if v_pu.fee > 0 then
      perform public.post_entry(v_pin.seller_id, 'platform_fee', -v_pu.fee, 0, '手数料', p_purchase);
    end if;
    update public.profiles set hit_count = hit_count + 1 where id = v_pin.seller_id;
  else
    perform public.post_entry(v_pu.buyer_id, 'purchase_refund', v_pu.price, -v_pu.price,
      '返金 ' || v_pin.headline, p_purchase);
    if p_reason = 'gone' then
      update public.profiles set gone_count = gone_count + 1 where id = v_pin.seller_id;
    else
      update public.profiles set miss_count = miss_count + 1 where id = v_pin.seller_id;
    end if;
  end if;

  select hit_count, miss_count into v_hit, v_miss from public.profiles where id = v_pin.seller_id;
  if v_hit + v_miss >= 4 and v_miss::numeric / (v_hit + v_miss) >= 0.4 then
    update public.profiles set restricted_until = now() + interval '24 hours'
     where id = v_pin.seller_id;
  end if;
end;
$$;

/** 出品の取り下げ。未確定の購入は買い手へ返す */
create or replace function public.void_pin(p_pin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  update public.pins set status = 'voided'
   where id = p_pin and seller_id = (select auth.uid()) and status = 'active';
  if not found then raise exception 'forbidden'; end if;

  for r in select id, buyer_id, price from public.purchases
            where pin_id = p_pin and escrow = 'held'
  loop
    update public.purchases set escrow = 'refunded', verdict_at = now() where id = r.id;
    perform public.post_entry(r.buyer_id, 'purchase_refund', r.price, -r.price, '返金', r.id);
  end loop;
end;
$$;

/** 依頼を出す。報酬は採用枠のぶんだけ先に預かる */
create or replace function public.create_bounty(
  p_category text, p_lat double precision, p_lng double precision, p_radius_m integer,
  p_area_label text, p_target_text text, p_place_hint text, p_photo_wanted text,
  p_pay_if_absent boolean, p_reward integer, p_accept_count integer, p_ttl_minutes integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_requester uuid := (select auth.uid());
  v_total integer := p_reward * p_accept_count;
  v_bounty uuid;
begin
  if v_requester is null then raise exception 'unauthenticated'; end if;
  if p_ttl_minutes not in (30, 60, 120) then raise exception 'invalid_ttl'; end if;
  if public.available_of(v_requester) < v_total then raise exception 'insufficient_balance'; end if;

  insert into public.bounties (
    requester_id, category, lat, lng, radius_m, area_label, target_text,
    place_hint, photo_wanted, pay_if_absent, reward, accept_count, expires_at
  ) values (
    v_requester, p_category, p_lat, p_lng, p_radius_m, p_area_label, p_target_text,
    p_place_hint, p_photo_wanted, p_pay_if_absent, p_reward, p_accept_count,
    now() + make_interval(mins => p_ttl_minutes)
  ) returning id into v_bounty;

  perform public.post_entry(v_requester, 'bounty_hold', -v_total, v_total,
    '依頼の報酬を預け入れ ' || p_target_text, v_bounty);

  return v_bounty;
end;
$$;

/** 「向かう」。移動は追跡せず、押した時点の距離だけ残す */
create or replace function public.apply_to_bounty(
  p_bounty uuid, p_lat double precision, p_lng double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_bounty public.bounties%rowtype;
  v_user   uuid := (select auth.uid());
  v_active integer;
  v_app    uuid;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;

  select * into v_bounty from public.bounties where id = p_bounty;
  if not found then raise exception 'bounty_not_found'; end if;
  if v_bounty.requester_id = v_user then raise exception 'own_bounty'; end if;
  if v_bounty.status <> 'open' or v_bounty.expires_at <= now() then raise exception 'closed'; end if;

  select count(*) into v_active from public.bounty_applications
   where applicant_id = v_user and status in ('heading', 'reported', 'accepted');
  if v_active >= 5 then raise exception 'too_many'; end if;

  insert into public.bounty_applications (bounty_id, applicant_id, claim_distance_m)
  values (p_bounty, v_user, public.distance_m(p_lat, p_lng, v_bounty.lat, v_bounty.lng))
  returning id into v_app;

  return v_app;
end;
$$;

/** 現地からの報告。写真は必須で、座標は距離へ落とす */
create or replace function public.report_to_bounty(
  p_application uuid, p_text text, p_photo_path text,
  p_lat double precision, p_lng double precision,
  p_taken_at timestamptz, p_accuracy_m double precision
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app    public.bounty_applications%rowtype;
  v_bounty public.bounties%rowtype;
begin
  if p_photo_path is null then raise exception 'photo_required'; end if;

  select * into v_app from public.bounty_applications where id = p_application for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.applicant_id <> (select auth.uid()) then raise exception 'forbidden'; end if;
  if v_app.status <> 'heading' then raise exception 'not_heading'; end if;

  select * into v_bounty from public.bounties where id = v_app.bounty_id;
  if v_bounty.status <> 'open' or v_bounty.expires_at <= now() then raise exception 'closed'; end if;

  update public.bounty_applications
     set status = 'reported', reported_at = now(), report_text = p_text,
         photo_path = p_photo_path,
         proof_distance_m = case when p_lat is null then null
           else public.distance_m(p_lat, p_lng, v_bounty.lat, v_bounty.lng) end,
         proof_taken_at = p_taken_at, proof_accuracy_m = p_accuracy_m
   where id = p_application;
end;
$$;

/** 採用。枠を超えないことを行ロックで守り、報酬を報告者へ渡す */
create or replace function public.accept_bounty_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app    public.bounty_applications%rowtype;
  v_bounty public.bounties%rowtype;
  v_fee    integer;
begin
  select * into v_app from public.bounty_applications where id = p_application for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.status <> 'reported' then raise exception 'not_reported'; end if;
  if v_app.photo_path is null then raise exception 'photo_required'; end if;

  select * into v_bounty from public.bounties where id = v_app.bounty_id for update;
  if v_bounty.requester_id <> (select auth.uid()) then raise exception 'forbidden'; end if;
  if v_bounty.status <> 'open' then raise exception 'closed'; end if;
  if v_bounty.accepted_count >= v_bounty.accept_count then raise exception 'no_slot'; end if;

  v_fee := public.platform_fee(v_bounty.reward);

  update public.bounty_applications set status = 'accepted', decided_at = now()
   where id = p_application;
  update public.bounties set accepted_count = accepted_count + 1 where id = v_bounty.id;

  perform public.post_entry(v_bounty.requester_id, 'bounty_payout', 0, -v_bounty.reward,
    '採用による支払 ' || v_bounty.target_text, v_bounty.id);
  perform public.post_entry(v_app.applicant_id, 'bounty_income', v_bounty.reward, 0,
    '報酬 ' || v_bounty.target_text, v_bounty.id);
  if v_fee > 0 then
    perform public.post_entry(v_app.applicant_id, 'platform_fee', -v_fee, 0, '手数料', v_bounty.id);
  end if;

  update public.bounties set status = 'filled'
   where id = v_bounty.id and accepted_count >= accept_count;
end;
$$;

create or replace function public.reject_bounty_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.bounty_applications a
     set status = 'rejected', decided_at = now()
    from public.bounties b
   where a.id = p_application and b.id = a.bounty_id
     and b.requester_id = (select auth.uid()) and a.status = 'reported';
  if not found then raise exception 'forbidden'; end if;
end;
$$;

/** 依頼の取り下げ。未採用の枠ぶんを返す */
create or replace function public.close_bounty(p_bounty uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bounty public.bounties%rowtype;
  v_unused integer;
begin
  select * into v_bounty from public.bounties where id = p_bounty for update;
  if not found or v_bounty.requester_id <> (select auth.uid()) then raise exception 'forbidden'; end if;
  if v_bounty.status <> 'open' then raise exception 'closed'; end if;

  v_unused := v_bounty.accept_count - v_bounty.accepted_count;
  if v_unused > 0 then
    perform public.post_entry(v_bounty.requester_id, 'bounty_return',
      v_unused * v_bounty.reward, -(v_unused * v_bounty.reward),
      '未採用分の返還 ' || v_bounty.target_text, v_bounty.id);
  end if;

  update public.bounties set status = 'cancelled' where id = p_bounty;
  update public.bounty_applications set status = 'lapsed', decided_at = now()
   where bounty_id = p_bounty and status in ('heading', 'reported');
end;
$$;

create or replace function public.ask_question(p_bounty uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_q uuid;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if exists (select 1 from public.bounties where id = p_bounty and requester_id = v_user) then
    raise exception 'own_bounty';
  end if;
  insert into public.bounty_questions (bounty_id, asked_by, body)
  values (p_bounty, v_user, p_body) returning id into v_q;
  return v_q;
end;
$$;

create or replace function public.answer_question(p_question uuid, p_answer text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.bounty_questions q
     set answer = p_answer, answered_at = now()
    from public.bounties b
   where q.id = p_question and b.id = q.bounty_id
     and b.requester_id = (select auth.uid()) and q.answer is null;
  if not found then raise exception 'forbidden'; end if;
end;
$$;

create or replace function public.set_price_ask(
  p_kind public.ask_target_kind, p_target uuid, p_desired integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.price_asks (target_kind, target_id, user_id, desired)
  values (p_kind, p_target, (select auth.uid()), p_desired)
  on conflict (target_kind, target_id, user_id)
  do update set desired = excluded.desired, created_at = now();
end;
$$;

create or replace function public.withdraw_price_ask(
  p_kind public.ask_target_kind, p_target uuid
) returns void language sql security definer set search_path = '' as $$
  delete from public.price_asks
   where target_kind = p_kind and target_id = p_target
     and user_id = (select auth.uid());
$$;

create or replace function public.request_payout(p_amount integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_payout uuid;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if public.available_of(v_user) < p_amount then raise exception 'insufficient_balance'; end if;

  insert into public.payout_requests (user_id, amount) values (v_user, p_amount)
  returning id into v_payout;
  perform public.post_entry(v_user, 'payout', -p_amount, 0, '出金申請', v_payout);
  return v_payout;
end;
$$;

create or replace function public.create_report(
  p_kind public.ask_target_kind, p_target uuid, p_reason text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
  r record;
  v_bounty public.bounties%rowtype;
  v_unused integer;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if p_reason is null or length(p_reason) not between 1 and 40 then
    raise exception 'invalid_reason';
  end if;

  insert into public.reports (reporter_id, target_kind, target_id, reason)
  values (v_user, p_kind, p_target, p_reason)
  on conflict (reporter_id, target_kind, target_id) do nothing;
  if not found then
    return 'already';
  end if;

  select count(distinct reporter_id) into v_count
  from public.reports
  where target_kind = p_kind and target_id = p_target;
  if v_count < 3 then
    return 'recorded';
  end if;

  if p_kind = 'pin' then
    update public.pins set status = 'voided'
     where id = p_target and status = 'active';
    if found then
      for r in select id, buyer_id, price from public.purchases
                where pin_id = p_target and escrow = 'held'
      loop
        update public.purchases set escrow = 'refunded', verdict_at = now() where id = r.id;
        perform public.post_entry(r.buyer_id, 'purchase_refund', r.price, -r.price, '通報による返金', r.id);
      end loop;
      return 'voided';
    end if;
  else
    select * into v_bounty from public.bounties where id = p_target for update;
    if found and v_bounty.status = 'open' then
      v_unused := v_bounty.accept_count - v_bounty.accepted_count;
      if v_unused > 0 then
        perform public.post_entry(
          v_bounty.requester_id, 'bounty_return',
          v_unused * v_bounty.reward, -(v_unused * v_bounty.reward),
          '通報による返還', v_bounty.id
        );
      end if;
      update public.bounties set status = 'cancelled' where id = p_target;
      update public.bounty_applications set status = 'lapsed', decided_at = now()
       where bounty_id = p_target and status in ('heading', 'reported');
      return 'voided';
    end if;
  end if;
  return 'recorded';
end;
$$;

/**
 * サインアップと同時に profiles を作る。
 * これが無いと「動かないから insert ポリシーを足す」ことになり、
 * 当たり回数を自己申告できる穴が開く。
 */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, handle)
  values (
    new.id,
    coalesce(
      nullif(left(new.raw_user_meta_data ->> 'handle', 20), ''),
      nullif(left(split_part(new.email, '@', 1), 20), ''),
      'user'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.apply_price_change(
  p_kind public.ask_target_kind, p_target uuid, p_amount integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_pin public.pins%rowtype;
  v_bounty public.bounties%rowtype;
  v_open integer;
  v_delta integer;
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if p_amount < 50 or p_amount > 2000 then raise exception 'invalid_amount'; end if;

  if p_kind = 'pin' then
    select * into v_pin from public.pins where id = p_target for update;
    if not found then raise exception 'not_found'; end if;
    if v_pin.seller_id <> v_user then raise exception 'forbidden'; end if;
    if v_pin.status <> 'active' or v_pin.expires_at <= now() then raise exception 'closed'; end if;
    if p_amount >= v_pin.price then raise exception 'invalid_amount'; end if;
    update public.pins set price = p_amount where id = p_target;
  else
    select * into v_bounty from public.bounties where id = p_target for update;
    if not found then raise exception 'not_found'; end if;
    if v_bounty.requester_id <> v_user then raise exception 'forbidden'; end if;
    if v_bounty.status <> 'open' or v_bounty.expires_at <= now() then raise exception 'closed'; end if;
    if p_amount <= v_bounty.reward then raise exception 'invalid_amount'; end if;
    v_open := v_bounty.accept_count - v_bounty.accepted_count;
    v_delta := (p_amount - v_bounty.reward) * v_open;
    if v_delta > 0 then
      if public.available_of(v_user) < v_delta then raise exception 'insufficient_balance'; end if;
      perform public.post_entry(
        v_user, 'bounty_hold', -v_delta, v_delta,
        '報酬の引き上げ', v_bounty.id
      );
    end if;
    update public.bounties set reward = p_amount where id = p_target;
  end if;

  delete from public.price_asks
   where target_kind = p_kind and target_id = p_target;
end;
$$;

/**
 * 時間が経つだけで起きる処理。pg_cron から1分ごとに呼ぶ。
 *   1. 報告のない応募を降ろす
 *   2. 判定猶予（2時間）を過ぎた購入を確定して売り手へ渡す
 *   3. 期限切れの依頼を閉じ、未採用分を依頼者へ返す
 * 利用者からは呼べないようにする（下の権限節で revoke したまま grant しない）。
 */
create or replace function public.run_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  update public.bounty_applications set status = 'lapsed', decided_at = now()
   where status = 'heading' and created_at + interval '30 minutes' <= now();

  for r in
    select pu.id, pu.buyer_id, pu.price, pu.fee, p.seller_id, p.headline
    from public.purchases pu join public.pins p on p.id = pu.pin_id
    where pu.escrow = 'held' and pu.created_at + interval '2 hours' <= now()
  loop
    update public.purchases set escrow = 'released' where id = r.id;
    perform public.post_entry(r.buyer_id, 'purchase_settle', 0, -r.price, '購入確定 ' || r.headline, r.id);
    perform public.post_entry(r.seller_id, 'sale_income', r.price, 0, '売上 ' || r.headline, r.id);
    if r.fee > 0 then
      perform public.post_entry(r.seller_id, 'platform_fee', -r.fee, 0, '手数料', r.id);
    end if;
  end loop;

  for r in
    select id, requester_id, reward, accept_count, accepted_count, target_text
    from public.bounties where status = 'open' and expires_at <= now()
  loop
    if r.accept_count > r.accepted_count then
      perform public.post_entry(
        r.requester_id, 'bounty_return',
        (r.accept_count - r.accepted_count) * r.reward,
        -((r.accept_count - r.accepted_count) * r.reward),
        '未採用分の返還 ' || r.target_text, r.id
      );
    end if;
    update public.bounties set status = 'expired' where id = r.id;
    update public.bounty_applications set status = 'lapsed', decided_at = now()
     where bounty_id = r.id and status in ('heading', 'reported');
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 権限（関数）
--
-- ここがこのファイルでいちばん重要な部分。順番に意味がある。
--
-- Postgres は関数を作った時点で PUBLIC に EXECUTE を与える。テーブルとは逆で、
-- 明示的に閉じない限り開いている。そして Supabase は public スキーマの関数を
-- REST の RPC として外へ出すので、「関数を書く」ことが「APIを公開する」ことになる。
--
-- 落とし穴が2つある。実際に Postgres へ当てて確かめた（scripts/verify-schema.mjs）。
--
--   1. 関数を作る前に revoke しても意味がない。
--      revoke はその時点で存在するものにしか効かず、あとから作った関数には
--      また PUBLIC への EXECUTE が付く。だからこの節はファイルの最後にある。
--
--   2. `alter default privileges in schema public revoke ... from public` では
--      PUBLIC への組み込みの既定を外せない。スキーマを指定した形は
--      pg_default_acl の明示的な項目しか消せないため。
--      スキーマ指定なしの `alter default privileges revoke execute on functions
--      from public` だけが効く。

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all routines  in schema public from public, anon, authenticated;

-- 次の migration で関数を足したときも既定で閉じておく。
-- 対象は postgres が作る関数だけ（既定権限は作成ロールごとに持たれる）。
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ここに書いたものだけが外から呼べる。
-- post_entry / available_of / run_tick / handle_new_user は意図的に載せない。
--   post_entry     … 呼べると残高を無限に作れる
--   available_of   … 他人の残高を引ける
--   run_tick       … 金を動かす処理を外部から起動できる
--   handle_new_user… profiles を任意の内容で作れる

grant execute on function public.create_pin(
  text, double precision, double precision, text, text, public.stock_state,
  text, text, text, double precision, double precision, timestamptz, double precision,
  integer, integer, integer
) to authenticated;
grant execute on function public.purchase_pin_slot(uuid) to authenticated;
grant execute on function public.submit_verdict(uuid, public.verdict_kind, public.miss_reason) to authenticated;
grant execute on function public.void_pin(uuid) to authenticated;
grant execute on function public.create_bounty(
  text, double precision, double precision, integer, text, text, text, text,
  boolean, integer, integer, integer
) to authenticated;
grant execute on function public.apply_to_bounty(uuid, double precision, double precision) to authenticated;
grant execute on function public.report_to_bounty(
  uuid, text, text, double precision, double precision, timestamptz, double precision
) to authenticated;
grant execute on function public.accept_bounty_application(uuid) to authenticated;
grant execute on function public.reject_bounty_application(uuid) to authenticated;
grant execute on function public.close_bounty(uuid) to authenticated;
grant execute on function public.ask_question(uuid, text) to authenticated;
grant execute on function public.answer_question(uuid, text) to authenticated;
grant execute on function public.set_price_ask(public.ask_target_kind, uuid, integer) to authenticated;
grant execute on function public.withdraw_price_ask(public.ask_target_kind, uuid) to authenticated;
grant execute on function public.request_payout(integer) to authenticated;
grant execute on function public.create_report(public.ask_target_kind, uuid, text) to authenticated;
grant execute on function public.apply_price_change(public.ask_target_kind, uuid, integer) to authenticated;
