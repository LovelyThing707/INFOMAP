-- 予想。現場のピンとは別物。
-- カメラも座標も要らない。期限は発走。外れは売り手の落ち度にしない。

alter table public.profiles
  add column if not exists tip_hit_count integer not null default 0 check (tip_hit_count >= 0),
  add column if not exists tip_miss_count integer not null default 0 check (tip_miss_count >= 0);

create table public.tips (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles on delete cascade,
  meet        text not null check (length(meet) between 1 and 20),
  race        text not null check (length(race) between 1 and 10),
  ticket      text not null check (length(ticket) between 1 and 20),
  headline    text not null check (length(headline) between 1 and 40),
  pick_text   text not null check (length(pick_text) between 2 and 200),
  price       integer not null check (price between 50 and 2000),
  slot_total  integer not null check (slot_total between 1 and 20),
  slot_taken  integer not null default 0 check (slot_taken >= 0),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  status      public.pin_status not null default 'active',
  result      public.verdict_kind,
  result_at   timestamptz,
  constraint tip_slot_not_oversold check (slot_taken <= slot_total),
  constraint tip_expires_after_created check (expires_at > created_at)
);

create table public.tip_purchases (
  id          uuid primary key default gen_random_uuid(),
  tip_id      uuid not null references public.tips on delete cascade,
  buyer_id    uuid not null references public.profiles on delete cascade,
  price       integer not null check (price > 0),
  fee         integer not null check (fee >= 0),
  created_at  timestamptz not null default now(),
  escrow      public.escrow_state not null default 'held',
  unique (tip_id, buyer_id)
);

create index tips_live_idx on public.tips (expires_at) where status = 'active';

alter table public.tips enable row level security;
alter table public.tip_purchases enable row level security;

create view public.public_tips
with (security_barrier = true) as
select
  t.id, t.seller_id, t.meet, t.race, t.ticket, t.headline,
  t.price, t.slot_total, t.slot_taken, t.created_at, t.expires_at, t.status, t.result,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.tip_hit_count + pr.tip_miss_count < 4 then null
       else pr.tip_hit_count::numeric / (pr.tip_hit_count + pr.tip_miss_count) end as tip_score,
  pr.tip_hit_count + pr.tip_miss_count as tip_deals
from public.tips t
join public.profiles pr on pr.id = t.seller_id
where t.status = 'active' and t.expires_at > now();

create view public.my_revealed_tips
with (security_barrier = true) as
select
  t.id, t.seller_id, t.meet, t.race, t.ticket, t.headline, t.pick_text,
  t.price, t.slot_total, t.slot_taken, t.created_at, t.expires_at, t.status, t.result,
  pr.handle as seller_handle,
  pr.emoji  as seller_emoji,
  case when pr.tip_hit_count + pr.tip_miss_count < 4 then null
       else pr.tip_hit_count::numeric / (pr.tip_hit_count + pr.tip_miss_count) end as tip_score,
  pr.tip_hit_count + pr.tip_miss_count as tip_deals,
  pu.id         as purchase_id,
  pu.buyer_id   as purchase_buyer_id,
  pu.price      as purchase_price,
  pu.fee        as purchase_fee,
  pu.created_at as purchase_created_at,
  pu.escrow     as purchase_escrow
from public.tips t
join public.tip_purchases pu on pu.tip_id = t.id
join public.profiles pr on pr.id = t.seller_id
where pu.buyer_id = (select auth.uid());

create view public.my_tips
with (security_barrier = true) as
select * from public.tips where seller_id = (select auth.uid());

grant select on public.public_tips to anon, authenticated;
grant select on public.my_revealed_tips to authenticated;
grant select on public.my_tips to authenticated;
grant select on public.tip_purchases to authenticated;

create policy tip_purchases_read on public.tip_purchases for select
  using (buyer_id = (select auth.uid()) or exists (
    select 1 from public.tips where tips.id = tip_purchases.tip_id
      and tips.seller_id = (select auth.uid())
  ));

create or replace function public.create_tip(
  p_meet text, p_race text, p_ticket text, p_pick text,
  p_price integer, p_slot_total integer, p_ttl_minutes integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_seller uuid := (select auth.uid());
  v_tip uuid;
begin
  if v_seller is null then raise exception 'unauthenticated'; end if;
  if p_ttl_minutes is null or p_ttl_minutes <= 0 then raise exception 'too_late'; end if;
  if length(trim(p_meet)) < 1 or length(trim(p_race)) < 1 or length(trim(p_ticket)) < 1 then
    raise exception 'invalid';
  end if;
  if length(trim(p_pick)) < 2 then raise exception 'invalid'; end if;

  insert into public.tips (
    seller_id, meet, race, ticket, headline, pick_text,
    price, slot_total, expires_at
  ) values (
    v_seller, trim(p_meet), trim(p_race), trim(p_ticket),
    left(trim(p_meet) || trim(p_race) || ' ' || trim(p_ticket), 40),
    trim(p_pick), p_price, p_slot_total,
    now() + make_interval(mins => p_ttl_minutes)
  ) returning id into v_tip;
  return v_tip;
end;
$$;

create or replace function public.purchase_tip(p_tip uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_buyer uuid := (select auth.uid());
  v_tip public.tips%rowtype;
  v_purchase uuid;
  v_fee integer;
begin
  if v_buyer is null then raise exception 'unauthenticated'; end if;
  select * into v_tip from public.tips where id = p_tip for update;
  if not found then raise exception 'tip_not_found'; end if;
  if v_tip.status <> 'active' then raise exception 'voided'; end if;
  if v_tip.expires_at <= now() then raise exception 'expired'; end if;
  if v_tip.slot_taken >= v_tip.slot_total then raise exception 'sold_out'; end if;
  if v_tip.seller_id = v_buyer then raise exception 'own_tip'; end if;
  if public.available_of(v_buyer) < v_tip.price then raise exception 'insufficient_balance'; end if;

  v_fee := public.platform_fee(v_tip.price);
  update public.tips set slot_taken = slot_taken + 1 where id = p_tip;
  insert into public.tip_purchases (tip_id, buyer_id, price, fee)
  values (p_tip, v_buyer, v_tip.price, v_fee)
  returning id into v_purchase;
  perform public.post_entry(
    v_buyer, 'purchase_hold', -v_tip.price, v_tip.price,
    '購入（預かり）' || v_tip.headline, v_purchase
  );
  return v_purchase;
end;
$$;

create or replace function public.void_tip(p_tip uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.tips set status = 'voided'
   where id = p_tip
     and seller_id = (select auth.uid())
     and status = 'active'
     and slot_taken = 0
     and expires_at > now();
  if not found then raise exception 'forbidden'; end if;
end;
$$;

create or replace function public.declare_tip_result(p_tip uuid, p_result public.verdict_kind)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tip public.tips%rowtype;
begin
  select * into v_tip from public.tips where id = p_tip for update;
  if not found then raise exception 'tip_not_found'; end if;
  if v_tip.seller_id <> (select auth.uid()) then raise exception 'forbidden'; end if;
  if v_tip.expires_at > now() then raise exception 'too_early'; end if;
  if v_tip.result is not null then raise exception 'already'; end if;

  update public.tips set result = p_result, result_at = now() where id = p_tip;
  if p_result = 'hit' then
    update public.profiles set tip_hit_count = tip_hit_count + 1 where id = v_tip.seller_id;
  else
    update public.profiles set tip_miss_count = tip_miss_count + 1 where id = v_tip.seller_id;
  end if;
end;
$$;

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
    select pu.id, pu.buyer_id, pu.price, pu.fee, t.seller_id, t.headline
    from public.tip_purchases pu join public.tips t on t.id = pu.tip_id
    where pu.escrow = 'held' and t.expires_at <= now()
  loop
    update public.tip_purchases set escrow = 'released' where id = r.id;
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

grant execute on function public.create_tip(text, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.purchase_tip(uuid) to authenticated;
grant execute on function public.void_tip(uuid) to authenticated;
grant execute on function public.declare_tip_result(uuid, public.verdict_kind) to authenticated;
