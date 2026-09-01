# INFOMAP

地図のピンで、「今この場所の状態」だけを、人数限定・期限つきで売買するアプリ。

> **配布しないこと。** いまの実装にはサーバーがなく、残高・エスクロー・購入の可否・
> 出品制限のすべてが端末の中の1つのJSONにある。開発者ツールから書き換えられるので、
> 金銭に関する挙動はいずれも成立しない。身内での動作確認までに留めること。
> 公開する前に必要な作業は「セキュリティ」の節にまとめてある。

残る記事でも、全員に見える口コミでもない。すぐ腐る現場の情報を、その情報で今日得をする人に売る。

## 起動

```bash
npm install
npm run web        # ブラウザで確認（http://localhost:8081）
npm run ios        # iOS シミュレータ
npm run android    # Android エミュレータ
```

本体はスマホ（iOS / Android）。Web は動作確認と閲覧の補助で、出品の主戦場にはしない。

### 地図タイルのキー

`.env.example` を `.env.local` にコピーして `EXPO_PUBLIC_CARTO_KEY` を入れる。
未設定でも地図は出るが「API KEY REQUIRED」の透かしが入る。キーは無料・アカウント不要で
[carto.com/basemaps/apikey](https://carto.com/basemaps/apikey) から即発行できる（月500万タイルまで）。

## 何を作ってあるか

MVPは1エリア（東京圏・御茶ノ水から半径30km）・1カテゴリ（店頭の在庫）に絞っている。
「同じ場所で売買が繰り返されるか」を先に見るため。

出品と依頼はこのエリアの中だけ。地図は世界まで引けるが、これは
「どこまでが対象か」を引いて確かめられるようにしているだけで、外では何も出せない。

### A. 出品して売れる流れ

現場でピンを立てる → 買い手が先着枠を買う → 情報が開く → 当たり外れを申告 → 売り手へ入金 → 出金

### B. 懸賞の流れ

報酬を先に預ける → 近くの人が「向かう」 → 写真つきで報告 → 採用 → 報酬を支払、未採用分は返還

採用された報告は、そのまま売品ピンとして出し直せる（AとBが繋がる導線）。

## 画面

| タブ | 中身 |
| --- | --- |
| さがす | 全画面地図。募集（依頼）と販売をトグルで切り替え、既定は募集。下からシートが3段階で開く |
| リクエスト | 近くの依頼と自分の依頼。依頼の作成と報酬のエスクロー |
| 売る | 出品フォーム。位置・写真・期限・人数・価格と、手取りの内訳 |
| 取引 | 買ったもの（本文と写真、当たり外れ申告）と売ったもの（売れ行き、取り下げ） |
| マイページ | 残高2本立て、履歴、出金、信用スコア、扱わない情報、ユーザー切替 |

## 設計の方針

- **未購入者に本文と写真を渡さない。** UIでマスクするのではなく、リポジトリが返す型（`PublicPin`）に
  そのフィールドを持たせない。`RevealedPin` は購入レコードがあるときだけ返る。
- **残高カラムを持たない。** `wallet_entries` の合計から導出する。`available` と `pending` の増減を
  1行に両方持たせるので、「預かりへ移す」が1行で表現でき、片側だけ書き換わる事故が起きない。
- **売り越さない。** 先着枠の確保はローカルでは書き込みを直列化し、Supabase では行ロックを取る RPC で守る。
- **時刻の読み出しは `lib/clock.ts` だけ。** 期限と鮮度が中心なので、散らばるとテストで固定できない。
- **サンプルは自動で回る。** すべて期限つきなので放っておくと全部腐る。消えた種類だけ同じ内容で
  出し直し、買われた履歴は壊さない（`src/data/seed.ts` の `recycleSamples`）。

## 構成

```
src/
  app/            画面（expo-router のファイルベースルーティング）
  components/     UI部品、地図、ボトムシート
  config/area.ts  検証エリアとタイルの設定
  domain/         型と純粋関数（期限・残枠・鮮度・手数料・スコア）
  data/           リポジトリ境界とローカル実装、シード
  state/          セッションと下書き（zustand）
  hooks/ lib/     時計、位置、写真
supabase/migrations/0001_init.sql   テーブル・RLS・RPC
scripts/shot.mjs                    表示確認用のスクリーンショット
```

## セキュリティ

公開する前に必ず要るもの。

**認証がまだ無い。** いまの利用者は `currentUserId` という保存値でしかない。スキーマは
`auth.uid()` を前提に書いてあるので、Supabase Auth を入れるまで行レベルの制限は一切働かない。

**金の計算をサーバーへ移す。** 残高も判定も端末の中にあるうちは、いくらでも書き換えられる。
`supabase/migrations/0001_init.sql` に、そのための関数を一式書いてある。

**動作確認用のユーザー切替は `__DEV__` で囲ってある。** 外すと認証を入れても迂回されるので、
条件を消さないこと。

**データの境界を画面と同じにする。** 応募の報告一覧は依頼者と本人にしか返さない。
判定・採用・報告は、対象の行の持ち主と呼び出し元が一致しないと動かない。
画面で隠すだけでは、関数を直接呼ぶと他人の取引や報告文が取れる。

### スキーマの検証

```bash
npm run verify:schema
```

`supabase/migrations/0001_init.sql` を実際の Postgres（PGlite。WASM版なので Docker もクラウドの
プロジェクトも要らない）に当てて、権限の境界を28項目で実測する。Supabase が素の状態で
public スキーマに与えている `alter default privileges ... grant all to anon, authenticated`
も再現してあるので、これを入れずに試すより厳しい条件になっている。

**この検証で、それまで塞げていたと思っていた穴が実際には開いていたことが分かった。**
`anon` から `post_entry()` を呼んで残高を発行できていた。原因は次の2つで、どちらも
実際に走らせるまで気づけなかった。

1. **関数を作る前に `revoke` しても効かない。** `revoke` はその時点で存在するものにしか
   適用されず、あとから作った関数には改めて PUBLIC への EXECUTE が付く。
   権限を閉じる節はファイルの末尾に置くこと。
2. **`alter default privileges in schema public revoke ... from public` では
   PUBLIC への組み込みの既定を外せない。** スキーマを指定した形は `pg_default_acl` の
   明示的な項目しか消せない。スキーマ指定なしの
   `alter default privileges revoke execute on functions from public` だけが効く。

スキーマ側で守っていること。

- 関数の実行権限は既定で PUBLIC に付く。Supabase はそれを REST の RPC として公開するので、
  migration の最後で全部 `revoke` してから、必要なものだけ `grant` している。
  公開しているのは17個。`post_entry`（台帳へ書く）、`available_of`、`run_tick`、
  `handle_new_user` は意図的に載せていない。
- `security definer` の関数にはすべて `set search_path = ''` を付け、schema 修飾で書いている。
  付けないと呼び出し側が別スキーマの同名関数を差し込める。
- ビューは既定で作成者の権限で動き、行レベル制限を通らない。列を絞る目的で意図的にそう使い、
  それ以外のビューには `auth.uid()` の条件を必ず入れている（`balances` は本人の分だけ）。
- `pins` と `wallet_entries` には書き込み権限を誰にも与えていない。すべて関数を通す。
- 位置は生の緯度経度を保存しない。受け取った時点で対象からの距離に落として捨てる。
  応募地点も撮影地点も同じ扱いで、依頼者にも座標は渡らない。

位置の偽装について。

- Android は偽装された座標をその旨と一緒に返すので、それを受け取って「位置が偽装されています」
  として扱い、懸賞の自動採用からも外している。
- 測位誤差が150mを超える記録は、距離が範囲内でも「現場で撮影」とは認めない。
  ±3kmの精度で「250m以内にいた」と言われても確かめようがないため。
- それでも、iOS 側の偽装や、改造した端末までは見抜けない。
  本気で防ぐなら Play Integrity / App Attest による端末証明が要る。**現状は抑止であって証明ではない。**

通報について。

- 理由を4種類から選ばせる。自由文だと集計できず、対応の判断もつかない。
- 同じ人の重ね押しは1件に丸める。
- 別々の3人から届いた時点で自動的に取り下げ、預かっている代金は買い手へ返す。
  人が確認するまで待つと期限が来て対応そのものが間に合わないので、先に止める。
- 運営が個別に判断する画面はまだ無い。

依存パッケージ。

- `npm audit` で報告される11件はすべて `uuid` の1件に由来する
  （`expo-splash-screen` → `@expo/config-plugins` → `xcode` → `uuid`）。
  iOSプロジェクトを生成するビルド時のツールで、アプリには入らない。
  強制的に上書きするとビルドが壊れる恐れがあるので、Expo 側の更新を待つ。

まだ手を付けていないもの。

- 通信経路の点検、ストア審査の要件、個人情報保護法まわりの届出。
- アプリ内の「位置情報の扱い」（マイページ）は説明であって、規約や同意取得の手続きではない。

## Supabase へ移すとき

`.env.local` に `EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_ANON_KEY` の**両方**を
入れたときだけ Supabase を見る。片方だけで中途半端に繋ぐと、どちらの実装で動いているのか
分からなくなるため。判定は `src/lib/supabase.ts` の `isSupabaseEnabled` ひとつ。

### プロジェクトを立てる手順

CLI（`npx supabase`）と `supabase/config.toml` は用意済み。残りはアカウントが要る部分だけ。

**1. プロジェクトを作る。** [supabase.com/dashboard](https://supabase.com/dashboard) で
サインアップ（GitHub かメール）して New project。

- Region は `Northeast Asia (Tokyo)` が近い
- Database Password は生成して保管する。`db push` で使う
- Free プランでよい。**1週間アクセスが無いと一時停止する**ので、放置後は手動で再開する

**2. 鍵を `.env.local` に入れる。** プロジェクト画面上部の **Connect** ボタンが手早い
（URLと鍵が一緒に出る）。個別に見るなら
[Settings → API Keys](https://supabase.com/dashboard/project/_/settings/api-keys)。

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx
```

鍵は2系統ある。**`sb_publishable_` が現行**で、旧 `anon`（JWT）は2026年末に廃止予定。
どちらでも動く（変数名は据え置き）。

`sb_secret_` と `service_role` はアプリにも `.env.local` にも入れない。あれは RLS を
無視する全権の鍵。`verify:remote` は誤って渡された場合、実行前に止める。

新形式の鍵は `apikey` ヘッダーだけで送る決まりで、`Authorization: Bearer` にも載せると
JWT として解釈されて `Invalid JWT` になる。ログインが通らないときはここを疑う。

**3. スキーマを当てる。**

```bash
npx supabase login          # ブラウザが開く
npx supabase link --project-ref xxxxxxxx
npm run db:push
```

`login` で `Could not create CLI login session` になることがある（既知の不具合）。
そのときは [トークンを発行](https://supabase.com/dashboard/account/tokens)して
`npx supabase login --token sbp_xxx` を使う。

**データベースのパスワードは要らない。** link 済みなら CLI が管理APIで一時的な
ログインロールを作って繋ぐ（実行すると `Initialising login role...` と出る）。
link できない場合だけ、`.env.local` に `SUPABASE_DB_URL` を置けばそちらを使う。
`EXPO_PUBLIC_` を付けないのは、付けると Expo がバンドルへ焼き込み、
パスワードがアプリを配った相手に渡るため。`scripts/db-push.mjs` がその名前を検出して止める。

Windows で `npx` が実行ポリシーに弾かれる場合は `npx.cmd` を使う。

**4. 外から触って権限を確かめる。** ここがいちばん大事な工程。

```bash
npm run verify:remote
```

公開鍵で実際に REST を叩き、`post_entry` や `run_tick` が呼べないこと、`pins` と
`wallet_entries` が読めないこと、`public_pins` から本文が選べないことを確認する。
`npm run verify:schema` はローカルの Postgres に当てて確かめるので、
**PostgREST が実際に何を外へ出すかはこちらでしか分からない。**

サインアップと `profiles` トリガの確認は利用者を1件作るので、既定では走らせない。
見るときは実在するアドレスを渡す（Supabase はドメインの実在性まで見るので、
`example.com` や未登録のドメインは弾かれる）。

```bash
VERIFY_SIGNUP=you@example.jp npm run verify:remote
```

**5. ダッシュボード側の設定。** `config.toml` はローカル用なので、クラウド側は別に設定する。

- Authentication → Sign In / Providers → Email: 動作確認の間は Confirm email をオフにすると早い
- Authentication → URL Configuration: Site URL に `http://localhost:8081`
- Storage: `photos` バケットを **private** で作る
- Database → Extensions: `pg_cron` を有効化し、`run_tick()` を1分ごとに登録

```sql
select cron.schedule('infomap-tick', '* * * * *', 'select public.run_tick()');
```

進んでいるところと、残っているところ。

| | 状態 |
| --- | --- |
| スキーマ・RLS・RPC | できている。`verify:schema` と `verify:remote` で実測済み |
| 認証（サインアップ / ログイン / サインアウト） | できている。`src/components/SignIn.tsx` |
| `profiles` の自動生成 | できている。`handle_new_user()` トリガが表示名を受け取る |
| 写真の置き場（バケットとポリシー） | できている。`20260831010000_storage.sql` |
| `run_tick()` の pg_cron 登録 | できている。`20260831020000_cron.sql` |
| データ層（`InfoRepository` の Supabase 実装） | できている。`src/data/supabaseRepository.ts` |
| 写真のアップロード（Storage 経由と署名URL） | できている。`src/data/supabasePhotos.ts` |

### 2つの実装の違い

**判断をどこでするか**だけが違う。ローカル実装は金と枠の判断を自分で行い、
Supabase 実装は RPC の中（サーバー側）に任せて、返ってきた行を画面の型へ移すだけ。
返す型は同じなので、画面はどちらで動いているかを知らない。

`tick` はローカルでは自分で回し、Supabase では何もしない（pg_cron が `run_tick()` を回す）。
`resetAll` はローカル実装だけの機能で、Supabase では例外を投げる。

### 位置情報の扱い

**生の緯度経度は端末の外へ出ない。** 撮影地点も応募地点も、対象が確定した時点で
距離へ落として座標を捨てる。落とす場所は `storedProofFor()` の1か所だけ。
サーバーが受け取るのも距離なので、通信経路にもログにも座標は載らない。

### 写真のパスの決まり

`photos` バケットに置くパスは必ず `<利用者のuuid>/<ファイル名>` にする。
先頭のフォルダ名を `auth.uid()` と突き合わせることで、他人の領域への書き込みと
他人の写真の削除を1つの条件で塞いでいる。読めるのは3種類だけで、
置いた本人・そのピンを買った人・その報告を受けた依頼者。

**ポリシーの中で `pins` や `bounty_applications` を直接参照してはいけない。**
RLS のポリシー式は呼び出した人の権限で評価されるため、それらの SELECT を
与えていない `authenticated` では「拒否される」のではなく permission denied の
エラーになり、写真の読み取りが誰に対しても壊れる。判定は
`public.can_read_photo()`（security definer）に閉じ込めてある。

`pins` テーブルには直接の SELECT を許さず、`public_pins` ビュー越しにだけ読ませることで、
買っていない人が本文へ届く経路をDB側でも塞いでいる。写真も同じで、バケットは非公開にし、
買った人と出品者にだけ短命の署名URLを出す。

## 動作確認

```bash
node scripts/shot.mjs / shots/map.png        # 地図
SHOT_CLICK=販売 node scripts/shot.mjs / shots/sale.png
SHOT_AGE_HOURS=3 node scripts/shot.mjs / shots/aged.png   # 放置後の状態
```

マイページのユーザー切替で、売り手と買い手・依頼者と報告者の往復を1台で試せる。

## この先

- カテゴリの開放（列・待ち時間、当日の空き）
- 通知（枠の埋まり、応募、期限切れ）
- 圏外で撮って復帰後に送る
- 実際の決済と出金
