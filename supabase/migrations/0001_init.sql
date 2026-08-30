-- INFOMAP 初期スキーマ
--
-- ローカル実装（src/data/localRepository.ts）と同じ不変条件をDB側で守らせる。
--   1. 先着枠を超えて売れない        -> purchase_pin_slot() が行ロックを取る
--   2. 採用枠を超えて採用されない    -> accept_bounty_application() が行ロックを取る
--   3. 未購入者に本文と写真が漏れない -> pins には SELECT を許さず、public_pins ビュー越しにだけ読ませる
--   4. 残高は台帳の合計から導出する   -> balances ビュー。残高カラムは持たない

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- 列挙型

create type pin_status         as enum ('active', 'voided');
create type stock_state        as enum ('in_stock', 'few', 'out');
create type escrow_state       as enum ('held', 'released', 'refunded');
create type verdict_kind       as enum ('hit', 'miss');
create type bounty_status      as enum ('open', 'filled', 'expired', 'cancelled');
create type application_status as enum ('heading', 'reported', 'accepted', 'rejected', 'lapsed');
create type ask_target_kind    as enum ('pin', 'bounty');
create type ledger_kind        as enum (
  'topup', 'purchase_hold', 'purchase_settle', 'purchase_refund',
  'sale_income', 'platform_fee', 'bounty_hold', 'bounty_return',
  'bounty_payout', 'bounty_income', 'payout'
);

-- ---------------------------------------------------------------- テーブル

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  handle           text not null,
  emoji            text not null default '🙂',
  hit_count        integer not null default 0,
  miss_count       integer not null default 0,
  restricted_until timestamptz,
  created_at       timestamptz not null default now()
);

create table pins (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references profiles on delete cascade,
  category      text not null,
  lat           double precision not null,
  lng           double precision not null,
  place_label   text not null,
  headline      text not null,
  -- ここから3つは購入者にだけ見せる。public_pins ビューには含めない
  stock_state   stock_state not null,
  payload_text  text not null,
  quantity_note text,
  photo_path    text,
  price         integer not null check (price between 50 and 2000),
  slot_total    integer not null check (slot_total between 1 and 3),
  slot_taken    integer not null default 0 check (slot_taken >= 0),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  status        pin_status not null default 'active',
  constraint slot_not_oversold check (slot_taken <= slot_total)
);

create index pins_live_idx on pins (expires_at) where status = 'active';
create index pins_geo_idx on pins (lat, lng);

create table purchases (
  id         uuid primary key default gen_random_uuid(),
  pin_id     uuid not null references pins on delete cascade,
  buyer_id   uuid not null references profiles on delete cascade,
  price      integer not null,
  fee        integer not null,
  created_at timestamptz not null default now(),
  escrow     escrow_state not null default 'held',
  verdict    verdict_kind,
  verdict_at timestamptz,
  -- 同じ人が同じピンを二重に買えない
  unique (pin_id, buyer_id)
);

create table bounties (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references profiles on delete cascade,
  category       text not null,
  lat            double precision not null,
  lng            double precision not null,
  radius_m       integer not null,
  area_label     text not null,
  target_text    text not null,
  reward         integer not null check (reward >= 50),
  accept_count   integer not null check (accept_count >= 1),
  accepted_count integer not null default 0,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  status         bounty_status not null default 'open',
  constraint accept_not_over check (accepted_count <= accept_count)
);

create table bounty_applications (
  id           uuid primary key default gen_random_uuid(),
  bounty_id    uuid not null references bounties on delete cascade,
  applicant_id uuid not null references profiles on delete cascade,
  status       application_status not null default 'heading',
  created_at   timestamptz not null default now(),
  reported_at  timestamptz,
  report_text  text,
  photo_path   text,
  decided_at   timestamptz
);

-- 同じ依頼に、生きている応募をひとりひとつだけ
create unique index bounty_one_active_application
  on bounty_applications (bounty_id, applicant_id)
  where status in ('heading', 'reported', 'accepted');

-- 「この額なら動く」という一票。交渉ではなく、持ち主が一度で決めるための材料
create table price_asks (
  id          uuid primary key default gen_random_uuid(),
  target_kind ask_target_kind not null,
  target_id   uuid not null,
  user_id     uuid not null references profiles on delete cascade,
  desired     integer not null check (desired between 50 and 2000),
  created_at  timestamptz not null default now(),
  unique (target_kind, target_id, user_id)
);

-- 残高カラムは持たない。増減の記録だけを積む
create table wallet_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles on delete cascade,
  kind            ledger_kind not null,
  available_delta integer not null default 0,
  pending_delta   integer not null default 0,
  memo            text not null,
  ref_id          uuid,
  created_at      timestamptz not null default now()
);

create index wallet_user_idx on wallet_entries (user_id, created_at desc);

create table payout_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  amount     integer not null check (amount > 0),
  status     text not null default 'requested',
  created_at timestamptz not null default now()
);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles on delete cascade,
  target_kind ask_target_kind not null,
  target_id   uuid not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- ビュー

create view balances as
select
  user_id,
  coalesce(sum(available_delta), 0)::integer as available,
  coalesce(sum(pending_delta), 0)::integer   as pending
from wallet_entries
group by user_id;

-- 未購入者に渡してよい列だけ。本文・写真・在庫状態は含めない
create view public_pins as
select
  p.id, p.seller_id, p.category, p.lat, p.lng, p.place_label, p.headline,
  p.price, p.slot_total, p.slot_taken, p.created_at, p.expires_at, p.status,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.hit_count + pr.miss_count = 0 then null
       else pr.hit_count::numeric / (pr.hit_count + pr.miss_count) end as seller_score,
  pr.hit_count + pr.miss_count as seller_deals
from pins p
join profiles pr on pr.id = p.seller_id
where p.status = 'active' and p.expires_at > now();

create view my_revealed_pins as
select p.*, pu.id as purchase_id, pu.escrow, pu.verdict
from pins p
join purchases pu on pu.pin_id = p.id
where pu.buyer_id = auth.uid();

-- ---------------------------------------------------------------- RLS

alter table profiles            enable row level security;
alter table pins                enable row level security;
alter table purchases           enable row level security;
alter table bounties            enable row level security;
alter table bounty_applications enable row level security;
alter table price_asks          enable row level security;
alter table wallet_entries      enable row level security;
alter table payout_requests     enable row level security;
alter table reports             enable row level security;

create policy profiles_read on profiles for select using (true);
create policy profiles_write on profiles for update using (id = auth.uid());

-- pins に直接の SELECT は許さない。買っていない人が本文へ届く経路を塞ぐ
create policy pins_read_own on pins for select
  using (seller_id = auth.uid() or exists (
    select 1 from purchases where purchases.pin_id = pins.id and purchases.buyer_id = auth.uid()
  ));
create policy pins_insert on pins for insert with check (seller_id = auth.uid());
create policy pins_update_own on pins for update using (seller_id = auth.uid());

create policy purchases_read on purchases for select
  using (buyer_id = auth.uid() or exists (
    select 1 from pins where pins.id = purchases.pin_id and pins.seller_id = auth.uid()
  ));

create policy bounties_read on bounties for select using (true);
create policy bounties_insert on bounties for insert with check (requester_id = auth.uid());
create policy bounties_update_own on bounties for update using (requester_id = auth.uid());

create policy applications_read on bounty_applications for select
  using (applicant_id = auth.uid() or exists (
    select 1 from bounties b where b.id = bounty_id and b.requester_id = auth.uid()
  ));

create policy asks_read on price_asks for select using (true);
create policy asks_write on price_asks for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy wallet_read on wallet_entries for select using (user_id = auth.uid());
create policy payouts_read on payout_requests for select using (user_id = auth.uid());
create policy reports_insert on reports for insert with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------- 関数

create or replace function post_entry(
  p_user uuid, p_kind ledger_kind, p_available integer, p_pending integer,
  p_memo text, p_ref uuid
) returns void language sql security definer as $$
  insert into wallet_entries (user_id, kind, available_delta, pending_delta, memo, ref_id)
  values (p_user, p_kind, p_available, p_pending, p_memo, p_ref);
$$;

/**
 * 先着枠の確保。
 * 二人が同時に最後の1枠を叩いても、行ロックで直列化されるので売り越さない。
 */
create or replace function purchase_pin_slot(p_pin uuid)
returns uuid language plpgsql security definer as $$
declare
  v_pin       pins%rowtype;
  v_buyer     uuid := auth.uid();
  v_fee       integer;
  v_available integer;
  v_purchase  uuid;
begin
  select * into v_pin from pins where id = p_pin for update;

  if not found then raise exception 'pin_not_found'; end if;
  if v_pin.status <> 'active' then raise exception 'voided'; end if;
  if v_pin.expires_at <= now() then raise exception 'expired'; end if;
  if v_pin.slot_taken >= v_pin.slot_total then raise exception 'sold_out'; end if;
  if v_pin.seller_id = v_buyer then raise exception 'own_pin'; end if;

  select available into v_available from balances where user_id = v_buyer;
  if coalesce(v_available, 0) < v_pin.price then raise exception 'insufficient_balance'; end if;

  v_fee := floor(v_pin.price * 0.2);

  update pins set slot_taken = slot_taken + 1 where id = p_pin;

  insert into purchases (pin_id, buyer_id, price, fee)
  values (p_pin, v_buyer, v_pin.price, v_fee)
  returning id into v_purchase;

  perform post_entry(
    v_buyer, 'purchase_hold', -v_pin.price, v_pin.price,
    '購入（預かり）' || v_pin.headline, v_purchase
  );

  return v_purchase;
end;
$$;

/** 採用。枠を超えないことを行ロックで守り、報酬を報告者へ渡す */
create or replace function accept_bounty_application(p_application uuid)
returns void language plpgsql security definer as $$
declare
  v_app    bounty_applications%rowtype;
  v_bounty bounties%rowtype;
  v_fee    integer;
begin
  select * into v_app from bounty_applications where id = p_application for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_app.status <> 'reported' then raise exception 'not_reported'; end if;

  select * into v_bounty from bounties where id = v_app.bounty_id for update;
  if v_bounty.requester_id <> auth.uid() then raise exception 'forbidden'; end if;
  if v_bounty.status <> 'open' then raise exception 'closed'; end if;
  if v_bounty.accepted_count >= v_bounty.accept_count then raise exception 'no_slot'; end if;

  v_fee := floor(v_bounty.reward * 0.2);

  update bounty_applications set status = 'accepted', decided_at = now() where id = p_application;
  update bounties set accepted_count = accepted_count + 1 where id = v_bounty.id;

  perform post_entry(v_bounty.requester_id, 'bounty_payout', 0, -v_bounty.reward,
    '採用による支払 ' || v_bounty.target_text, v_bounty.id);
  perform post_entry(v_app.applicant_id, 'bounty_income', v_bounty.reward, 0,
    '報酬 ' || v_bounty.target_text, v_bounty.id);
  if v_fee > 0 then
    perform post_entry(v_app.applicant_id, 'platform_fee', -v_fee, 0, '手数料', v_bounty.id);
  end if;

  update bounties set status = 'filled'
   where id = v_bounty.id and accepted_count >= accept_count;
end;
$$;

/**
 * 時間が経つだけで起きる処理。pg_cron から1分ごとに呼ぶ想定。
 *   1. 判定猶予（2時間）を過ぎた購入を確定して売り手へ渡す
 *   2. 期限切れの依頼を閉じ、未採用分を依頼者へ返す
 */
create or replace function run_tick() returns void language plpgsql security definer as $$
declare
  r record;
begin
  for r in
    select pu.id, pu.buyer_id, pu.price, pu.fee, p.seller_id, p.headline
    from purchases pu join pins p on p.id = pu.pin_id
    where pu.escrow = 'held' and pu.created_at + interval '2 hours' <= now()
  loop
    update purchases set escrow = 'released' where id = r.id;
    perform post_entry(r.buyer_id, 'purchase_settle', 0, -r.price, '購入確定 ' || r.headline, r.id);
    perform post_entry(r.seller_id, 'sale_income', r.price, 0, '売上 ' || r.headline, r.id);
    if r.fee > 0 then
      perform post_entry(r.seller_id, 'platform_fee', -r.fee, 0, '手数料', r.id);
    end if;
  end loop;

  for r in
    select id, requester_id, reward, accept_count, accepted_count, target_text
    from bounties where status = 'open' and expires_at <= now()
  loop
    if r.accept_count > r.accepted_count then
      perform post_entry(
        r.requester_id, 'bounty_return',
        (r.accept_count - r.accepted_count) * r.reward,
        -((r.accept_count - r.accepted_count) * r.reward),
        '未採用分の返還 ' || r.target_text, r.id
      );
    end if;
    update bounties set status = 'expired' where id = r.id;
    update bounty_applications set status = 'lapsed', decided_at = now()
     where bounty_id = r.id and status in ('heading', 'reported');
  end loop;
end;
$$;
