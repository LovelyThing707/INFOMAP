-- フォローといいね。買う前から付けられる。本文や写真は開かない。

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.pin_likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  pin_id     uuid not null references public.pins (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, pin_id)
);

create index follows_followee_idx on public.follows (followee_id);
create index pin_likes_pin_idx on public.pin_likes (pin_id);

alter table public.follows enable row level security;
alter table public.pin_likes enable row level security;

create policy follows_read on public.follows for select
  to authenticated using (true);
create policy follows_insert on public.follows for insert
  to authenticated with check (follower_id = auth.uid());
create policy follows_delete on public.follows for delete
  to authenticated using (follower_id = auth.uid());

create policy pin_likes_read on public.pin_likes for select
  to authenticated using (true);
create policy pin_likes_insert on public.pin_likes for insert
  to authenticated with check (user_id = auth.uid());
create policy pin_likes_delete on public.pin_likes for delete
  to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.follows to authenticated;
grant select, insert, delete on public.pin_likes to authenticated;
