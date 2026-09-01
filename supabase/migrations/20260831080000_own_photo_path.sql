-- 出品・報告の photo_path は、自分のフォルダに実在する写真だけを受け取る。
-- 他人のパスを知って紐づけることと、`../` のようなキー改変をここで落とす。

create or replace function public.assert_own_photo_path(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'unauthenticated'; end if;
  if p_path is null then raise exception 'photo_required'; end if;
  -- クライアントは <auth.uid()>/<uuid>.jpg|png だけを書く
  if p_path !~ (
    '^' || v_user::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
  ) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'photos'
      and name = p_path
  ) then
    raise exception 'photo_required';
  end if;
end;
$$;

revoke all on function public.assert_own_photo_path(text) from public, anon, authenticated;

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
  perform public.assert_own_photo_path(p_photo_path);
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

create or replace function public.report_to_bounty(
  p_application uuid, p_text text, p_photo_path text,
  p_proof_distance_m double precision, p_proof_taken_at timestamptz,
  p_proof_accuracy_m double precision, p_proof_mocked boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app    public.bounty_applications%rowtype;
  v_bounty public.bounties%rowtype;
begin
  perform public.assert_own_photo_path(p_photo_path);

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
