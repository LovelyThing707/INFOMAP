import type {
  AskTargetKind,
  Balance,
  Bounds,
  Bounty,
  BountyApplication,
  BountyView,
  CategoryId,
  LatLng,
  PayoutRequest,
  Pin,
  PinId,
  PriceAskSummary,
  PublicPin,
  Purchase,
  RevealedPin,
  StockState,
  User,
  UserId,
  UserProfileView,
  WalletEntry,
} from '@/domain/types';

export interface CreatePinInput {
  sellerId: UserId;
  category: CategoryId;
  lat: number;
  lng: number;
  placeLabel: string;
  headline: string;
  stockState: StockState;
  payloadText: string;
  quantityNote: string | null;
  photoUri: string | null;
  price: number;
  slotTotal: number;
  ttlMinutes: number;
}

export interface CreateBountyInput {
  requesterId: UserId;
  category: CategoryId;
  lat: number;
  lng: number;
  radiusM: number;
  areaLabel: string;
  targetText: string;
  reward: number;
  acceptCount: number;
  ttlMinutes: number;
}

export type CreatePinFailure = 'restricted' | 'outside_area' | 'invalid';
export type CreatePinResult =
  | { ok: true; pin: Pin }
  | { ok: false; reason: CreatePinFailure };

export type PurchaseFailure =
  | 'not_found'
  | 'voided'
  | 'expired'
  | 'sold_out'
  | 'own_pin'
  | 'already_bought'
  | 'insufficient_balance';
export type PurchaseResult =
  | { ok: true; pin: RevealedPin }
  | { ok: false; reason: PurchaseFailure };

export type CreateBountyFailure = 'outside_area' | 'invalid' | 'insufficient_balance';
export type CreateBountyResult =
  | { ok: true; bounty: Bounty }
  | { ok: false; reason: CreateBountyFailure };

export type ApplyFailure = 'not_found' | 'closed' | 'own_bounty' | 'duplicate';
export type ApplyResult = { ok: true } | { ok: false; reason: ApplyFailure };

export type ReportFailure = 'not_found' | 'not_heading' | 'closed' | 'photo_required';
export type ReportResult = { ok: true; accepted: boolean } | { ok: false; reason: ReportFailure };

export type PayoutFailure = 'insufficient_balance' | 'invalid';
export type PayoutResult = { ok: true } | { ok: false; reason: PayoutFailure };

export type AskFailure = 'not_found' | 'closed' | 'own_item' | 'invalid';
export type AskResult = { ok: true } | { ok: false; reason: AskFailure };

export type ApplyPriceFailure =
  | 'not_found'
  | 'forbidden'
  | 'closed'
  | 'invalid'
  | 'insufficient_balance';
export type ApplyPriceResult = { ok: true } | { ok: false; reason: ApplyPriceFailure };

/** 自分が出した情報の状態。売り手にだけ全文を返す */
export interface SellerPinView {
  pin: Pin;
  purchases: Purchase[];
  heldTotal: number;
  releasedTotal: number;
  refundedTotal: number;
  asks: PriceAskSummary;
}

export interface ListPinsParams {
  viewerId: UserId;
  now: number;
  /** 表示領域。渡された場合はこの範囲のピンだけを返す */
  bounds?: Bounds;
}

export interface ListBountiesParams {
  viewerId: UserId;
  now: number;
  origin?: LatLng;
}

/**
 * 購入前のピンには payloadText と photoUri を含めない、というのがこの層の契約。
 * 実装（ローカル / Supabase）を差し替えても、この境界は変えない。
 */
export interface InfoRepository {
  listUsers(): Promise<User[]>;
  getUser(userId: UserId): Promise<User | null>;
  /** 他人に見せてよい範囲のプロフィール */
  getUserProfile(userId: UserId, now: number): Promise<UserProfileView | null>;

  /** 期限切れの自動処理と、猶予を過ぎた購入の自動確定をまとめて回す。何か動いたら true */
  tick(now: number): Promise<boolean>;

  listPins(params: ListPinsParams): Promise<PublicPin[]>;
  getPin(pinId: PinId, viewerId: UserId, now: number): Promise<PublicPin | RevealedPin | null>;
  createPin(input: CreatePinInput, now: number): Promise<CreatePinResult>;
  voidPin(pinId: PinId, sellerId: UserId, now: number): Promise<void>;
  listMyPins(sellerId: UserId, now: number): Promise<SellerPinView[]>;
  /** 直近の出品。「もう一度出す」のプリフィル用 */
  lastPinOf(sellerId: UserId): Promise<Pin | null>;

  purchase(pinId: PinId, buyerId: UserId, now: number): Promise<PurchaseResult>;
  listMyPurchases(buyerId: UserId, now: number): Promise<RevealedPin[]>;
  submitVerdict(purchaseId: string, verdict: 'hit' | 'miss', now: number): Promise<void>;

  listBounties(params: ListBountiesParams): Promise<BountyView[]>;
  getBounty(bountyId: string, viewerId: UserId, now: number): Promise<BountyView | null>;
  listApplications(bountyId: string): Promise<BountyApplication[]>;
  createBounty(input: CreateBountyInput, now: number): Promise<CreateBountyResult>;
  applyToBounty(bountyId: string, userId: UserId, now: number): Promise<ApplyResult>;
  reportToBounty(
    applicationId: string,
    report: { text: string; photoUri: string | null },
    now: number
  ): Promise<ReportResult>;
  decideApplication(applicationId: string, accept: boolean, now: number): Promise<void>;
  cancelBounty(bountyId: string, requesterId: UserId, now: number): Promise<void>;

  /**
   * 「この額なら動く」という希望を出す。売り物には値下げ、依頼には値上げ。
   * 同じ人が出し直したら上書きになる。
   */
  askPriceChange(
    targetKind: AskTargetKind,
    targetId: string,
    userId: UserId,
    desired: number,
    now: number
  ): Promise<AskResult>;
  withdrawPriceAsk(targetKind: AskTargetKind, targetId: string, userId: UserId): Promise<void>;
  /** 持ち主が値段を動かす。依頼の値上げは差額を追加で預かる */
  applyPriceChange(
    targetKind: AskTargetKind,
    targetId: string,
    ownerId: UserId,
    amount: number,
    now: number
  ): Promise<ApplyPriceResult>;

  getBalance(userId: UserId): Promise<Balance>;
  listWalletEntries(userId: UserId): Promise<WalletEntry[]>;
  requestPayout(userId: UserId, amount: number, now: number): Promise<PayoutResult>;
  listPayouts(userId: UserId): Promise<PayoutRequest[]>;

  createReport(
    reporterId: UserId,
    targetKind: 'pin' | 'bounty',
    targetId: string,
    reason: string,
    now: number
  ): Promise<void>;

  /** デモ用。全データを消してシードを入れ直す */
  resetAll(now: number): Promise<void>;
}
