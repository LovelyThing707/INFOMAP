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

/**
 * 「違っていた」の中身。
 *
 * 腐る情報なので、着いたら無かったことと、そもそも嘘だったことは意味がまったく違う。
 * 前者は正常な結果なので返金はしても出品者の記録は汚さない。
 */
export type MissReason =
  /** 着いたときには売り切れていた。出品者の落ち度ではない */
  | 'gone'
  /** 写真が別の場所、または明らかに古い */
  | 'wrong_place'
  /** 書かれている内容が薄すぎて役に立たない */
  | 'too_thin';

/**
 * 写真を撮ったときに端末が記録した位置と時刻。
 *
 * ライブラリから持ち込んだ画像には付かない。
 * 「その場にいた」を自己申告ではなく端末の記録で示すためのもの。
 */
export interface PhotoProof {
  lat: number;
  lng: number;
  takenAt: number;
  /** 端末が申告した測位誤差(m)。取れないことがある */
  accuracyM: number | null;
  /**
   * 端末が「この座標は偽装されている」と申告したか（Androidのみ取得できる）。
   * 偽装アプリを完全に見抜けるわけではないが、手軽な偽装はここで落ちる。
   */
  mocked: boolean;
}

/**
 * 保存する形の裏づけ。
 *
 * 生の緯度経度は持たない。撮った直後に対象からの距離へ落とし、座標は捨てる。
 * 住宅地の座標が残ると「私人の所在・追跡は扱わない」という自分たちの禁止事項と
 * 食い違うため。サーバーへも距離だけを送るので、通信経路にも座標が載らない。
 */
export interface StoredProof {
  /** 対象（ピンや依頼の中心）から何m離れて撮られたか */
  distanceM: number;
  takenAt: number;
  accuracyM: number | null;
  mocked: boolean;
}

/** 撮影の裏づけがどれだけ強いか */
export type ProofLevel =
  /** ピンの近くで、出品の直前に撮られている */
  | 'onsite'
  /** 記録はあるが、場所が離れているか、誤差が大きすぎて確かめられない */
  | 'offsite'
  /** 端末が位置の偽装を申告した */
  | 'mocked'
  /** 端末の記録がない（持ち込み画像） */
  | 'none';

/**
 * 購入前の人に見せてよい撮影の裏づけ。写真そのものは含めない。
 * 何を買うのか判断できるだけの材料を、中身を渡さずに出すためのもの。
 */
export interface PhotoEvidence {
  level: ProofLevel;
  takenAt: number | null;
  /** ピンの座標から何m離れて撮られたか */
  distanceM: number | null;
}

export type BountyStatus = 'open' | 'filled' | 'expired' | 'cancelled';
export type ApplicationStatus = 'heading' | 'reported' | 'accepted' | 'rejected' | 'lapsed';

export interface User {
  id: UserId;
  handle: string;
  emoji: string;
  hitCount: number;
  /** 出品者の落ち度による「違っていた」。スコアと制限はこれだけで決まる */
  missCount: number;
  /** 着いたら売り切れていた件数。返金はするが落ち度ではないので別に数える */
  goneCount: number;
  /** 「違っていた」の申告が続いたときの出品停止。null なら制限なし */
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
  /** アプリ内で撮ったときだけ入る。持ち込み画像は null */
  proof: StoredProof | null;

  price: number;
  slotTotal: number;
  slotTaken: number;
  createdAt: number;
  /** null は無期限。出品者が止めるか、着いたら無かった申告で消える */
  expiresAt: number | null;
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
  /** 情報どおりだった割合。買い手からの申告がなければ null */
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
  expiresAt: number | null;
  status: PinStatus;
  asks: PriceAskSummary;
  /** 写真は渡さないが、撮影の裏づけだけは買う前に見せる */
  evidence: PhotoEvidence;
  likeCount: number;
  likedByMe: boolean;
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
  goneCount: number;
  restrictedUntil: number | null;
  activePins: PublicPin[];
  listingCount: number;
  soldCount: number;
  acceptedReportCount: number;
  followerCount: number;
  followingCount: number;
  followedByMe: boolean;
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
  /** verdict が miss のときだけ入る */
  missReason: MissReason | null;
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
  /**
   * 応募者がいちばん知りたい3つ。書いてあれば質問が要らなくなるので、
   * 依頼フォームで先に聞いてしまう。
   */
  placeHint: string | null;
  photoWanted: string | null;
  /**
   * 対象が無かった場合も報酬を出すか。
   * ここが曖昧だと「行って無かったら丸損か」が分からず、応募をためらわれる。
   */
  payIfAbsent: boolean;
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
  /** 依頼の範囲内で撮ったことの裏づけ。自動採用の条件になる */
  proof: StoredProof | null;
  /**
   * 「向かう」を押した地点から依頼中心までの距離(m)。
   * 生の座標は持たない。依頼者にも出発地点は渡さない。
   */
  claimDistanceM: number | null;
  decidedAt: number | null;
}

/**
 * 依頼への質問と、依頼者の回答。
 *
 * 公開で、誰でも読める。同じことを何人にも聞かれずに済む。
 * 1問1答に留めてチャットにはしない。依頼は数十分で消えるので、
 * 往復が始まると答えが出る前に終わってしまう。
 */
export interface BountyQuestion {
  id: string;
  bountyId: string;
  askedBy: UserId;
  askedByHandle: string;
  askedByEmoji: string;
  askedAt: number;
  body: string;
  answer: string | null;
  answeredAt: number | null;
}

export interface BountyView extends Bounty {
  requesterHandle: string;
  requesterEmoji: string;
  /** 向かっている人数。殺到を抑えるために応募前から見せる */
  headingCount: number;
  /**
   * 向かっている人のうち、いちばん近い人が応募した地点までの距離(m)。
   * 人数だけでは「5km先に3人」と「100m先に1人」が区別できない
   */
  nearestHeadingM: number | null;
  reportedCount: number;
  /** 自分の応募（あれば） */
  myApplication: BountyApplication | null;
  asks: PriceAskSummary;
  questions: BountyQuestion[];
  /** 依頼者がまだ答えていない質問の数 */
  openQuestionCount: number;
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

/** 通報の理由。自由文だと集計できず、対応の判断もつかない */
export type ReportReason =
  /** 扱わないと決めている種類の情報 */
  | 'forbidden'
  /** 書かれている内容が事実と違う */
  | 'false_info'
  /** 写真が現地のものではない、または明らかに古い */
  | 'stale_photo'
  | 'other';

export interface Report {
  id: string;
  reporterId: UserId;
  targetKind: 'pin' | 'bounty';
  targetId: string;
  reason: ReportReason;
  createdAt: number;
}
