-- 予想機能の取り消し。テーブル・ビュー・RPC・列を消し、run_tick を予想導入前に戻す。

do $$
declare
  r record;
begin
  if to_regclass('public.tip_purchases') is null then
    return;
  end if;
  for r in
    select pu.id, pu.buyer_id, pu.price, t.headline
    from public.tip_purchases pu
    join public.tips t on t.id = pu.tip_id
    where pu.escrow = 'held'
  loop
    perform public.post_entry(
      r.buyer_id, 'purchase_refund', r.price, -r.price,
      '予想機能の取り消しによる返金 ' || r.headline, r.id
    );
  end loop;
end;
$$;

drop function if exists public.declare_tip_result cascade;
drop function if exists public.void_tip cascade;
drop function if exists public.purchase_tip cascade;
drop function if exists public.create_tip cascade;

drop view if exists public.my_revealed_tips;
drop view if exists public.my_tips;
drop view if exists public.public_tips;

drop table if exists public.tip_purchases;
drop table if exists public.tips;

alter table public.profiles
  drop column if exists tip_hit_count,
  drop column if exists tip_miss_count;

-- 予想決済を足す前の run_tick（20260831000000_init.sql と同じ）
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
