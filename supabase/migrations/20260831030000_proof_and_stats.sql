-- クライアントのモデルとの残差分を埋める。
--
--   1. 位置の偽装フラグ（proof_mocked）が SQL 側に無かった。
--      Android は偽装された座標をその旨と一緒に返す。これを保存しないと、
--      「位置が偽装されています」の判定と懸賞の自動採用の除外が移行で消える。
--
--   2. 依頼の「向かっている人数」を第三者が取れなかった。
--      bounty_applications_view は依頼者と本人にしか行を返さないので、
--      殺到を抑えるために応募前から見せている人数が出せない。
--      個人を出さずに集計だけ見せるビューを足す。
--
--   3. 撮影地点の生の緯度経度を、そもそも受け取らないことにした。
--      これまでは lat/lng を受けてサーバー側で距離へ落として捨てていたが、
--      距離はクライアントでも出せる。受け取らなければ、ログや監視に一瞬でも
--      座標が載る余地が無くなる。create_pin と report_to_bounty の引数を
--      距離に変える。
--
--   4. my_revealed_pins に出品者の情報と購入の明細を含めた。
--      画面が必要とするものが1回の問い合わせで揃わないと、
--      表示のために何度も往復することになる。

-- ---------------------------------------------------------------- 偽装フラグ

alter table public.pins
  add column if not exists proof_mocked boolean not null default false;

alter table public.bounty_applications
  add column if not exists proof_mocked boolean not null default false;

-- ---------------------------------------------------------------- ビュー

/*
 * 未購入者に渡してよい列だけ。本文・写真・在庫状態は含めない。
 * 撮影の裏づけは買う前に見せる。距離・時刻・誤差・偽装の申告だけなので、
 * 撮影場所そのものは特定されない。
 */
drop view if exists public.public_pins;
create view public.public_pins
with (security_barrier = true) as
select
  p.id, p.seller_id, p.category, p.lat, p.lng, p.place_label, p.headline,
  p.price, p.slot_total, p.slot_taken, p.created_at, p.expires_at, p.status,
  p.proof_taken_at, p.proof_distance_m, p.proof_accuracy_m, p.proof_mocked,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.hit_count + pr.miss_count = 0 then null
       else pr.hit_count::numeric / (pr.hit_count + pr.miss_count) end as seller_score,
  pr.hit_count + pr.miss_count as seller_deals
from public.pins p
join public.profiles pr on pr.id = p.seller_id
where p.status = 'active' and p.expires_at > now();

grant select on public.public_pins to anon, authenticated;

/*
 * 買った人にだけ中身を返す。この where が唯一の防御なので消さないこと。
 * 出品者の評価と購入の明細まで含めて、画面が1回で組めるようにしている。
 */
drop view if exists public.my_revealed_pins;
create view public.my_revealed_pins
with (security_barrier = true) as
select
  p.id, p.seller_id, p.category, p.lat, p.lng, p.place_label, p.headline,
  p.stock_state, p.payload_text, p.quantity_note, p.photo_path,
  p.proof_taken_at, p.proof_distance_m, p.proof_accuracy_m, p.proof_mocked,
  p.price, p.slot_total, p.slot_taken, p.created_at, p.expires_at, p.status,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.hit_count + pr.miss_count = 0 then null
       else pr.hit_count::numeric / (pr.hit_count + pr.miss_count) end as seller_score,
  pr.hit_count + pr.miss_count as seller_deals,
  pu.id         as purchase_id,
  pu.buyer_id   as purchase_buyer_id,
  pu.price      as purchase_price,
  pu.fee        as purchase_fee,
  pu.created_at as purchase_created_at,
  pu.escrow     as purchase_escrow,
  pu.verdict    as purchase_verdict,
  pu.miss_reason as purchase_miss_reason,
  pu.verdict_at as purchase_verdict_at
from public.pins p
join public.purchases pu on pu.pin_id = p.id
join public.profiles pr on pr.id = p.seller_id
where pu.buyer_id = (select auth.uid());

grant select on public.my_revealed_pins to authenticated;

/*
 * 依頼の混み具合。誰でも読める。
 *
 * 応募者が誰かは出さず、件数と「いちばん近い人までの距離」だけを出す。
 * 人数だけでは「5km先に3人」と「100m先に1人」が区別できないので距離も要る。
 * 生の座標は保存していないため、ここから場所は割れない。
 */
create or replace view public.bounty_stats
with (security_barrier = true) as
select
  b.id                                                       as bounty_id,
  count(*) filter (where a.status = 'heading')::integer       as heading_count,
  min(a.claim_distance_m) filter (where a.status = 'heading') as nearest_heading_m,
  count(*) filter (where a.status = 'reported')::integer      as reported_count
from public.bounties b
left join public.bounty_applications a on a.bounty_id = b.id
group by b.id;

grant select on public.bounty_stats to anon, authenticated;

-- 依頼者が採用を判断する材料として、誤差と偽装の申告も出す。
-- create or replace は列の挿入ができない（既存の列名と順序を変えられない）ので落としてから作る
drop view if exists public.bounty_applications_view;
create view public.bounty_applications_view
with (security_barrier = true) as
select
  a.id, a.bounty_id, a.applicant_id, a.status, a.created_at,
  a.claim_distance_m, a.reported_at, a.report_text, a.photo_path,
  a.proof_distance_m, a.proof_taken_at, a.proof_accuracy_m, a.proof_mocked,
  a.decided_at
from public.bounty_applications a
join public.bounties b on b.id = a.bounty_id
where a.applicant_id = (select auth.uid()) or b.requester_id = (select auth.uid());

grant select on public.bounty_applications_view to authenticated;

-- ---------------------------------------------------------------- 関数の作り直し
--
-- 引数が変わるので、create or replace では別の関数が増えるだけになる。
-- 先に古い定義を落とす。

drop function if exists public.create_pin(
  text, double precision, double precision, text, text, public.stock_state,
  text, text, text, double precision, double precision, timestamptz, double precision,
  integer, integer, integer
);

/**
 * 出品。
 * 撮影地点は距離で受け取る。生の緯度経度は受け取らない。
 */
create or replace function public.create_pin(
  p_category text, p_lat double precision, p_lng double precision,
  p_place_label text, p_headline text, p_stock public.stock_state,
  p_payload text, p_quantity_note text, p_photo_path text,
  p_proof_distance_m double precision, p_proof_taken_at timestamptz,
  p_proof_accuracy_m double precision, p_proof_mocked boolean,
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
    proof_distance_m, proof_taken_at, proof_accuracy_m, proof_mocked,
    price, slot_total, expires_at
  ) values (
    v_seller, p_category, p_lat, p_lng, p_place_label, p_headline, p_stock,
    p_payload, p_quantity_note, p_photo_path,
    p_proof_distance_m, p_proof_taken_at, p_proof_accuracy_m,
    coalesce(p_proof_mocked, false),
    p_price, p_slot_total, now() + make_interval(mins => p_ttl_minutes)
  ) returning id into v_pin;

  return v_pin;
end;
$$;

drop function if exists public.report_to_bounty(
  uuid, text, text, double precision, double precision, timestamptz, double precision
);

/** 現地からの報告。写真は必須で、撮影地点は距離で受け取る */
create or replace function public.report_to_bounty(
  p_application uuid, p_text text, p_photo_path text,
  p_proof_distance_m double precision, p_proof_taken_at timestamptz,
  p_proof_accuracy_m double precision, p_proof_mocked boolean
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
         proof_distance_m = p_proof_distance_m,
         proof_taken_at = p_proof_taken_at,
         proof_accuracy_m = p_proof_accuracy_m,
         proof_mocked = coalesce(p_proof_mocked, false)
   where id = p_application;
end;
$$;

/**
 * 「向かう」も距離で受け取る。
 * 出発地点の座標はサーバーに渡らない。依頼者にも渡らない。
 */
drop function if exists public.apply_to_bounty(uuid, double precision, double precision);

create or replace function public.apply_to_bounty(
  p_bounty uuid, p_distance_m double precision
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
  values (p_bounty, v_user, p_distance_m)
  returning id into v_app;

  return v_app;
end;
$$;

-- 作り直した関数は既定で PUBLIC に開くので、閉じ直してから必要な相手にだけ渡す

revoke all on function public.create_pin(
  text, double precision, double precision, text, text, public.stock_state,
  text, text, text, double precision, timestamptz, double precision, boolean,
  integer, integer, integer
) from public, anon;
grant execute on function public.create_pin(
  text, double precision, double precision, text, text, public.stock_state,
  text, text, text, double precision, timestamptz, double precision, boolean,
  integer, integer, integer
) to authenticated;

revoke all on function public.report_to_bounty(
  uuid, text, text, double precision, timestamptz, double precision, boolean
) from public, anon;
grant execute on function public.report_to_bounty(
  uuid, text, text, double precision, timestamptz, double precision, boolean
) to authenticated;

revoke all on function public.apply_to_bounty(uuid, double precision) from public, anon;
grant execute on function public.apply_to_bounty(uuid, double precision) to authenticated;
