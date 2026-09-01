import {
  bountyRemainingSlots,
  evidenceOfStored,
  medianOf,
  sellerScore,
  toPublicShape,
} from '@/domain/rules';
import type {
  AskTargetKind,
  Balance,
  Bounty,
  BountyApplication,
  BountyQuestion,
  BountyView,
  CategoryId,
  EscrowState,
  LedgerKind,
  MissReason,
  PayoutRequest,
  Pin,
  PinStatus,
  PriceAskSummary,
  PublicPin,
  Purchase,
  RevealedPin,
  StockState,
  StoredProof,
  User,
  UserId,
  UserProfileView,
  Verdict,
  WalletEntry,
} from '@/domain/types';
import { requireSupabase } from '@/lib/supabase';

import type {
  ApplyPriceResult,
  ApplyResult,
  AskResult,
  CreatePinResult,
  InfoRepository,
  PurchaseResult,
  ReportResult,
  ReportResultKind,
  SellerPinView,
  StorageUsage,
} from './repository';
import { removePhoto, signPhoto, uploadPhoto } from './supabasePhotos';

/**
 * Supabase 版のデータ層。
 *
 * ローカル実装との違いは、判断をどこでするか。
 * こちらは金と枠に関わる判断を一切しない。すべて RPC の中（サーバー側）で決まり、
 * ここは呼んで、返ってきた行を画面の型へ移すだけ。
 * 端末を書き換えても不変条件は破れない、という状態にするための分担。
 *
 * 対応表は src/data/index.ts のコメントにある。
 * 権限が意図どおり閉じているかは `npm run verify:remote` で実測できる。
 */
const sb = requireSupabase;

/**
 * 生成した DB 型を使っていないので、返ってきた行はここで一度だけ形を宣言する。
 * 変換を散らすと、列名を変えたときに直し漏れる場所が増える。
 */
function asRows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

function asRow<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

/** DB は timestamptz を ISO 文字列で返す。ドメインは epoch ミリ秒で扱う */
function ms(value: string | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function msOrNull(value: string | null | undefined): number | null {
  return value ? new Date(value).getTime() : null;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

/**
 * plpgsql の `raise exception 'sold_out'` は、そのまま error.message に入る。
 * 画面が分岐に使う語へ写す。知らない語は 'unknown' にして握りつぶさない。
 */
const KNOWN_REASONS = [
  'unauthenticated',
  'insufficient_balance',
  'photo_required',
  'already_settled',
  'application_not_found',
  'purchase_not_found',
  'bounty_not_found',
  'pin_not_found',
  'not_reported',
  'not_heading',
  'reason_required',
  'invalid_amount',
  'invalid_ttl',
  'own_bounty',
  'own_pin',
  'sold_out',
  'no_slot',
  'too_many',
  'restricted',
  'forbidden',
  'expired',
  'voided',
  'closed',
  'invalid',
] as const;

function reasonOf(message: string): string {
  // 一意制約に当たったものは、意味のある語へ言い換える
  if (/duplicate key/i.test(message)) {
    if (/purchases/i.test(message)) return 'already_bought';
    if (/bounty_one_active/i.test(message)) return 'duplicate';
    if (/question_one_open/i.test(message)) return 'duplicate';
  }
  return KNOWN_REASONS.find((reason) => message.includes(reason)) ?? 'unknown';
}

type RpcResult<T> = { ok: true; data: T } | { ok: false; reason: string };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const { data, error } = await sb().rpc(name, args);
  if (error) return { ok: false, reason: reasonOf(error.message) };
  return { ok: true, data: data as T };
}

/** 戻り値を見ない書き込み。失敗は黙って捨てず、呼び出し側の型に合わせて畳む */
async function rpcVoid(name: string, args: Record<string, unknown> = {}): Promise<void> {
  await sb().rpc(name, args);
}

// ---------------------------------------------------------------- 行の写し

interface AskRow {
  target_kind: AskTargetKind;
  target_id: string;
  user_id: string;
  desired: number;
}

/** 対象ごとの希望額。1回の問い合わせで取ってから、ここで振り分ける */
function asksIndex(rows: AskRow[], viewerId: UserId) {
  const byTarget = new Map<string, AskRow[]>();
  for (const row of rows) {
    const list = byTarget.get(row.target_id) ?? [];
    list.push(row);
    byTarget.set(row.target_id, list);
  }
  return (targetId: string): PriceAskSummary => {
    const list = byTarget.get(targetId) ?? [];
    return {
      count: list.length,
      median: medianOf(list.map((a) => a.desired)),
      mine: list.find((a) => a.user_id === viewerId)?.desired ?? null,
    };
  };
}

const EMPTY_ASKS: PriceAskSummary = { count: 0, median: 0, mine: null };

async function fetchAsks(
  kind: AskTargetKind,
  ids: string[],
  viewerId: UserId
): Promise<(targetId: string) => PriceAskSummary> {
  if (!ids.length) return () => EMPTY_ASKS;
  const { data } = await sb()
    .from('price_asks')
    .select('target_kind,target_id,user_id,desired')
    .eq('target_kind', kind)
    .in('target_id', ids);
  return asksIndex((data ?? []) as AskRow[], viewerId);
}

interface ProofColumns {
  proof_distance_m: number | null;
  proof_taken_at: string | null;
  proof_accuracy_m: number | null;
  proof_mocked: boolean | null;
}

function proofFrom(row: ProofColumns): StoredProof | null {
  if (row.proof_distance_m === null || row.proof_taken_at === null) return null;
  return {
    distanceM: row.proof_distance_m,
    takenAt: ms(row.proof_taken_at),
    accuracyM: row.proof_accuracy_m,
    mocked: row.proof_mocked === true,
  };
}

interface PublicPinRow extends ProofColumns {
  id: string;
  seller_id: string;
  category: CategoryId;
  lat: number;
  lng: number;
  place_label: string;
  headline: string;
  price: number;
  slot_total: number;
  slot_taken: number;
  created_at: string;
  expires_at: string | null;
  status: PinStatus;
  seller_handle: string;
  seller_emoji: string;
  seller_score: number | null;
  seller_deals: number;
}

function toPublicPin(row: PublicPinRow, asks: PriceAskSummary): PublicPin {
  const createdAt = ms(row.created_at);
  return {
    id: row.id,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    placeLabel: row.place_label,
    headline: row.headline,
    price: row.price,
    slotTotal: row.slot_total,
    slotTaken: row.slot_taken,
    createdAt,
    expiresAt: msOrNull(row.expires_at),
    status: row.status,
    sellerId: row.seller_id,
    sellerHandle: row.seller_handle,
    sellerEmoji: row.seller_emoji,
    sellerScore: row.seller_score === null ? null : Number(row.seller_score),
    sellerDeals: row.seller_deals,
    asks,
    // 写真そのものは渡さない。いつ・どれだけ離れて撮ったかだけ
    evidence: evidenceOfStored(proofFrom(row), createdAt),
    likeCount: 0,
    likedByMe: false,
  };
}

function withLikes(
  pin: PublicPin,
  likes: { count: (id: string) => number; liked: (id: string) => boolean }
): PublicPin {
  return {
    ...pin,
    likeCount: likes.count(pin.id),
    likedByMe: likes.liked(pin.id),
  };
}

async function fetchPinLikes(pinIds: string[], viewerId: string) {
  const empty = { count: () => 0, liked: () => false };
  if (pinIds.length === 0) return empty;
  const { data, error } = await sb()
    .from('pin_likes')
    .select('pin_id, user_id')
    .in('pin_id', pinIds);
  if (error || !data) return empty;
  const counts = new Map<string, number>();
  const liked = new Set<string>();
  for (const row of data as { pin_id: string; user_id: string }[]) {
    counts.set(row.pin_id, (counts.get(row.pin_id) ?? 0) + 1);
    if (row.user_id === viewerId) liked.add(row.pin_id);
  }
  return {
    count: (id: string) => counts.get(id) ?? 0,
    liked: (id: string) => liked.has(id),
  };
}

interface RevealedRow extends PublicPinRow {
  stock_state: StockState;
  payload_text: string;
  quantity_note: string | null;
  photo_path: string | null;
  purchase_id: string;
  purchase_buyer_id: string;
  purchase_price: number;
  purchase_fee: number;
  purchase_created_at: string;
  purchase_escrow: EscrowState;
  purchase_verdict: Verdict | null;
  purchase_miss_reason: MissReason | null;
  purchase_verdict_at: string | null;
}

function purchaseFrom(row: RevealedRow): Purchase {
  return {
    id: row.purchase_id,
    pinId: row.id,
    buyerId: row.purchase_buyer_id,
    price: row.purchase_price,
    fee: row.purchase_fee,
    createdAt: ms(row.purchase_created_at),
    escrow: row.purchase_escrow,
    verdict: row.purchase_verdict,
    missReason: row.purchase_miss_reason,
    verdictAt: msOrNull(row.purchase_verdict_at),
  };
}

async function toRevealedPin(row: RevealedRow, asks: PriceAskSummary): Promise<RevealedPin> {
  return {
    ...toPublicPin(row, asks),
    stockState: row.stock_state,
    payloadText: row.payload_text,
    quantityNote: row.quantity_note,
    // バケットは非公開。読める人にだけ短命のURLが出る
    photoUri: await signPhoto(row.photo_path),
    purchase: purchaseFrom(row),
  };
}

interface PinRow extends ProofColumns {
  id: string;
  seller_id: string;
  category: CategoryId;
  lat: number;
  lng: number;
  place_label: string;
  headline: string;
  stock_state: StockState;
  payload_text: string;
  quantity_note: string | null;
  photo_path: string | null;
  price: number;
  slot_total: number;
  slot_taken: number;
  created_at: string;
  expires_at: string | null;
  status: PinStatus;
}

async function toPin(row: PinRow): Promise<Pin> {
  return {
    id: row.id,
    sellerId: row.seller_id,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    placeLabel: row.place_label,
    headline: row.headline,
    stockState: row.stock_state,
    payloadText: row.payload_text,
    quantityNote: row.quantity_note,
    photoUri: await signPhoto(row.photo_path),
    proof: proofFrom(row),
    price: row.price,
    slotTotal: row.slot_total,
    slotTaken: row.slot_taken,
    createdAt: ms(row.created_at),
    expiresAt: msOrNull(row.expires_at),
    status: row.status,
  };
}

interface ProfileRow {
  id: string;
  handle: string;
  emoji: string;
  hit_count: number;
  miss_count: number;
  gone_count: number;
  restricted_until: string | null;
}

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    handle: row.handle,
    emoji: row.emoji,
    hitCount: row.hit_count,
    missCount: row.miss_count,
    goneCount: row.gone_count,
    restrictedUntil: msOrNull(row.restricted_until),
  };
}

interface PurchaseRow {
  id: string;
  pin_id: string;
  buyer_id: string;
  price: number;
  fee: number;
  created_at: string;
  escrow: EscrowState;
  verdict: Verdict | null;
  miss_reason: MissReason | null;
  verdict_at: string | null;
}

function toPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    pinId: row.pin_id,
    buyerId: row.buyer_id,
    price: row.price,
    fee: row.fee,
    createdAt: ms(row.created_at),
    escrow: row.escrow,
    verdict: row.verdict,
    missReason: row.miss_reason,
    verdictAt: msOrNull(row.verdict_at),
  };
}

interface BountyRow {
  id: string;
  requester_id: string;
  category: CategoryId;
  lat: number;
  lng: number;
  radius_m: number;
  area_label: string;
  target_text: string;
  place_hint: string | null;
  photo_wanted: string | null;
  pay_if_absent: boolean;
  reward: number;
  accept_count: number;
  accepted_count: number;
  created_at: string;
  expires_at: string;
  status: Bounty['status'];
}

function toBounty(row: BountyRow): Bounty {
  return {
    id: row.id,
    requesterId: row.requester_id,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    radiusM: row.radius_m,
    areaLabel: row.area_label,
    targetText: row.target_text,
    placeHint: row.place_hint,
    photoWanted: row.photo_wanted,
    payIfAbsent: row.pay_if_absent,
    reward: row.reward,
    acceptCount: row.accept_count,
    acceptedCount: row.accepted_count,
    createdAt: ms(row.created_at),
    expiresAt: ms(row.expires_at),
    status: row.status,
  };
}

interface ApplicationRow extends ProofColumns {
  id: string;
  bounty_id: string;
  applicant_id: string;
  status: BountyApplication['status'];
  created_at: string;
  claim_distance_m: number | null;
  reported_at: string | null;
  report_text: string | null;
  photo_path: string | null;
  decided_at: string | null;
}

async function toApplication(row: ApplicationRow): Promise<BountyApplication> {
  return {
    id: row.id,
    bountyId: row.bounty_id,
    applicantId: row.applicant_id,
    status: row.status,
    createdAt: ms(row.created_at),
    reportedAt: msOrNull(row.reported_at),
    reportText: row.report_text,
    photoUri: await signPhoto(row.photo_path),
    proof: proofFrom(row),
    claimDistanceM: row.claim_distance_m,
    decidedAt: msOrNull(row.decided_at),
  };
}

interface QuestionRow {
  id: string;
  bounty_id: string;
  asked_by: string;
  asked_at: string;
  body: string;
  answer: string | null;
  answered_at: string | null;
}

function toQuestion(row: QuestionRow, asker?: User | null): BountyQuestion {
  return {
    id: row.id,
    bountyId: row.bounty_id,
    askedBy: row.asked_by,
    askedByHandle: asker?.handle ?? 'ゲスト',
    askedByEmoji: asker?.emoji ?? '🙂',
    askedAt: ms(row.asked_at),
    body: row.body,
    answer: row.answer,
    answeredAt: msOrNull(row.answered_at),
  };
}

interface StatsRow {
  bounty_id: string;
  heading_count: number;
  nearest_heading_m: number | null;
  reported_count: number;
}

const PUBLIC_PIN_COLUMNS =
  'id,seller_id,category,lat,lng,place_label,headline,price,slot_total,slot_taken,' +
  'created_at,expires_at,status,proof_taken_at,proof_distance_m,proof_accuracy_m,' +
  'proof_mocked,seller_handle,seller_emoji,seller_score,seller_deals';

// ---------------------------------------------------------------- 実装

export const supabaseRepository: InfoRepository = {
  async listUsers() {
    const { data } = await sb().from('profiles').select('*').order('handle');
    return ((data ?? []) as ProfileRow[]).map(toUser);
  },

  async getUser(userId) {
    const { data } = await sb().from('profiles').select('*').eq('id', userId).maybeSingle();
    return data ? toUser(data as ProfileRow) : null;
  },

  async getUserProfile(userId, now, viewerId) {
    void now;
    const viewer = viewerId ?? userId;
    const [profile, pins] = await Promise.all([
      sb().from('profiles').select('*').eq('id', userId).maybeSingle(),
      sb().from('public_pins').select(PUBLIC_PIN_COLUMNS).eq('seller_id', userId),
    ]);
    if (!profile.data) return null;

    const user = toUser(profile.data as ProfileRow);
    const rows = asRows<PublicPinRow>(pins.data);
    const [asks, likes, followerRes, followingRes, mineFollow] = await Promise.all([
      fetchAsks(
        'pin',
        rows.map((r) => r.id),
        viewer
      ),
      fetchPinLikes(
        rows.map((r) => r.id),
        viewer
      ),
      sb().from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', userId),
      sb().from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', userId),
      viewer
        ? sb()
            .from('follows')
            .select('follower_id')
            .eq('follower_id', viewer)
            .eq('followee_id', userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      id: user.id,
      handle: user.handle,
      emoji: user.emoji,
      score: sellerScore(user.hitCount, user.missCount),
      hitCount: user.hitCount,
      missCount: user.missCount,
      goneCount: user.goneCount,
      restrictedUntil: user.restrictedUntil,
      activePins: rows.map((row) => withLikes(toPublicPin(row, asks(row.id)), likes)),
      listingCount: rows.length,
      soldCount: user.hitCount + user.missCount + user.goneCount,
      // 採用された報告の件数は、他人の応募を数える必要があるので出さない。
      // ここに出すために応募の閲覧範囲を広げるのは本末転倒
      acceptedReportCount: 0,
      followerCount: followerRes.count ?? 0,
      followingCount: followingRes.count ?? 0,
      followedByMe: Boolean(mineFollow.data),
    } satisfies UserProfileView;
  },

  async followUser(viewerId, targetId) {
    if (viewerId === targetId) return;
    await sb().from('follows').upsert({ follower_id: viewerId, followee_id: targetId });
  },

  async unfollowUser(viewerId, targetId) {
    await sb().from('follows').delete().eq('follower_id', viewerId).eq('followee_id', targetId);
  },

  async togglePinLike(userId, pinId) {
    const existing = await sb()
      .from('pin_likes')
      .select('user_id')
      .eq('user_id', userId)
      .eq('pin_id', pinId)
      .maybeSingle();
    if (existing.data) {
      await sb().from('pin_likes').delete().eq('user_id', userId).eq('pin_id', pinId);
      return;
    }
    await sb().from('pin_likes').insert({ user_id: userId, pin_id: pinId });
  },

  /**
   * 期限切れの処理はサーバー側の pg_cron が回している（run_tick）。
   * クライアントからは呼べないようにしてあるので、ここは何もしない。
   */
  async tick() {
    return false;
  },

  async listPins({ viewerId, bounds }) {
    let query = sb().from('public_pins').select(PUBLIC_PIN_COLUMNS);
    if (bounds) {
      query = query
        .gte('lat', bounds.south)
        .lte('lat', bounds.north)
        .gte('lng', bounds.west)
        .lte('lng', bounds.east);
    }
    const { data } = await query.order('created_at', { ascending: false }).limit(500);
    const rows = asRows<PublicPinRow>(data);
    const ids = rows.map((r) => r.id);
    const [asks, likes] = await Promise.all([
      fetchAsks('pin', ids, viewerId),
      fetchPinLikes(ids, viewerId),
    ]);
    return rows.map((row) => withLikes(toPublicPin(row, asks(row.id)), likes));
  },

  async getPin(pinId, viewerId) {
    // 買っているなら中身まで返る。買っていなければこの行は存在しない
    const revealed = await sb()
      .from('my_revealed_pins')
      .select('*')
      .eq('id', pinId)
      .maybeSingle();
    const [asks, likes] = await Promise.all([
      fetchAsks('pin', [pinId], viewerId),
      fetchPinLikes([pinId], viewerId),
    ]);

    if (revealed.data) {
      const revealedPin = await toRevealedPin(revealed.data as RevealedRow, asks(pinId));
      return withLikes(revealedPin, likes) as typeof revealedPin;
    }

    // 自分の出品は自分では買えないので、売り手にだけは中身を返す
    const mine = await sb().from('my_pins').select('*').eq('id', pinId).maybeSingle();
    if (mine.data) {
      const pin = await toPin(mine.data as PinRow);
      return {
        ...toPublicShape(pin),
        ...(await selfBadge(pin.sellerId)),
        asks: asks(pinId),
        evidence: evidenceOfStored(pin.proof, pin.createdAt),
        likeCount: likes.count(pinId),
        likedByMe: likes.liked(pinId),
        stockState: pin.stockState,
        payloadText: pin.payloadText,
        quantityNote: pin.quantityNote,
        photoUri: pin.photoUri,
        // 売り手は買っていないので、購入の記録は形だけ埋める
        purchase: {
          id: 'self',
          pinId: pin.id,
          buyerId: viewerId,
          price: 0,
          fee: 0,
          createdAt: pin.createdAt,
          escrow: 'released',
          verdict: null,
          missReason: null,
          verdictAt: null,
        },
      };
    }

    const pub = await sb()
      .from('public_pins')
      .select(PUBLIC_PIN_COLUMNS)
      .eq('id', pinId)
      .maybeSingle();
    const row = asRow<PublicPinRow>(pub.data);
    return row ? withLikes(toPublicPin(row, asks(pinId)), likes) : null;
  },

  async createPin(input) {
    // 先に写真を上げてパスだけ渡す。DBに画像そのものは入れない
    const path = await uploadPhoto(input.photoUri, input.sellerId);
    if (!path) return { ok: false, reason: 'invalid' };

    const result = await rpc<string>('create_pin', {
      p_category: input.category,
      p_lat: input.lat,
      p_lng: input.lng,
      p_place_label: input.placeLabel,
      p_headline: input.headline,
      p_stock: input.stockState,
      p_payload: input.payloadText,
      p_quantity_note: input.quantityNote,
      p_photo_path: path,
      p_proof_distance_m: input.proof?.distanceM ?? null,
      p_proof_taken_at: input.proof ? iso(input.proof.takenAt) : null,
      p_proof_accuracy_m: input.proof?.accuracyM ?? null,
      p_proof_mocked: input.proof?.mocked ?? false,
      p_price: input.price,
      p_slot_total: input.slotTotal,
      p_ttl_minutes: input.ttlMinutes,
    });

    if (!result.ok) {
      // 出品が通らなかった写真は残さない
      await removePhoto(path);
      const reason: CreatePinResult =
        result.reason === 'restricted'
          ? { ok: false, reason: 'restricted' }
          : { ok: false, reason: 'invalid' };
      return reason;
    }

    const created = await sb().from('my_pins').select('*').eq('id', result.data).maybeSingle();
    if (!created.data) return { ok: false, reason: 'invalid' };
    return { ok: true, pin: await toPin(created.data as PinRow) };
  },

  async voidPin(pinId) {
    await rpcVoid('void_pin', { p_pin: pinId });
  },

  async listMyPins(sellerId) {
    const [pins, purchases] = await Promise.all([
      sb().from('my_pins').select('*').order('created_at', { ascending: false }),
      sb().from('purchases').select('*'),
    ]);
    const pinRows = (pins.data ?? []) as PinRow[];
    const purchaseRows = ((purchases.data ?? []) as PurchaseRow[]).map(toPurchase);
    const asks = await fetchAsks(
      'pin',
      pinRows.map((r) => r.id),
      sellerId
    );

    return Promise.all(
      pinRows.map(async (row) => {
        const pin = await toPin(row);
        const mine = purchaseRows.filter((p) => p.pinId === pin.id);
        const sum = (state: EscrowState) =>
          mine.filter((p) => p.escrow === state).reduce((acc, p) => acc + p.price - p.fee, 0);
        return {
          pin,
          purchases: mine,
          heldTotal: sum('held'),
          releasedTotal: sum('released'),
          refundedTotal: mine
            .filter((p) => p.escrow === 'refunded')
            .reduce((acc, p) => acc + p.price, 0),
          asks: asks(pin.id),
        } satisfies SellerPinView;
      })
    );
  },

  async lastPinOf() {
    const { data } = await sb()
      .from('my_pins')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? toPin(data as PinRow) : null;
  },

  async purchase(pinId, buyerId) {
    // 先着枠は RPC の中で行ロックを取って守る。ここでは判断しない
    const result = await rpc<string>('purchase_pin_slot', { p_pin: pinId });
    if (!result.ok) {
      const reason = result.reason;
      const known = [
        'sold_out',
        'expired',
        'voided',
        'own_pin',
        'already_bought',
        'insufficient_balance',
      ] as const;
      return {
        ok: false,
        reason: (known as readonly string[]).includes(reason)
          ? (reason as PurchaseResult extends { ok: false; reason: infer R } ? R : never)
          : 'not_found',
      };
    }

    const pin = await this.getPin(pinId, buyerId, Date.now());
    if (!pin || !('payloadText' in pin)) return { ok: false, reason: 'not_found' };
    return { ok: true, pin };
  },

  async listMyPurchases(buyerId) {
    const { data } = await sb()
      .from('my_revealed_pins')
      .select('*')
      .order('purchase_created_at', { ascending: false });
    const rows = (data ?? []) as RevealedRow[];
    const asks = await fetchAsks(
      'pin',
      rows.map((r) => r.id),
      buyerId
    );
    return Promise.all(rows.map((row) => toRevealedPin(row, asks(row.id))));
  },

  async submitVerdict(purchaseId, buyerId, verdict, reason) {
    void buyerId;
    await rpcVoid('submit_verdict', {
      p_purchase: purchaseId,
      p_verdict: verdict,
      p_reason: verdict === 'miss' ? reason : null,
    });
  },

  async listBounties({ viewerId }) {
    const { data } = await sb()
      .from('bounties')
      .select('*')
      .order('created_at', { ascending: false });
    const rows = (data ?? []) as BountyRow[];
    return buildBountyViews(rows, viewerId);
  },

  async getBounty(bountyId, viewerId) {
    const { data } = await sb().from('bounties').select('*').eq('id', bountyId).maybeSingle();
    if (!data) return null;
    const views = await buildBountyViews([data as BountyRow], viewerId);
    return views[0] ?? null;
  },

  async listApplications(bountyId) {
    // ビューが依頼者と本人以外に行を返さないので、絞り込みはサーバー側で終わっている
    const { data } = await sb()
      .from('bounty_applications_view')
      .select('*')
      .eq('bounty_id', bountyId)
      .order('created_at');
    return Promise.all(((data ?? []) as ApplicationRow[]).map(toApplication));
  },

  async createBounty(input) {
    const result = await rpc<string>('create_bounty', {
      p_category: input.category,
      p_lat: input.lat,
      p_lng: input.lng,
      p_radius_m: input.radiusM,
      p_area_label: input.areaLabel,
      p_target_text: input.targetText,
      p_place_hint: input.placeHint,
      p_photo_wanted: input.photoWanted,
      p_pay_if_absent: input.payIfAbsent,
      p_reward: input.reward,
      p_accept_count: input.acceptCount,
      p_ttl_minutes: input.ttlMinutes,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason === 'insufficient_balance' ? 'insufficient_balance' : 'invalid',
      };
    }
    const created = await sb().from('bounties').select('*').eq('id', result.data).maybeSingle();
    if (!created.data) return { ok: false, reason: 'invalid' };
    return { ok: true, bounty: toBounty(created.data as BountyRow) };
  },

  async applyToBounty(bountyId, userId, claimDistanceM) {
    void userId;
    const result = await rpc<string>('apply_to_bounty', {
      p_bounty: bountyId,
      p_distance_m: claimDistanceM,
    });
    if (result.ok) return { ok: true };
    const known = ['closed', 'own_bounty', 'duplicate', 'too_many'] as const;
    return {
      ok: false,
      reason: (known as readonly string[]).includes(result.reason)
        ? (result.reason as ApplyResult extends { ok: false; reason: infer R } ? R : never)
        : 'not_found',
    };
  },

  async reportToBounty(applicationId, applicantId, report) {
    const path = await uploadPhoto(report.photoUri, applicantId);
    if (!path) return { ok: false, reason: 'photo_required' };

    const result = await rpc<null>('report_to_bounty', {
      p_application: applicationId,
      p_text: report.text.trim(),
      p_photo_path: path,
      p_proof_distance_m: report.proof?.distanceM ?? null,
      p_proof_taken_at: report.proof ? iso(report.proof.takenAt) : null,
      p_proof_accuracy_m: report.proof?.accuracyM ?? null,
      p_proof_mocked: report.proof?.mocked ?? false,
    });

    if (!result.ok) {
      await removePhoto(path);
      const known = ['not_heading', 'closed', 'photo_required'] as const;
      return {
        ok: false,
        reason: (known as readonly string[]).includes(result.reason)
          ? (result.reason as ReportResult extends { ok: false; reason: infer R } ? R : never)
          : 'not_found',
      };
    }
    // 自動採用は猶予が切れてから pg_cron が判断する
    return { ok: true, accepted: false };
  },

  async decideApplication(applicationId, requesterId, accept) {
    void requesterId;
    await rpcVoid(
      accept ? 'accept_bounty_application' : 'reject_bounty_application',
      { p_application: applicationId }
    );
  },

  async cancelBounty(bountyId) {
    await rpcVoid('close_bounty', { p_bounty: bountyId });
  },

  async askQuestion(bountyId, body) {
    await rpcVoid('ask_question', { p_bounty: bountyId, p_body: body.trim() });
  },

  async answerQuestion(questionId, requesterId, answer) {
    void requesterId;
    await rpcVoid('answer_question', { p_question: questionId, p_answer: answer.trim() });
  },

  async askPriceChange(targetKind, targetId, userId, desired) {
    void userId;
    const result = await rpc<null>('set_price_ask', {
      p_kind: targetKind,
      p_target: targetId,
      p_desired: desired,
    });
    if (result.ok) return { ok: true };
    const known = ['closed', 'own_item', 'invalid'] as const;
    return {
      ok: false,
      reason: (known as readonly string[]).includes(result.reason)
        ? (result.reason as AskResult extends { ok: false; reason: infer R } ? R : never)
        : 'not_found',
    };
  },

  async withdrawPriceAsk(targetKind, targetId) {
    await rpcVoid('withdraw_price_ask', { p_kind: targetKind, p_target: targetId });
  },

  async applyPriceChange(targetKind, targetId, ownerId, amount) {
    void ownerId;
    const result = await rpc<null>('apply_price_change', {
      p_kind: targetKind,
      p_target: targetId,
      p_amount: amount,
    });
    if (result.ok) return { ok: true };
    const known = ['forbidden', 'closed', 'insufficient_balance'] as const;
    if ((known as readonly string[]).includes(result.reason)) {
      return {
        ok: false,
        reason: result.reason as ApplyPriceResult extends { ok: false; reason: infer R }
          ? R
          : never,
      };
    }
    return { ok: false, reason: result.reason === 'invalid_amount' ? 'invalid' : 'not_found' };
  },

  async getBalance(userId) {
    void userId;
    // 本人の1行しか返らないビュー。残高カラムは持たず台帳の合計から出る
    const { data } = await sb().from('balances').select('available,pending').maybeSingle();
    return (data as Balance | null) ?? { available: 0, pending: 0 };
  },

  async listWalletEntries() {
    const { data } = await sb()
      .from('wallet_entries')
      .select('*')
      .order('created_at', { ascending: false });
    return ((data ?? []) as {
      id: string;
      user_id: string;
      kind: LedgerKind;
      available_delta: number;
      pending_delta: number;
      memo: string;
      ref_id: string | null;
      created_at: string;
    }[]).map<WalletEntry>((row) => ({
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      availableDelta: row.available_delta,
      pendingDelta: row.pending_delta,
      memo: row.memo,
      refId: row.ref_id,
      createdAt: ms(row.created_at),
    }));
  },

  async requestPayout(userId, amount) {
    void userId;
    const result = await rpc<string>('request_payout', { p_amount: amount });
    if (result.ok) return { ok: true };
    return {
      ok: false,
      reason: result.reason === 'insufficient_balance' ? 'insufficient_balance' : 'invalid',
    };
  },

  async listPayouts() {
    const { data } = await sb()
      .from('payout_requests')
      .select('*')
      .order('created_at', { ascending: false });
    return ((data ?? []) as {
      id: string;
      user_id: string;
      amount: number;
      status: PayoutRequest['status'];
      created_at: string;
    }[]).map<PayoutRequest>((row) => ({
      id: row.id,
      userId: row.user_id,
      amount: row.amount,
      status: row.status,
      createdAt: ms(row.created_at),
    }));
  },

  async createReport(reporterId, targetKind, targetId, reason) {
    void reporterId;
    const result = await rpc<ReportResultKind>('create_report', {
      p_kind: targetKind,
      p_target: targetId,
      p_reason: reason,
    });
    return result.ok ? (result.data ?? 'recorded') : 'recorded';
  },

  /**
   * 端末の保存量ではなくサーバー側の件数を返す。
   * 写真は Storage にあり、利用者ごとの合計は公開鍵では引けないので0にしてある。
   */
  async storageUsage() {
    const [pins, bounties, wallet] = await Promise.all([
      sb().from('my_pins').select('id', { count: 'exact', head: true }),
      sb().from('bounties').select('id', { count: 'exact', head: true }),
      sb().from('wallet_entries').select('id', { count: 'exact', head: true }),
    ]);
    return {
      recordBytes: 0,
      photoBytes: 0,
      pins: pins.count ?? 0,
      bounties: bounties.count ?? 0,
      ledgerEntries: wallet.count ?? 0,
    } satisfies StorageUsage;
  },

  /** サーバー側のデータを消す手段は置かない。デモ用の初期化はローカル実装だけの機能 */
  async resetAll() {
    throw new Error('reset_not_supported');
  },
};

/** 自分の出品を自分で見るときの表示名。profiles から引く */
async function selfBadge(sellerId: UserId) {
  const { data } = await sb().from('profiles').select('*').eq('id', sellerId).maybeSingle();
  const user = data ? toUser(data as ProfileRow) : null;
  return {
    sellerId,
    sellerHandle: user?.handle ?? '不明',
    sellerEmoji: user?.emoji ?? '❔',
    sellerScore: user ? sellerScore(user.hitCount, user.missCount) : null,
    sellerDeals: user ? user.hitCount + user.missCount : 0,
  };
}

/**
 * 依頼の一覧を組む。
 *
 * 人数と最短距離は bounty_stats から取る。応募の明細は依頼者と本人しか読めないので、
 * 第三者に見せる混み具合は個人を含まない集計ビュー越しにする。
 */
async function buildBountyViews(rows: BountyRow[], viewerId: UserId): Promise<BountyView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const [profiles, stats, questions, mine, asks] = await Promise.all([
    sb().from('profiles').select('*').in('id', rows.map((r) => r.requester_id)),
    sb().from('bounty_stats').select('*').in('bounty_id', ids),
    sb().from('bounty_questions').select('*').in('bounty_id', ids).order('asked_at'),
    viewerId
      ? sb()
          .from('bounty_applications_view')
          .select('*')
          .in('bounty_id', ids)
          .eq('applicant_id', viewerId)
      : Promise.resolve({ data: [] }),
    fetchAsks('bounty', ids, viewerId),
  ]);

  const profileById = new Map(
    ((profiles.data ?? []) as ProfileRow[]).map((p) => [p.id, toUser(p)])
  );
  const rawQuestions = (questions.data ?? []) as QuestionRow[];
  const missingAskers = [
    ...new Set(rawQuestions.map((q) => q.asked_by).filter((id) => !profileById.has(id))),
  ];
  if (missingAskers.length) {
    const extra = await sb().from('profiles').select('*').in('id', missingAskers);
    for (const row of (extra.data ?? []) as ProfileRow[]) {
      profileById.set(row.id, toUser(row));
    }
  }
  const statsById = new Map(((stats.data ?? []) as StatsRow[]).map((s) => [s.bounty_id, s]));
  const questionRows = rawQuestions.map((row) => toQuestion(row, profileById.get(row.asked_by)));
  const myApplications = await Promise.all(
    ((mine.data ?? []) as ApplicationRow[]).map(toApplication)
  );

  return rows.map((row) => {
    const bounty = toBounty(row);
    const requester = profileById.get(row.requester_id);
    const stat = statsById.get(row.id);
    const list = questionRows.filter((q) => q.bountyId === bounty.id);
    const mineForBounty = myApplications.filter((a) => a.bountyId === bounty.id);

    return {
      ...bounty,
      requesterHandle: requester?.handle ?? '不明',
      requesterEmoji: requester?.emoji ?? '❔',
      headingCount: stat?.heading_count ?? 0,
      nearestHeadingM:
        stat?.nearest_heading_m === null || stat?.nearest_heading_m === undefined
          ? null
          : Math.round(stat.nearest_heading_m),
      reportedCount: stat?.reported_count ?? 0,
      questions: list,
      openQuestionCount: list.filter((q) => q.answer === null).length,
      myApplication:
        mineForBounty.find((a) => a.status !== 'lapsed') ?? mineForBounty[0] ?? null,
      asks: asks(bounty.id),
    } satisfies BountyView;
  });
}

/** 未採用の枠数。画面側と同じ関数を使う */
export { bountyRemainingSlots };
