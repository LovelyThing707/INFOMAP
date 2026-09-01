# Tipster

**現地でしか取れない情報を、必要な人へ人数限定・期限つきで届ける。**

| | |
| --- | --- |
| **製品名** | Tipster |
| **コードネーム** | INFOMAP |
| **リポジトリ** | 非公開（Private） |
| **プラットフォーム** | iOS / Android / Web（Expo） |
| **バックエンド** | Supabase（Auth · Postgres · RLS · Storage · pg_cron） |
| **検証エリア** | 東京圏（御茶ノ水中心・半径 30km） |
| **ステータス** | プレプロダクション — 実決済・出金は未接続 |

口コミでも、残る記事でもない。すぐ腐る現場の事実を、その情報で今日得をする人に売る。

---

## 目次

1. [プロダクト概要](#プロダクト概要)
2. [なぜこの形か](#なぜこの形か)
3. [アーキテクチャ](#アーキテクチャ)
4. [セキュリティモデル](#セキュリティモデル)
5. [現状と残作業](#現状と残作業)
6. [クイックスタート](#クイックスタート)
7. [運用コマンド](#運用コマンド)
8. [リポジトリ構成](#リポジトリ構成)
9. [設計原則](#設計原則)
10. [画面マップ](#画面マップ)
11. [ロードマップ](#ロードマップ)

---

## プロダクト概要

Tipster は、地図上のピンを通じて **「今この場所の状態」だけ** を売買するマーケットプレイスです。情報は鮮度が価値そのものなので、人数・期限・証拠（現地写真）で供給を絞り、未購入者には本文も写真も渡しません。

### 2つの取引導線

| 導線 | 流れ | 結果 |
| --- | --- | --- |
| **販売（Pin）** | 現場で出品 → 先着枠を購入 → 本文・写真が開く → 当たり外れを申告 → 売り手へ精算 | 在庫・棚・店頭の事実を即時に売る |
| **募集（Bounty）** | 報酬をエスクロー → 近くの人が向かう → 写真つき報告 → 採用 / 返還 | 自分では行けない現地確認を買う |

採用された報告は、そのまま売品ピンとして出し直せます。募集と販売は分断せず、現場の供給が循環する設計です。

### MVP の範囲

- **エリア**: 東京圏のみ（出品・依頼はこの範囲内。地図の閲覧は世界まで可）
- **カテゴリ**: 店頭の在庫（列・空きは定義のみで未開放）
- **手数料**: 取引額の 20%（`PLATFORM_FEE_RATE`）

扱わない情報（追跡、予想、立入禁止の中身、個人が特定できる写真）は出品・依頼の双方で同意させ、通報基準にも使います。

---

## なぜこの形か

| 課題 | Tipster の答え |
| --- | --- |
| 公式が数字を出さない争奪 | 現地の事実だけを、必要な人数に売る |
| SNS に出すと価値が消える | 人数限定・期限つきで供給を絞る |
| 写真の使い回し・遠隔投稿 | 現地撮影・距離・鮮度・測位精度で証拠化する |
| 未購入者への情報漏れ | UI マスクではなく、型と DB ビューでフィールド自体を持たせない |
| 残高の改ざん | 台帳加算（`wallet_entries`）のみ。残高カラムを持たない |

ブランド名 **Tipster** は「当たり筋を渡す人」を指します。コードネーム **INFOMAP** は地図上の情報市場としての実装名です。

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│  Client（Expo Router · React Native / Web）              │
│  画面は InfoRepository の型だけを見る                     │
└──────────────────────────┬───────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
  AsyncStorage 実装               Supabase 実装
  （ローカル検証）                （本番相当）
             │                           │
             │                           ▼
             │                 ┌──────────────────────┐
             │                 │ Auth · RLS · RPC     │
             │                 │ Storage（private）   │
             │                 │ pg_cron → run_tick() │
             │                 └──────────────────────┘
             └────────── 同じ画面契約 ────────────────┘
```

**切り替え条件はひとつだけ。** `.env.local` に `EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_ANON_KEY` の両方が揃ったとき、`src/lib/supabase.ts` の `isSupabaseEnabled` が Supabase 実装を選びます。片方だけでは繋ぎません。

| 関心 | ローカル | Supabase |
| --- | --- | --- |
| 金・枠の判断 | クライアント | RPC（サーバー） |
| `tick` | クライアントが回す | `pg_cron` → `run_tick()` |
| `resetAll` | 可 | 例外（本番では不可） |
| 画面の型 | 同一 | 同一 |

座標は端末の外へ出しません。撮影地点・応募地点は確定時点で距離へ落とし、サーバーが受け取るのも距離だけです。

---

## セキュリティモデル

### 守っている境界

| 層 | 方針 |
| --- | --- |
| **型** | 未購入者向けは `PublicPin`。本文・写真フィールドを持たない |
| **DB** | `pins` へ直接 SELECT させず `public_pins` 経由。本文は買った人だけ |
| **RPC** | 既定の PUBLIC EXECUTE を剥がし、必要な関数だけ grant |
| **Storage** | `photos` は private。`<auth.uid()>/<file>` のみ書ける。読むのは本人・購入者・該当依頼者 |
| **台帳** | 残高は行の合計から導出。`post_entry` はクライアントから呼べない |
| **位置** | 生 lat/lng を保存・送信しない。Android の偽装フラグと測位誤差上限あり |

### 検証（実測）

権限は「書いたつもり」では足りません。次の2系統で外から叩いて確認します。

```bash
npm run verify:schema   # PGlite に migration を当て、境界を実測（Docker / クラウド不要）
npm run verify:remote   # 公開鍵で実プロジェクトの REST を叩き、漏れを確認
```

`verify:schema` では、Supabase 既定の `grant all to anon, authenticated` も再現したうえで検査します。過去にここで `anon` から残高発行できる穴が見つかり、migration 末尾の `revoke` 順と `alter default privileges` の書き方で塞いでいます。詳細は migration コメントと本リポジトリの検証スクリプトを参照してください。

### まだ証明ではないもの

- iOS の位置偽装や改造端末までは見抜けない（抑止であり、Play Integrity / App Attest ではない）
- 実決済・KYC・出金レールは未接続
- 通信経路の専門監査、ストア審査要件、個人情報保護法まわりの届出は未着手
- リポジトリは Private。第三者配布・本番課金の前提にはまだしないこと

---

## 現状と残作業

| 領域 | 状態 |
| --- | --- |
| スキーマ · RLS · RPC | 完了（`verify:schema` / `verify:remote` で実測） |
| 認証（サインアップ / ログイン / サインアウト） | 完了 |
| `profiles` 自動生成 | 完了 |
| Storage（バケット · ポリシー · 署名 URL） | 完了 |
| `run_tick()` の pg_cron | 完了 |
| `InfoRepository` の Supabase 実装 | 完了 |
| テーマ（ライト / ダーク） | 完了 |
| PWA（ホーム画面追加 · standalone） | 完了（Web） |
| 実決済 · 出金 | 未着手 |
| プッシュ通知 | 未着手 |
| カテゴリ拡張（列 · 空き） | 定義のみ |
| 運営モデレーション画面 | 未着手 |

---

## クイックスタート

### 要件

- Node.js 20+
- npm
- （任意）iOS Simulator / Android Emulator
- Supabase を使う場合はプロジェクトと公開鍵

### インストールと起動

```bash
npm install
cp .env.example .env.local   # 値を入れる
npm run web                  # http://localhost:8081
# npm run ios
# npm run android
```

### 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `EXPO_PUBLIC_CARTO_KEY` | 推奨 | 地図タイル。未設定でも表示可（透かしあり）。[無料発行](https://carto.com/basemaps/apikey) |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 時 | プロジェクト URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase 時 | 公開鍵（`sb_publishable_…` または旧 anon JWT） |

**入れてはいけないもの:** `sb_secret_` / `service_role` / DB パスワードを `EXPO_PUBLIC_*` に載せること。公開鍵はバンドルに埋まる前提で、守るのは鍵ではなく RLS と RPC 権限です。

### Supabase プロジェクト手順（要約）

1. [Dashboard](https://supabase.com/dashboard) で Tokyo リージョンのプロジェクトを作成  
2. Connect から URL と公開鍵を `.env.local` へ  
3. `npx supabase login` → `npx supabase link --project-ref <ref>` → `npm run db:push`  
4. `npm run verify:remote` で外側から権限を確認  
5. Auth の Site URL に `http://localhost:8081`、動作確認中は Confirm email をオフにできる  

詳細な落とし穴（CLI ログイン失敗、新形式鍵と `Authorization` ヘッダー、`can_read_photo` を security definer にする理由など）は、運用時に本 README のセキュリティ節と `scripts/` を参照してください。

---

## 運用コマンド

| コマンド | 用途 |
| --- | --- |
| `npm run web` / `ios` / `android` | 開発サーバー |
| `npm run lint` | ESLint（Expo 設定） |
| `npm run db:push` | migration をリンク済みプロジェクトへ適用 |
| `npm run verify:schema` | ローカル Postgres（PGlite）で権限を実測 |
| `npm run verify:remote` | 公開鍵で本番相当 REST を監査 |
| `npm run verify:flow` | 主要フローの結合確認 |
| `npm run seed:remote` | デモ用の出品・依頼・応募を投入（期限つき） |
| `npm run shot` | Playwright で画面キャプチャ |

```bash
# 画面キャプチャ例
node scripts/shot.mjs / shots/map.png
SHOT_CLICK=販売 node scripts/shot.mjs / shots/sale.png
SHOT_AGE_HOURS=3 node scripts/shot.mjs / shots/aged.png
```

デモデータは期限で消えます。地図が空になったら `npm run seed:remote` を再実行してください。

---

## リポジトリ構成

```
src/
  app/                 画面（expo-router）
  components/          UI · 地図 · シート · 認証ゲート
  config/area.ts       検証エリアとタイル
  domain/              型と純粋関数（期限・枠・鮮度・手数料・スコア）
  data/                InfoRepository · ローカル / Supabase 実装 · シード
  state/               セッション · 下書き · テーマ（zustand）
  hooks/ lib/          時計 · 位置 · 写真 · Auth · Supabase クライアント
public/                PWA manifest · アイコン
supabase/
  config.toml          ローカル / CLI 設定（auto_expose_new_tables = false）
  migrations/          スキーマ · RLS · Storage · cron · 機能追加の履歴
scripts/
  db-push.mjs          安全に migration を当てる
  verify-*.mjs         権限とフローの実測
  seed-remote.mjs      リモートデモデータ
  shot.mjs             表示確認
```

---

## 設計原則

1. **未購入者に秘密を型で渡さない** — マスクではなく `PublicPin` / `RevealedPin` の分離  
2. **残高は台帳から導く** — `available` と `pending` の移動を1行で表現し、片方だけの更新を防ぐ  
3. **売り越さない** — 先着枠はローカルでは直列化、Supabase では行ロック RPC  
4. **時刻は `lib/clock.ts` だけ** — 期限と鮮度が本体なので、テストで固定できるようにする  
5. **座標は距離に落として捨てる** — 通信・ログ・依頼者画面のどこにも生座標を残さない  
6. **権限は実測する** — migration を書いたら `verify:schema` と `verify:remote` を通す  
7. **サンプルは腐る前提** — 期限つき情報なので、シードは消えた種類だけ出し直す  

通報は理由を4種に固定し、同一人の重ね押しは1件に丸め、別々の3人で自動取り下げ（代金返還）します。運営の個別判定 UI はまだありません。

---

## 画面マップ

| 面 | 役割 |
| --- | --- |
| **さがす** | 全画面地図。募集 / 販売トグル（既定は募集）。3段階ボトムシート |
| **リクエスト** | 近くの依頼 · 自分の依頼 · 作成とエスクロー |
| **売る** | 出品（位置 · 写真 · 期限 · 人数 · 価格 · 手取り内訳） |
| **取引** | 購入内容 · 判定 · 売上 · 取り下げ |
| **マイページ** | 残高 · 履歴 · 信用 · テーマ · 扱わない情報 |
| **ウェルカム / サインイン** | 初回導線と認証 |
| **通知** | 報告到着 · 向かっている応募などの入口 |

Web は動作確認と閲覧の補助です。出品の主戦場はネイティブを想定しています。ホーム画面追加時は standalone 表示（URL バー非表示）に対応しています。

---

## ロードマップ

- [ ] 実決済と出金レールの接続  
- [ ] プッシュ通知（枠の埋まり · 応募 · 期限）  
- [ ] カテゴリ開放（列・待ち時間、当日の空き）  
- [ ] 圏外撮影 → 復帰後送信  
- [ ] 運営向けモデレーション  
- [ ] 端末証明（Play Integrity / App Attest）  
- [ ] ストア提出と法務（同意取得 · プライバシーポリシー運用）  

---

## ライセンスと取り扱い

本リポジトリは **Private** です。第三者への再配布、本番環境での課金前提の利用、秘密鍵のコミットは行わないでください。`.env.local` は Git 管理外です。

---

**Tipster** — Your tips have a price.  
*Code name: INFOMAP*
