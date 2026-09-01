import { isSupabaseEnabled } from '@/lib/supabase';

import { localRepository } from './localRepository';
import type { InfoRepository } from './repository';
import { supabaseRepository } from './supabaseRepository';

/**
 * アプリはこの1つだけを見る。実装の差し替えはここで行う。
 *
 * 環境変数（EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY）が
 * 両方揃っていれば Supabase、なければ端末内の保存で動く。
 * 判定は src/lib/supabase.ts の isSupabaseEnabled ひとつ。
 *
 * 対応はほぼ1対1。
 *
 *   listPins           -> public_pins ビュー（bounds で絞る）
 *   getPin             -> my_revealed_pins にあればそれ、なければ public_pins
 *   getUserProfile     -> profiles + public_pins。残高と購入履歴は含めない
 *   createPin          -> 写真を Storage へ上げてから create_pin() RPC
 *   purchase           -> purchase_pin_slot() RPC（先着枠を行ロックで守る）
 *   submitVerdict      -> submit_verdict() RPC
 *   createBounty       -> create_bounty() RPC（報酬をエスクローに入れる）
 *   applyToBounty      -> apply_to_bounty() RPC（座標ではなく距離を渡す）
 *   reportToBounty     -> report_to_bounty() RPC
 *   decideApplication  -> accept_bounty_application() / reject_bounty_application()
 *   cancelBounty       -> close_bounty() RPC
 *   askPriceChange     -> set_price_ask() / withdraw_price_ask() / apply_price_change()
 *   createReport       -> create_report() RPC（3人で自動的に取り下げる）
 *   getBalance         -> balances ビュー（本人の1行だけ）
 *   listBounties       -> bounties + bounty_stats（人数は個人を含まない集計から）
 *   tick               -> 何もしない。pg_cron が run_tick() を回す
 *   resetAll           -> ローカル実装だけの機能。Supabase では例外を投げる
 *
 * 2つの実装で違うのは「判断をどこでするか」だけ。
 * ローカル側は金と枠の判断を自分で行い、Supabase 側は RPC の中（サーバー）に任せる。
 * 返す型は同じなので、画面はどちらで動いているかを知らない。
 */

/** どちらの実装で動いているか。取り違えると、守られていないものを守られていると誤解する */
export type DataBackend = 'local' | 'supabase';

export const backend: DataBackend = isSupabaseEnabled ? 'supabase' : 'local';

export const repository: InfoRepository = isSupabaseEnabled
  ? supabaseRepository
  : localRepository;

export { getCurrentUserId, setCurrentUserId } from './localRepository';
export type { InfoRepository };
