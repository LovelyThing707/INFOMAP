-- 時間が経つだけで起きる処理を、サーバー側で回す。
--
-- run_tick() がやること。
--   1. 報告のない応募を降ろす（放置された応募が人数に残り続けるのを防ぐ）
--   2. 判定猶予（2時間）を過ぎた購入を確定して売り手へ渡す
--   3. 期限切れの依頼を閉じ、未採用分を依頼者へ返す
--
-- クライアントから呼ばせない。金を動かす処理を外部から任意に起動できると、
-- 金額は変えられなくても負荷をかける経路になる。
-- そのため run_tick() には grant execute を一切与えていない
-- （20260831000000_init.sql の「権限（関数）」を参照）。
-- ここで cron に実行させるのは、cron のジョブが postgres 権限で動くため。

create extension if not exists pg_cron;

-- 同じ名前のジョブが残っていると二重に走るので、入れ直す前に外す
select cron.unschedule('infomap-tick')
where exists (select 1 from cron.job where jobname = 'infomap-tick');

select cron.schedule('infomap-tick', '* * * * *', $$select public.run_tick()$$);
