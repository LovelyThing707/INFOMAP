-- 写真の置き場。
--
-- pins.photo_path と bounty_applications.photo_path に入るのはこのバケット内のパス。
-- バケットは public = false。パスを知っていてもURLを叩くだけでは取れない。
-- 読める人にだけ、アプリが短命の署名URLを発行する。
--
-- パスの形は必ず  <利用者のuuid>/<ファイル名>  にする。
-- 先頭のフォルダ名を auth.uid() と突き合わせることで、
-- 「他人の領域へ置く」「他人の写真を消す」を1つの条件で塞げる。
-- クライアント側もこの形で組み立てること（src/data の Supabase 実装）。
--
-- 読ませる相手は3種類だけ。
--   1. 置いた本人（出品者・報告者）
--   2. そのピンを買った人
--   3. その報告を受けた依頼者
-- 未購入者には読ませない。これは public_pins が本文を持たないことと対になっていて、
-- 「写真のパスだけ漏れても中身は取れない」状態を作るためにある。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects は Supabase 側で RLS が有効になっている。
-- 何もポリシーを書かないと誰も置けず読めないので、必要な分だけ開ける。

drop policy if exists photos_insert_own on storage.objects;
create policy photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists photos_read_own on storage.objects;
create policy photos_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

/*
 * 買った人と、報告を受けた依頼者に読ませる。
 *
 * 判定を関数に閉じ込めているのには理由がある。
 * RLS のポリシー式は「呼び出した人の権限」で評価される。
 * ポリシーの中に public.pins や public.bounty_applications を直接書くと、
 * authenticated にはそれらの SELECT を与えていないので、
 * 「拒否される」のではなく permission denied のエラーになり、
 * 写真の読み取りが誰に対しても壊れる。
 * security definer の関数を1枚挟むと、中では所有者の権限で読める。
 *
 * この関数が返すのは「自分がその写真を読めるか」だけなので、
 * 外から呼べても本人が既に知っていること以上は分からない。
 */
create or replace function public.can_read_photo(p_path text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    -- そのピンを買っている
    exists (
      select 1
      from public.purchases pu
      join public.pins p on p.id = pu.pin_id
      where p.photo_path = p_path
        and pu.buyer_id = (select auth.uid())
    )
    -- または、その報告を受けた依頼者である
    or exists (
      select 1
      from public.bounty_applications a
      join public.bounties b on b.id = a.bounty_id
      where a.photo_path = p_path
        and b.requester_id = (select auth.uid())
    );
$$;

revoke all on function public.can_read_photo(text) from public, anon;
grant execute on function public.can_read_photo(text) to authenticated;

drop policy if exists photos_read_shared on storage.objects;
create policy photos_read_shared on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.can_read_photo(name));

/*
 * 置いた本人だけが消せる。
 * 出品をやめたときに、使われない写真が溜まり続けるのを避けるため。
 * 期限切れの写真の掃除は運用側（サービスロール）で行う。
 */
drop policy if exists photos_delete_own on storage.objects;
create policy photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- update ポリシーは置かない。上書きを許すと、買われたあとに中身を差し替えられる。
-- 撮り直しは「消して置き直す」で足りる。

-- photo_path から実体を引けるように、パスで探せるようにしておく
create index if not exists pins_photo_path_idx on public.pins (photo_path);
create index if not exists applications_photo_path_idx on public.bounty_applications (photo_path);
