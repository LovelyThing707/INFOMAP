-- 販売だけ無期限を許す。募集の expires_at は従来どおり必須。
-- 無期限は時計では消えない。出品者が止めるか、着いたら無かった申告で消える。

alter table public.pins drop constraint if exists expires_after_created;
alter table public.pins alter column expires_at drop not null;
alter table public.pins
  add constraint expires_after_created
  check (expires_at is null or expires_at > created_at);

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
where p.status = 'active'
  and (p.expires_at is null or p.expires_at > now());

grant select on public.public_pins to anon, authenticated;

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
  if p_ttl_minutes is not null and p_ttl_minutes not in (15, 30, 60) then
    raise exception 'invalid_ttl';
  end if;
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
    p_price, p_slot_total,
    case when p_ttl_minutes is null then null
         else now() + make_interval(mins => p_ttl_minutes) end
  ) returning id into v_pin;

  return v_pin;
end;
$$;

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
  if v_pin.expires_at is not null and v_pin.expires_at <= now() then raise exception 'expired'; end if;
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

create or replace function public.submit_verdict(
  p_purchase uuid, p_verdict public.verdict_kind, p_reason public.miss_reason
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_pu     public.purchases%rowtype;
  v_pin    public.pins%rowtype;
  v_hit    integer;
  v_miss   integer;
  r        record;
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
      update public.pins set status = 'voided'
       where id = v_pin.id and status = 'active';
      for r in
        select id, buyer_id, price from public.purchases
         where pin_id = v_pin.id and escrow = 'held' and id <> p_purchase
      loop
        update public.purchases set escrow = 'refunded', verdict_at = now() where id = r.id;
        perform public.post_entry(r.buyer_id, 'purchase_refund', r.price, -r.price,
          '返金 ' || v_pin.headline, r.id);
      end loop;
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
    if v_pin.status <> 'active'
       or (v_pin.expires_at is not null and v_pin.expires_at <= now()) then
      raise exception 'closed';
    end if;
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
