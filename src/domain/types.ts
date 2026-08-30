export type UserId = string;
export type PinId = string;
export type PurchaseId = string;
export type BountyId = string;
export type ApplicationId = string;

export type LatLng = { lat: number; lng: number };
export type Bounds = { north: number; south: number; east: number; west: number };

export type CategoryId = 'shelf_stock' | 'queue' | 'vacancy';

/** 店頭在庫カテゴリの「今の状態」 */
export type StockState = 'in_stock' | 'few' | 'out';

/** 売り切れと期限切れは createdAt / slotTaken から導出するので、保存するのはこの2つだけ */
export type PinStatus = 'active' | 'voided';

export type EscrowState = 'held' | 'released' | 'refunded';
export type Verdict = 'hit' | 'miss';

export type BountyStatus = 'open' | 'filled' | 'expired' | 'cancelled';
export type ApplicationStatus = 'heading' | 'reported' | 'accepted' | 'rejected' | 'lapsed';

export interface User {
  id: UserId;
  handle: string;
  emoji: string;
  hitCount: number;
  missCount: number;
  /** 外れが続いたときの出品停止。null なら制限なし */
  restrictedUntil: number | null;
}

/**
 * 保存されているピンの完全な形。payloadText と photoUri を含むので、
 * これをそのまま画面へ渡してはいけない。リポジトリの外に出るのは PublicPin か RevealedPin。
 */
export interface Pin {
  id: PinId;
  sellerId: UserId;
  category: CategoryId;
  lat: number;
  lng: number;
  placeLabel: string;
  /** 購入前でも見せる見出し。何の情報かまで */
  headline: string;
  stockState: StockState;

  /** ここから下は購入者だけが見られる */
  payloadText: string;
  quantityNote: string | null;
  photoUri: string | null;

  price: number;
  slotTotal: number;
  slotTaken: number;
  createdAt: number;
  expiresAt: number;
  status: PinStatus;
}

export type AskTargetKind = 'pin' | 'bounty';

/**
 * 「この値段なら動く」という一票。
 * 売り物には値下げ、依頼には値上げの希望額を置ける。
 * 数分で消える情報を扱うので、交渉のやりとりはせず、票が集まったら持ち主が一度で決める。
 */
export interface PriceAsk {
  id: string;
  targetKind: AskTargetKind;
  targetId: string;
  userId: UserId;
  desired: number;
  createdAt: number;
}

export interface PriceAskSummary {
  count: number;
  /** 希望額の中央値。ここに合わせれば半分以上が動く */
  median: number;
  /** 自分が出している希望額 */
  mine: number | null;
}

export interface SellerBadge {
  sellerId: UserId;
  sellerHandle: string;
  sellerEmoji: string;
  /** 当たり率。判定実績がなければ null */
  sellerScore: number | null;
  sellerDeals: number;
}

/**
 * 未購入者に渡す形。Pin を継承せず、伏せるフィールドを構造として持たない。
 * UIでマスクするのではなく、そもそも届かないようにする。
 */
export interface PublicPin extends SellerBadge {
  id: PinId;
  category: CategoryId;
  lat: number;
  lng: number;
  placeLabel: string;
  headline: string;
  price: number;
  slotTotal: number;
  slotTaken: number;
  createdAt: number;
  expiresAt: number;
  status: PinStatus;
  asks: PriceAskSummary;
}

/** 購入済みのときだけ返る形 */
export interface RevealedPin extends PublicPin {
  stockState: StockState;
  payloadText: string;
  quantityNote: string | null;
  photoUri: string | null;
  purchase: Purchase;
}

/**
 * 他人に見せてよい範囲だけをまとめたプロフィール。
 * 残高や購入履歴は含めない。買い手が知りたいのは「どれくらい当たるか」と「いま何を出しているか」。
 */
export interface UserProfileView {
  id: UserId;
  handle: string;
  emoji: string;
  score: number | null;
  hitCount: number;
  missCount: number;
  restrictedUntil: number | null;
  activePins: PublicPin[];
  listingCount: number;
  soldCount: number;
  acceptedReportCount: number;
}

export interface Purchase {
  id: PurchaseId;
  pinId: PinId;
  buyerId: UserId;
  price: number;
  fee: number;
  createdAt: number;
  escrow: EscrowState;
  verdict: Verdict | null;
  verdictAt: number | null;
}

export interface Bounty {
  id: BountyId;
  requesterId: UserId;
  category: CategoryId;
  lat: number;
  lng: number;
  radiusM: number;
  areaLabel: string;
  /** 何を確認してほしいか */
  targetText: string;
  reward: number;
  acceptCount: number;
  acceptedCount: number;
  createdAt: number;
  expiresAt: number;
  status: BountyStatus;
}

export interface BountyApplication {
  id: ApplicationId;
  bountyId: BountyId;
  applicantId: UserId;
  status: ApplicationStatus;
  createdAt: number;
  reportedAt: number | null;
  reportText: string | null;
  photoUri: string | null;
  decidedAt: number | null;
}

export interface BountyView extends Bounty {
  requesterHandle: string;
  requesterEmoji: string;
  /** 向かっている人数。殺到を抑えるために応募前から見せる */
  headingCount: number;
  reportedCount: number;
  /** 自分の応募（あれば） */
  myApplication: BountyApplication | null;
  asks: PriceAskSummary;
}

export type LedgerKind =
  | 'topup'
  | 'purchase_hold'
  | 'purchase_settle'
  | 'purchase_refund'
  | 'sale_income'
  | 'platform_fee'
  | 'bounty_hold'
  | 'bounty_return'
  | 'bounty_payout'
  | 'bounty_income'
  | 'payout';

/**
 * 残高は持たず、この台帳の合計から導出する。
 * available と pending の増減を1行に両方持たせることで、移動が1行で表現できる。
 */
export interface WalletEntry {
  id: string;
  userId: UserId;
  kind: LedgerKind;
  availableDelta: number;
  pendingDelta: number;
  memo: string;
  refId: string | null;
  createdAt: number;
}

export interface Balance {
  available: number;
  pending: number;
}

export interface PayoutRequest {
  id: string;
  userId: UserId;
  amount: number;
  status: 'requested' | 'paid';
  createdAt: number;
}

export interface Report {
  id: string;
  reporterId: UserId;
  targetKind: 'pin' | 'bounty';
  targetId: string;
  reason: string;
  createdAt: number;
}
