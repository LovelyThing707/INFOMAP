import { localRepository } from './localRepository';
import type { InfoRepository } from './repository';

/**
 * アプリはこの1つだけを見る。実装の差し替えはここで行う。
 *
 * Supabase へ移すときは supabase/migrations/0001_init.sql を適用したうえで、
 * InfoRepository を満たす実装を作ってここを差し替える。対応はほぼ1対1になる。
 *
 *   listPins           -> public_pins ビュー（bounds で絞る）
 *   getPin             -> my_revealed_pins にあればそれ、なければ public_pins
 *   getUserProfile     -> profiles + public_pins（seller_id で絞る）。残高と購入履歴は含めない
 *   createPin          -> pins へ insert（RLS で seller_id = auth.uid() のみ）
 *   purchase           -> purchase_pin_slot() RPC（先着枠を行ロックで守る）
 *   submitVerdict      -> submit_verdict() RPC
 *   createBounty       -> create_bounty() RPC（報酬をエスクローに入れる）
 *   applyToBounty      -> apply_to_bounty() RPC
 *   reportToBounty     -> report_to_bounty() RPC
 *   decideApplication  -> accept_bounty_application() RPC
 *   cancelBounty       -> close_bounty() RPC
 *   getBalance         -> balances ビュー
 *   tick               -> run_tick()（本来は pg_cron 側で回す）
 */
export const repository: InfoRepository = localRepository;

export { getCurrentUserId, setCurrentUserId } from './localRepository';
export type { InfoRepository };
