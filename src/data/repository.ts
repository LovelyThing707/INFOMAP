import type {
  AskTargetKind,
  Balance,
  Bounds,
  Bounty,
  BountyApplication,
  BountyView,
  CategoryId,
  LatLng,
  MissReason,
  PayoutRequest,
  Pin,
  PinId,
  PriceAskSummary,
  PublicPin,
  Purchase,
  ReportReason,
  RevealedPin,
  StockState,
  StoredProof,
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
  /** 撮影の裏づけ。座標ではなく、立てるピンからの距離に落としたもの */
  proof: StoredProof | null;
  price: number;
  slotTotal: number;
  /** null は無期限 */
  ttlMinutes: number | null;
}

export interface CreateBountyInput {
  requesterId: UserId;
  category: CategoryId;
  lat: number;
  lng: number;
  radiusM: number;
  areaLabel: string;
  targetText: string;
  placeHint: string | null;
  photoWanted: string | null;
  payIfAbsent: boolean;
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

export type ApplyFailure =
  | 'not_found'
  | 'closed'
  | 'own_bounty'
  | 'duplicate'
  /** 同時に持てる応募の上限に達している */
  | 'too_many';
export type ApplyResult = { ok: true } | { ok: false; reason: ApplyFailure };

/** 通報がどう扱われたか。押した人に結果を返さないと、届いたのか分からない */
export type ReportResultKind = 'recorded' | 'already' | 'voided';

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

export interface StorageUsage {
  /** 台帳や出品などの記録が占めるバイト数 */
  recordBytes: number;
  /** 写真が占めるバイト数。Web では常に0（カメラが使えないため） */
  photoBytes: number;
  pins: number;
  bounties: number;
  ledgerEntries: number;
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
  getUserProfile(userId: UserId, now: number, viewerId?: UserId): Promise<UserProfileView | null>;

  followUser(viewerId: UserId, targetId: UserId): Promise<void>;
  unfollowUser(viewerId: UserId, targetId: UserId): Promise<void>;
  togglePinLike(userId: UserId, pinId: PinId): Promise<void>;

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
  /**
   * 情報が合っていたかの申告。miss のときは理由が要る。
   * 「着いたら無くなっていた」は返金するが、出品者の記録には残さない。
   */
  submitVerdict(
    purchaseId: string,
    buyerId: UserId,
    verdict: 'hit' | 'miss',
    reason: MissReason | null,
    now: number
  ): Promise<void>;

  listBounties(params: ListBountiesParams): Promise<BountyView[]>;
  getBounty(bountyId: string, viewerId: UserId, now: number): Promise<BountyView | null>;
  /**
   * 応募の中身（報告文・写真）は依頼者と本人にだけ返す。
   * 依頼IDさえ分かれば第三者が全部読める、という状態を避ける。
   */
  listApplications(bountyId: string, viewerId: UserId): Promise<BountyApplication[]>;
  createBounty(input: CreateBountyInput, now: number): Promise<CreateBountyResult>;
  /**
   * 「向かう」。移動は追跡しないので、押した時点の位置だけを裏づけとして受け取る。
   * 遠すぎる場所からは応募させない。
   */
  /** 押した地点から依頼中心までの距離。座標そのものは渡さない */
  applyToBounty(
    bountyId: string,
    userId: UserId,
    claimDistanceM: number,
    now: number
  ): Promise<ApplyResult>;
  reportToBounty(
    applicationId: string,
    applicantId: UserId,
    report: { text: string; photoUri: string | null; proof: StoredProof | null },
    now: number
  ): Promise<ReportResult>;
  decideApplication(
    applicationId: string,
    requesterId: UserId,
    accept: boolean,
    now: number
  ): Promise<void>;
  cancelBounty(bountyId: string, requesterId: UserId, now: number): Promise<void>;

  /** 質問を投げる。答え待ちを何本も抱えられないよう、1人1本まで */
  askQuestion(bountyId: string, body: string, userId: UserId, now: number): Promise<void>;
  /** 依頼者が答える。答えは公開される */
  answerQuestion(
    questionId: string,
    requesterId: UserId,
    answer: string,
    now: number
  ): Promise<void>;

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

  /**
   * 通報。同じ人の重ね押しは1件に丸める。
   * 別々の人から一定数集まると、その場で取り下げて未確定の代金を返す。
   */
  createReport(
    reporterId: UserId,
    targetKind: 'pin' | 'bounty',
    targetId: string,
    reason: ReportReason,
    now: number
  ): Promise<ReportResultKind>;

  /**
   * いま何をどれだけ抱えているか。
   * 保存領域の上限が近いことに、埋まってから気づくのを避けるために出す。
   */
  storageUsage(): Promise<StorageUsage>;

  /** デモ用。全データを消してシードを入れ直す */
  resetAll(now: number): Promise<void>;
}
