import { AREA } from '@/config/area';
import type {
  Bounds,
  Bounty,
  BountyApplication,
  LatLng,
  MissReason,
  PhotoEvidence,
  PhotoProof,
  Pin,
  ProofLevel,
  PublicPin,
  Purchase,
  ReportReason,
  RevealedPin,
  StoredProof,
  User,
} from './types';

export const PLATFORM_FEE_RATE = 0.2;

/** 買い手が情報の正誤を申告できる猶予。過ぎたら自動で確定して売り手に渡す */
export const VERDICT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 依頼者が報告を見て不採用にできる猶予。過ぎたら自動条件を満たす報告を採用する */
export const BOUNTY_REVIEW_WINDOW_MS = 10 * 60 * 1000;

/**
 * 「向かっている」を信用できる数字にするための制約。
 *
 * 距離では縛らない。電車や車なら10km先からでも締め切りに間に合うし、
 * 「夕方に寄るついでに」も正当な応募なので、遠いというだけで弾くと供給が痩せる。
 * 代わりに応募した地点を記録して他の人に見せ、放置は時間で降ろす。
 */
/** 応募したまま報告がないと流れるまでの時間 */
export const CLAIM_WINDOW_MS = 30 * 60 * 1000;
/** 一人が同時に持てる応募の数 */
export const MAX_ACTIVE_CLAIMS = 5;

export const URGENT_MS = 3 * 60 * 1000;
export const WARN_MS = 10 * 60 * 1000;

export const EXPIRY_CHOICES_MIN = [15, 30, 60] as const;
/** 販売だけ。募集は期限必須のまま */
export const OPEN_ENDED_TTL = 'open' as const;
export type PinTtlChoice = (typeof EXPIRY_CHOICES_MIN)[number] | typeof OPEN_ENDED_TTL;

export function isAllowedPinTtl(minutes: number | null): boolean {
  return minutes === null || (EXPIRY_CHOICES_MIN as readonly number[]).includes(minutes);
}
export const SLOT_CHOICES = [1, 2, 3] as const;
export const PRICE_CHOICES = [100, 200, 300, 500] as const;
export const REWARD_CHOICES = [100, 200, 300, 500] as const;
export const BOUNTY_EXPIRY_CHOICES_MIN = [30, 60, 120] as const;
export const BOUNTY_RADIUS_CHOICES_M = [300, 600, 1000] as const;

/** 出品制限の判定。判定実績がこの数に届くまでは制限しない */
export const RESTRICT_MIN_JUDGED = 4;
export const RESTRICT_MISS_RATE = 0.4;
export const RESTRICT_DURATION_MS = 24 * 60 * 60 * 1000;

export const MIN_PRICE = 50;
export const MAX_PRICE = 2000;

/**
 * 撮影地点がピンからこれだけ離れていたら「その場で撮った」とは認めない。
 * 都市部は建物で測位が乱れるので、狭くしすぎると正直な人が弾かれる。
 */
export const PROOF_RADIUS_M = 250;
/** 撮ってから出品するまでの猶予。これを超えたものは使い回しを疑う */
export const PROOF_FRESH_MS = 15 * 60 * 1000;
/**
 * 測位誤差がこれより大きいと、距離の判定に意味がなくなる。
 * ±3kmの精度で「250m以内にいた」と言われても確かめようがない。
 */
export const PROOF_MAX_ACCURACY_M = 150;

type PinTiming = Pick<
  PublicPin,
  'slotTotal' | 'slotTaken' | 'createdAt' | 'expiresAt' | 'status'
> & {
  evidence?: PhotoEvidence;
  proof?: StoredProof | null;
};

export type Urgency = 'fresh' | 'warn' | 'urgent' | 'dead';

export function isOpenEnded(pin: Pick<PinTiming, 'expiresAt'>): boolean {
  return pin.expiresAt === null;
}

/** 期限の代わりに前面へ出す確認時刻。撮影があればそれ、なければ出品時刻 */
export function confirmedAtOf(pin: PinTiming): number {
  return pin.evidence?.takenAt ?? pin.proof?.takenAt ?? pin.createdAt;
}

export function remainingMs(pin: PinTiming, now: number): number {
  if (pin.expiresAt === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, pin.expiresAt - now);
}

export function freshnessMs(pin: PinTiming, now: number): number {
  return Math.max(0, now - confirmedAtOf(pin));
}

export function remainingSlots(pin: PinTiming): number {
  return Math.max(0, pin.slotTotal - pin.slotTaken);
}

export function isExpired(pin: PinTiming, now: number): boolean {
  return pin.expiresAt !== null && now >= pin.expiresAt;
}

/** 期限つきは近い順。無期限は後ろへ寄せる */
export function compareDeadline(a: PinTiming, b: PinTiming): number {
  if (a.expiresAt === null && b.expiresAt === null) return confirmedAtOf(b) - confirmedAtOf(a);
  if (a.expiresAt === null) return 1;
  if (b.expiresAt === null) return -1;
  return a.expiresAt - b.expiresAt;
}

export function isSoldOut(pin: PinTiming): boolean {
  return remainingSlots(pin) <= 0;
}

export function isPurchasable(pin: PinTiming, now: number): boolean {
  return pin.status === 'active' && !isExpired(pin, now) && !isSoldOut(pin);
}

/**
 * 期限切れは地図から消すが、売り切れは期限までグレーで残す。
 * 「この場所は売れている」ことは、次に出す人にとって意味のある情報なので。
 */
export function isOnMap(pin: PinTiming, now: number): boolean {
  return pin.status === 'active' && !isExpired(pin, now);
}

export function urgencyOf(pin: PinTiming, now: number): Urgency {
  if (!isPurchasable(pin, now)) return 'dead';
  if (pin.expiresAt === null) {
    const age = freshnessMs(pin, now);
    if (age >= 24 * 60 * 60 * 1000) return 'warn';
    return 'fresh';
  }
  const left = remainingMs(pin, now);
  if (left <= URGENT_MS) return 'urgent';
  if (left <= WARN_MS) return 'warn';
  return 'fresh';
}

/**
 * 撮影の裏づけがどれだけ強いか。
 *
 * 写真そのものは「そこに在庫がある」ことの証拠にしかならず、
 * 「いつ・どこで撮ったか」は写真からは分からない。端末の記録と突き合わせて初めて、
 * 持ち込み画像や使い回しと区別できる。
 */
/**
 * 判定の本体。ローカル実装と Supabase 実装で規則を分けないよう、
 * どちらもここを通す。座標を持っている側は storedProofFor で距離へ落としてから呼ぶ。
 */
export function proofLevelOfStored(proof: StoredProof | null, postedAt: number): ProofLevel {
  if (!proof) return 'none';
  // 端末自身が偽装だと言っているものは、距離を見るまでもない
  if (proof.mocked) return 'mocked';
  // 誤差が大きすぎると、距離が範囲内でも「そこにいた」ことにはならない
  if (proof.accuracyM !== null && proof.accuracyM > PROOF_MAX_ACCURACY_M) return 'offsite';
  if (proof.distanceM > PROOF_RADIUS_M) return 'offsite';
  // 出品より後に撮られた記録は、時計をいじった疑いがあるので通さない
  if (proof.takenAt > postedAt + 60 * 1000) return 'offsite';
  if (postedAt - proof.takenAt > PROOF_FRESH_MS) return 'offsite';
  return 'onsite';
}

/** 購入前の人に渡す、写真を含まない裏づけ（保存形から） */
export function evidenceOfStored(
  proof: StoredProof | null,
  postedAt: number
): PhotoEvidence {
  return {
    level: proofLevelOfStored(proof, postedAt),
    takenAt: proof?.takenAt ?? null,
    distanceM: proof ? Math.round(proof.distanceM) : null,
  };
}

/**
 * 撮影直後の生の記録を、保存する形へ落とす。
 *
 * ここが座標を捨てる唯一の場所。以降どこにも緯度経度は流れない。
 * 対象（立てるピン、または依頼の中心）が決まった時点で呼ぶ。
 */
export function storedProofFor(proof: PhotoProof | null, at: LatLng): StoredProof | null {
  if (!proof) return null;
  return {
    distanceM: distanceM(proof, at),
    takenAt: proof.takenAt,
    accuracyM: proof.accuracyM,
    mocked: proof.mocked,
  };
}

export function proofLevelOf(
  proof: PhotoProof | null,
  at: LatLng,
  postedAt: number
): ProofLevel {
  return proofLevelOfStored(storedProofFor(proof, at), postedAt);
}

/** 購入前の人に渡す、写真を含まない裏づけ */
export function evidenceOf(
  proof: PhotoProof | null,
  at: LatLng,
  postedAt: number
): PhotoEvidence {
  return evidenceOfStored(storedProofFor(proof, at), postedAt);
}

/** 出品者の落ち度として記録に残すか。売り切れは残さない */
export function isSellerFault(reason: MissReason): boolean {
  return reason !== 'gone';
}

export function feeFor(amount: number): number {
  return Math.floor(amount * PLATFORM_FEE_RATE);
}

export function netFor(amount: number): number {
  return amount - feeFor(amount);
}

export function sellerScore(hitCount: number, missCount: number): number | null {
  const judged = hitCount + missCount;
  if (judged === 0) return null;
  return hitCount / judged;
}

export function judgedCount(user: Pick<User, 'hitCount' | 'missCount'>): number {
  return user.hitCount + user.missCount;
}

export function isRestricted(user: Pick<User, 'restrictedUntil'>, now: number): boolean {
  return user.restrictedUntil !== null && user.restrictedUntil > now;
}

export function shouldRestrict(hitCount: number, missCount: number): boolean {
  const judged = hitCount + missCount;
  if (judged < RESTRICT_MIN_JUDGED) return false;
  return missCount / judged >= RESTRICT_MISS_RATE;
}

export function canPost(user: Pick<User, 'restrictedUntil'>, now: number): boolean {
  return !isRestricted(user, now);
}

export function verdictDeadline(purchase: Purchase): number {
  return purchase.createdAt + VERDICT_WINDOW_MS;
}

export function isSettleable(purchase: Purchase, now: number): boolean {
  return purchase.escrow === 'held' && now >= verdictDeadline(purchase);
}

export function bountyRemainingSlots(bounty: Bounty): number {
  return Math.max(0, bounty.acceptCount - bounty.acceptedCount);
}

export function isBountyOpen(bounty: Bounty, now: number): boolean {
  return bounty.status === 'open' && now < bounty.expiresAt && bountyRemainingSlots(bounty) > 0;
}

export function headingCount(apps: BountyApplication[]): number {
  return apps.filter((a) => a.status === 'heading').length;
}

export function reportedCount(apps: BountyApplication[]): number {
  return apps.filter((a) => a.status === 'reported').length;
}

/** 応募が流れる時刻。報告がないままここを過ぎると人数から外れる */
export function claimDeadline(app: BountyApplication): number {
  return app.createdAt + CLAIM_WINDOW_MS;
}

export function isClaimStale(app: BountyApplication, now: number): boolean {
  return app.status === 'heading' && now >= claimDeadline(app);
}

export function canApply(
  bounty: Bounty,
  myApplication: BountyApplication | null,
  userId: string,
  now: number
): boolean {
  if (!isBountyOpen(bounty, now)) return false;
  if (bounty.requesterId === userId) return false;
  return myApplication === null;
}

/**
 * 採用の自動条件。手動採用を原則にすると「行ったのに落とされた」体験が先に来て
 * 供給側が枯れるので、これを満たした報告は放っておいても採用される。
 */
export function meetsAutoAccept(app: BountyApplication, bounty: Bounty): boolean {
  if (app.status !== 'reported') return false;
  if (!app.photoUri) return false;
  if (app.reportedAt === null) return false;
  if (app.reportedAt > bounty.expiresAt) return false;
  // 「写真が付いている」だけで自動的に払うと、別の場所の画像でも通ってしまう。
  // 依頼した範囲の中で撮られたことを端末の記録で確かめられたものだけ自動採用する。
  if (!app.proof) return false;
  if (app.proof.mocked) return false;
  if (app.proof.accuracyM !== null && app.proof.accuracyM > PROOF_MAX_ACCURACY_M) return false;
  return app.proof.distanceM <= bounty.radiusM + PROOF_RADIUS_M;
}

/** 依頼者の確認猶予が切れて、自動採用に倒すべきか */
export function isAutoAcceptDue(app: BountyApplication, bounty: Bounty, now: number): boolean {
  if (!meetsAutoAccept(app, bounty)) return false;
  return app.reportedAt !== null && now - app.reportedAt >= BOUNTY_REVIEW_WINDOW_MS;
}

export function reviewDeadline(app: BountyApplication): number | null {
  return app.reportedAt === null ? null : app.reportedAt + BOUNTY_REVIEW_WINDOW_MS;
}

const EARTH_RADIUS_M = 6371000;

export function distanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideArea(point: LatLng): boolean {
  return distanceM(point, AREA.center) <= AREA.radiusM;
}

/** 経度を -180〜180 に畳む */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * 表示範囲に入っているか。
 *
 * 世界地図まで引くと横に何周でも回せるので、地図が返す経度は 180 を超えたり
 * -180 を下回ったりする。素朴に大小比較すると、2周目に入った瞬間に
 * 「範囲内のピンが1件もない」ことになって地図が空になる。畳んでから比べる。
 */
export function boundsContain(bounds: Bounds, point: LatLng): boolean {
  if (point.lat > bounds.north || point.lat < bounds.south) return false;
  // 1周ぶんより広く見えているなら、どの経度も画面に入っている
  if (bounds.east - bounds.west >= 360) return true;

  const west = wrapLng(bounds.west);
  const east = wrapLng(bounds.east);
  const lng = wrapLng(point.lng);
  // 日付変更線をまたぐと west > east になるので、そのときは範囲が2つに割れる
  return west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

/** 値下げをお願いするときの候補。安いほうから並べる */
export function lowerSuggestions(price: number): number[] {
  const candidates = [roundTo(price * 0.7, 50), roundTo(price * 0.5, 50), MIN_PRICE];
  return [...new Set(candidates)]
    .filter((v) => v >= MIN_PRICE && v < price)
    .sort((a, b) => b - a);
}

/** 値上げをお願いするときの候補。高いほうへ並べる */
export function raiseSuggestions(reward: number): number[] {
  const candidates = [roundTo(reward * 1.5, 50), reward * 2, reward * 3];
  return [...new Set(candidates)]
    .filter((v) => v > reward && v <= MAX_PRICE)
    .sort((a, b) => a - b);
}

export function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '終了';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}分`;
  const hour = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${hour}時間` : `${hour}時間${rest}分`;
}

/** マーカー用の詰めた表記 */
export function formatRemainingShort(ms: number): string {
  if (ms <= 0) return '終了';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}時間`;
}

export function formatFreshness(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 45) return 'たった今';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}日前`;
  const month = Math.floor(day / 30);
  return `${Math.max(1, month)}か月前`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 取引の記録に出す時刻。地図から消えたあとに読み返すものなので、
 * 日をまたいだものは日付まで出さないと「何時」だけでは意味が取れない。
 */
export function formatStamp(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const clock = formatClock(ts);
  return sameDay ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
}

export function formatScore(score: number | null): string {
  if (score === null) return '実績なし';
  return `情報どおり ${Math.round(score * 100)}%`;
}

export function isRevealed(pin: PublicPin | RevealedPin): pin is RevealedPin {
  return 'payloadText' in pin;
}

export const PROOF_LABEL: Record<ProofLevel, string> = {
  onsite: '現場で撮影',
  offsite: '撮影地点を確かめられません',
  mocked: '位置が偽装されています',
  none: '撮影の記録なし',
};

/**
 * 別々の人からこれだけ通報が集まったら、自動で取り下げて未確定の代金を返す。
 *
 * 人が確認するまで待っていると、期限が来て消えてしまい対応そのものが間に合わない。
 * 数分で腐る情報を扱う以上、判断を待つより先に止めるほうが被害が小さい。
 */
export const REPORTS_TO_VOID = 3;

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  forbidden: '扱わないと決めている情報',
  false_info: '書かれている内容が事実と違う',
  stale_photo: '写真が現地のものではない・古い',
  other: 'その他',
};

export const MISS_REASON_LABEL: Record<MissReason, string> = {
  gone: '着いたら無くなっていた',
  wrong_place: '写真が別の場所・古い',
  too_thin: '内容が薄すぎる',
};

/** 保存されている Pin から、未購入者へ渡してよい部分だけを抜き出す */
export function toPublicShape(
  pin: Pin
): Omit<
  PublicPin,
  | 'sellerHandle'
  | 'sellerEmoji'
  | 'sellerScore'
  | 'sellerDeals'
  | 'asks'
  | 'evidence'
  | 'likeCount'
  | 'likedByMe'
> {
  return {
    id: pin.id,
    sellerId: pin.sellerId,
    category: pin.category,
    lat: pin.lat,
    lng: pin.lng,
    placeLabel: pin.placeLabel,
    headline: pin.headline,
    price: pin.price,
    slotTotal: pin.slotTotal,
    slotTaken: pin.slotTaken,
    createdAt: pin.createdAt,
    expiresAt: pin.expiresAt,
    status: pin.status,
  };
}
