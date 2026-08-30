import { AREA } from '@/config/area';
import type {
  Bounds,
  Bounty,
  BountyApplication,
  LatLng,
  Pin,
  PublicPin,
  Purchase,
  RevealedPin,
  User,
} from './types';

export const PLATFORM_FEE_RATE = 0.2;

/** 買い手が当たり外れを申告できる猶予。過ぎたら自動で確定して売り手に渡す */
export const VERDICT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** 依頼者が報告を見て不採用にできる猶予。過ぎたら自動条件を満たす報告を採用する */
export const BOUNTY_REVIEW_WINDOW_MS = 10 * 60 * 1000;

export const URGENT_MS = 3 * 60 * 1000;
export const WARN_MS = 10 * 60 * 1000;

export const EXPIRY_CHOICES_MIN = [15, 30, 60] as const;
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

type PinTiming = Pick<
  PublicPin,
  'slotTotal' | 'slotTaken' | 'createdAt' | 'expiresAt' | 'status'
>;

export type Urgency = 'fresh' | 'warn' | 'urgent' | 'dead';

export function remainingMs(pin: PinTiming, now: number): number {
  return Math.max(0, pin.expiresAt - now);
}

export function freshnessMs(pin: PinTiming, now: number): number {
  return Math.max(0, now - pin.createdAt);
}

export function remainingSlots(pin: PinTiming): number {
  return Math.max(0, pin.slotTotal - pin.slotTaken);
}

export function isExpired(pin: PinTiming, now: number): boolean {
  return now >= pin.expiresAt;
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
  const left = remainingMs(pin, now);
  if (left <= URGENT_MS) return 'urgent';
  if (left <= WARN_MS) return 'warn';
  return 'fresh';
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
  return app.reportedAt <= bounty.expiresAt;
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

export function boundsContain(bounds: Bounds, point: LatLng): boolean {
  return (
    point.lat <= bounds.north &&
    point.lat >= bounds.south &&
    point.lng <= bounds.east &&
    point.lng >= bounds.west
  );
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
  return `${hour}時間前`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatScore(score: number | null): string {
  if (score === null) return '実績なし';
  return `当たり率 ${Math.round(score * 100)}%`;
}

export function isRevealed(pin: PublicPin | RevealedPin): pin is RevealedPin {
  return 'payloadText' in pin;
}

/** 保存されている Pin から、未購入者へ渡してよい部分だけを抜き出す */
export function toPublicShape(
  pin: Pin
): Omit<PublicPin, 'sellerHandle' | 'sellerEmoji' | 'sellerScore' | 'sellerDeals' | 'asks'> {
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
