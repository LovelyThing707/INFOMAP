import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  bountyRemainingSlots,
  boundsContain,
  canPost,
  distanceM,
  feeFor,
  isAutoAcceptDue,
  isBountyOpen,
  isExpired,
  isInsideArea,
  isOnMap,
  isPurchasable,
  isSettleable,
  isSoldOut,
  MAX_PRICE,
  medianOf,
  MIN_PRICE,
  RESTRICT_DURATION_MS,
  sellerScore,
  shouldRestrict,
  toPublicShape,
} from '@/domain/rules';
import type {
  AskTargetKind,
  Balance,
  Bounty,
  BountyApplication,
  BountyView,
  PayoutRequest,
  Pin,
  PriceAskSummary,
  PublicPin,
  Purchase,
  Report,
  RevealedPin,
  SellerBadge,
  User,
  UserId,
  UserProfileView,
  WalletEntry,
} from '@/domain/types';

import { newId } from './ids';
import {
  balanceOf,
  holdForBounty,
  holdForPurchase,
  payBounty,
  refundPurchase,
  returnBounty,
  settlePurchase,
  withdraw,
} from './ledger';
import type {
  ApplyPriceResult,
  ApplyResult,
  AskResult,
  CreateBountyResult,
  CreatePinResult,
  InfoRepository,
  PayoutResult,
  PurchaseResult,
  ReportResult,
  SellerPinView,
} from './repository';
import { buildSeed, DB_VERSION, recycleSamples, type DB } from './seed';

const STORAGE_KEY = 'infomap:db:v1';
const MIN = 60 * 1000;

let cache: DB | null = null;

/**
 * 先着枠の確保と懸賞の採用は、同時に走ると枠を超えて売れてしまう。
 * ローカル実装ではプロセスが1つなので、書き込みを1本のチェーンに直列化するだけで
 * Supabase 側の SELECT ... FOR UPDATE と同じ不変条件を守れる。
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function loadDb(): Promise<DB> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed && parsed.version === DB_VERSION) {
        cache = parsed;
        // 前回から時間が空いていると全部腐っているので、消えたぶんを補充してから返す
        if (recycleSamples(cache, Date.now())) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        }
        return cache;
      }
    }
  } catch {
    // 壊れていたら作り直す
  }
  cache = buildSeed(Date.now());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  return cache;
}

async function persist(db: DB): Promise<void> {
  cache = db;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function write<T>(fn: (db: DB) => T): Promise<T> {
  return serialize(async () => {
    const db = await loadDb();
    const result = fn(db);
    await persist(db);
    return result;
  });
}

function read<T>(fn: (db: DB) => T): Promise<T> {
  return serialize(async () => fn(await loadDb()));
}

function badgeOf(db: DB, sellerId: UserId): SellerBadge {
  const user = db.users.find((u) => u.id === sellerId);
  return {
    sellerId,
    sellerHandle: user?.handle ?? '不明',
    sellerEmoji: user?.emoji ?? '❔',
    sellerScore: user ? sellerScore(user.hitCount, user.missCount) : null,
    sellerDeals: user ? user.hitCount + user.missCount : 0,
  };
}

function asksFor(
  db: DB,
  targetKind: AskTargetKind,
  targetId: string,
  viewerId: UserId
): PriceAskSummary {
  const list = db.asks.filter((a) => a.targetKind === targetKind && a.targetId === targetId);
  return {
    count: list.length,
    median: medianOf(list.map((a) => a.desired)),
    mine: list.find((a) => a.userId === viewerId)?.desired ?? null,
  };
}

function toPublic(db: DB, pin: Pin, viewerId: UserId): PublicPin {
  return {
    ...toPublicShape(pin),
    ...badgeOf(db, pin.sellerId),
    asks: asksFor(db, 'pin', pin.id, viewerId),
  };
}

function toRevealed(db: DB, pin: Pin, purchase: Purchase, viewerId: UserId): RevealedPin {
  return {
    ...toPublic(db, pin, viewerId),
    stockState: pin.stockState,
    payloadText: pin.payloadText,
    quantityNote: pin.quantityNote,
    photoUri: pin.photoUri,
    purchase,
  };
}

function closeBounty(db: DB, bounty: Bounty, status: 'expired' | 'cancelled', now: number): void {
  const unused = bountyRemainingSlots(bounty);
  if (unused > 0) {
    returnBounty(
      db.wallet,
      bounty.requesterId,
      unused * bounty.reward,
      bounty.id,
      bounty.targetText,
      now
    );
  }
  bounty.status = status;
  for (const app of db.applications) {
    if (app.bountyId !== bounty.id) continue;
    if (app.status === 'heading' || app.status === 'reported') {
      app.status = 'lapsed';
      app.decidedAt = now;
    }
  }
}

function acceptApplication(
  db: DB,
  app: BountyApplication,
  bounty: Bounty,
  now: number
): boolean {
  if (bountyRemainingSlots(bounty) <= 0) {
    app.status = 'rejected';
    app.decidedAt = now;
    return false;
  }
  app.status = 'accepted';
  app.decidedAt = now;
  bounty.acceptedCount += 1;
  payBounty(
    db.wallet,
    bounty.requesterId,
    app.applicantId,
    bounty.reward,
    feeFor(bounty.reward),
    bounty.id,
    bounty.targetText,
    now
  );
  if (bountyRemainingSlots(bounty) <= 0) bounty.status = 'filled';
  return true;
}

/**
 * 時間が経つだけで起きるはずの処理をまとめて回す。
 * 猶予切れの自動確定、報告の自動採用、期限切れ依頼の返還。
 */
function runTick(db: DB, now: number): boolean {
  let changed = false;

  for (const purchase of db.purchases) {
    if (purchase.escrow !== 'held') continue;
    if (!isSettleable(purchase, now)) continue;
    const pin = db.pins.find((p) => p.id === purchase.pinId);
    if (!pin) continue;
    purchase.escrow = 'released';
    settlePurchase(
      db.wallet,
      purchase.buyerId,
      pin.sellerId,
      purchase.price,
      purchase.fee,
      purchase.id,
      pin.headline,
      now
    );
    changed = true;
  }

  for (const app of db.applications) {
    if (app.status !== 'reported') continue;
    const bounty = db.bounties.find((b) => b.id === app.bountyId);
    if (!bounty || bounty.status !== 'open') continue;
    if (isAutoAcceptDue(app, bounty, now)) {
      acceptApplication(db, app, bounty, now);
      changed = true;
    }
  }

  for (const bounty of db.bounties) {
    if (bounty.status !== 'open') continue;
    if (now < bounty.expiresAt) continue;
    closeBounty(db, bounty, 'expired', now);
    changed = true;
  }

  return changed;
}

function viewBounty(db: DB, bounty: Bounty, viewerId: UserId): BountyView {
  const apps = db.applications.filter((a) => a.bountyId === bounty.id);
  const requester = db.users.find((u) => u.id === bounty.requesterId);
  return {
    ...bounty,
    requesterHandle: requester?.handle ?? '不明',
    requesterEmoji: requester?.emoji ?? '❔',
    headingCount: apps.filter((a) => a.status === 'heading').length,
    reportedCount: apps.filter((a) => a.status === 'reported').length,
    myApplication:
      apps.find((a) => a.applicantId === viewerId && a.status !== 'lapsed') ??
      apps.find((a) => a.applicantId === viewerId) ??
      null,
    asks: asksFor(db, 'bounty', bounty.id, viewerId),
  };
}

export const localRepository: InfoRepository = {
  listUsers() {
    return read((db) => db.users.slice());
  },

  getUser(userId) {
    return read((db) => db.users.find((u) => u.id === userId) ?? null);
  },

  getUserProfile(userId, now) {
    return read<UserProfileView | null>((db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) return null;
      const pins = db.pins.filter((p) => p.sellerId === userId);
      return {
        id: user.id,
        handle: user.handle,
        emoji: user.emoji,
        score: sellerScore(user.hitCount, user.missCount),
        hitCount: user.hitCount,
        missCount: user.missCount,
        restrictedUntil: user.restrictedUntil,
        activePins: pins
          .filter((p) => isOnMap(p, now))
          .map((p) => toPublic(db, p, userId))
          .sort((a, b) => a.expiresAt - b.expiresAt),
        listingCount: pins.length,
        soldCount: pins.reduce((acc, p) => acc + p.slotTaken, 0),
        acceptedReportCount: db.applications.filter(
          (a) => a.applicantId === userId && a.status === 'accepted'
        ).length,
      };
    });
  },

  tick(now) {
    return write((db) => {
      const settled = runTick(db, now);
      // 開いたまま放置しても切れ目なく続くように、腐ったサンプルを補充する
      const recycled = recycleSamples(db, now);
      return settled || recycled;
    });
  },

  listPins({ viewerId, now, bounds }) {
    return read((db) =>
      db.pins
        .filter((p) => isOnMap(p, now))
        .filter((p) => (bounds ? boundsContain(bounds, { lat: p.lat, lng: p.lng }) : true))
        .map((p) => toPublic(db, p, viewerId))
        .sort((a, b) => a.expiresAt - b.expiresAt)
    );
  },

  getPin(pinId, viewerId, now) {
    return read((db) => {
      void now;
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return null;
      const purchase = db.purchases.find((p) => p.pinId === pinId && p.buyerId === viewerId);
      if (purchase) return toRevealed(db, pin, purchase, viewerId);
      if (pin.sellerId === viewerId) {
        // 自分の出品は自分では買えないので、売り手にだけは中身を返す
        return toRevealed(
          db,
          pin,
          {
            id: 'self',
            pinId: pin.id,
            buyerId: viewerId,
            price: 0,
            fee: 0,
            createdAt: pin.createdAt,
            escrow: 'released',
            verdict: null,
            verdictAt: null,
          },
          viewerId
        );
      }
      return toPublic(db, pin, viewerId);
    });
  },

  createPin(input, now) {
    return write<CreatePinResult>((db) => {
      const user = db.users.find((u) => u.id === input.sellerId);
      if (!user) return { ok: false, reason: 'invalid' };
      if (!canPost(user, now)) return { ok: false, reason: 'restricted' };
      if (!isInsideArea({ lat: input.lat, lng: input.lng })) {
        return { ok: false, reason: 'outside_area' };
      }
      if (!input.headline.trim() || !input.payloadText.trim() || !input.photoUri) {
        return { ok: false, reason: 'invalid' };
      }
      if (input.price < MIN_PRICE || input.price > MAX_PRICE) {
        return { ok: false, reason: 'invalid' };
      }
      const pin: Pin = {
        id: newId('pin'),
        sellerId: input.sellerId,
        category: input.category,
        lat: input.lat,
        lng: input.lng,
        placeLabel: input.placeLabel.trim() || '名前のない場所',
        headline: input.headline.trim(),
        stockState: input.stockState,
        payloadText: input.payloadText.trim(),
        quantityNote: input.quantityNote?.trim() || null,
        photoUri: input.photoUri,
        price: input.price,
        slotTotal: input.slotTotal,
        slotTaken: 0,
        createdAt: now,
        expiresAt: now + input.ttlMinutes * MIN,
        status: 'active',
      };
      db.pins.push(pin);
      return { ok: true, pin };
    });
  },

  voidPin(pinId, sellerId, now) {
    return write((db) => {
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin || pin.sellerId !== sellerId || pin.status !== 'active') return;
      pin.status = 'voided';
      // 取り下げるなら、まだ確定していない購入は買い手に返す
      for (const purchase of db.purchases) {
        if (purchase.pinId !== pinId || purchase.escrow !== 'held') continue;
        purchase.escrow = 'refunded';
        purchase.verdictAt = now;
        refundPurchase(db.wallet, purchase.buyerId, purchase.price, purchase.id, pin.headline, now);
      }
    });
  },

  listMyPins(sellerId, now) {
    return read((db) => {
      void now;
      return db.pins
        .filter((p) => p.sellerId === sellerId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map<SellerPinView>((pin) => {
          const purchases = db.purchases.filter((p) => p.pinId === pin.id);
          const sum = (state: Purchase['escrow']) =>
            purchases.filter((p) => p.escrow === state).reduce((acc, p) => acc + p.price - p.fee, 0);
          return {
            pin,
            purchases,
            heldTotal: sum('held'),
            releasedTotal: sum('released'),
            refundedTotal: purchases
              .filter((p) => p.escrow === 'refunded')
              .reduce((acc, p) => acc + p.price, 0),
            asks: asksFor(db, 'pin', pin.id, sellerId),
          };
        });
    });
  },

  lastPinOf(sellerId) {
    return read((db) => {
      const mine = db.pins
        .filter((p) => p.sellerId === sellerId)
        .sort((a, b) => b.createdAt - a.createdAt);
      return mine[0] ?? null;
    });
  },

  purchase(pinId, buyerId, now) {
    return write<PurchaseResult>((db) => {
      runTick(db, now);
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return { ok: false, reason: 'not_found' };
      if (pin.status === 'voided') return { ok: false, reason: 'voided' };
      if (pin.sellerId === buyerId) return { ok: false, reason: 'own_pin' };
      if (isExpired(pin, now)) return { ok: false, reason: 'expired' };
      if (isSoldOut(pin)) return { ok: false, reason: 'sold_out' };
      if (db.purchases.some((p) => p.pinId === pinId && p.buyerId === buyerId)) {
        return { ok: false, reason: 'already_bought' };
      }
      if (balanceOf(db.wallet, buyerId).available < pin.price) {
        return { ok: false, reason: 'insufficient_balance' };
      }

      pin.slotTaken += 1;
      const purchase: Purchase = {
        id: newId('pu'),
        pinId,
        buyerId,
        price: pin.price,
        fee: feeFor(pin.price),
        createdAt: now,
        escrow: 'held',
        verdict: null,
        verdictAt: null,
      };
      db.purchases.push(purchase);
      holdForPurchase(db.wallet, buyerId, pin.price, purchase.id, pin.headline, now);
      return { ok: true, pin: toRevealed(db, pin, purchase, buyerId) };
    });
  },

  listMyPurchases(buyerId, now) {
    return read((db) => {
      void now;
      return db.purchases
        .filter((p) => p.buyerId === buyerId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .flatMap((purchase) => {
          const pin = db.pins.find((p) => p.id === purchase.pinId);
          return pin ? [toRevealed(db, pin, purchase, buyerId)] : [];
        });
    });
  },

  submitVerdict(purchaseId, verdict, now) {
    return write((db) => {
      const purchase = db.purchases.find((p) => p.id === purchaseId);
      if (!purchase || purchase.escrow !== 'held') return;
      const pin = db.pins.find((p) => p.id === purchase.pinId);
      if (!pin) return;

      purchase.verdict = verdict;
      purchase.verdictAt = now;
      const seller = db.users.find((u) => u.id === pin.sellerId);

      if (verdict === 'hit') {
        purchase.escrow = 'released';
        settlePurchase(
          db.wallet,
          purchase.buyerId,
          pin.sellerId,
          purchase.price,
          purchase.fee,
          purchase.id,
          pin.headline,
          now
        );
        if (seller) seller.hitCount += 1;
      } else {
        purchase.escrow = 'refunded';
        refundPurchase(db.wallet, purchase.buyerId, purchase.price, purchase.id, pin.headline, now);
        if (seller) seller.missCount += 1;
      }

      if (seller && shouldRestrict(seller.hitCount, seller.missCount)) {
        seller.restrictedUntil = now + RESTRICT_DURATION_MS;
      }
    });
  },

  listBounties({ viewerId, now, origin }) {
    return read((db) => {
      const views = db.bounties.map((b) => viewBounty(db, b, viewerId));
      return views.sort((a, b) => {
        const aOpen = isBountyOpen(a, now) ? 0 : 1;
        const bOpen = isBountyOpen(b, now) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        if (aOpen === 0) {
          if (origin) {
            const da = distanceM(origin, { lat: a.lat, lng: a.lng });
            const dbb = distanceM(origin, { lat: b.lat, lng: b.lng });
            if (Math.abs(da - dbb) > 50) return da - dbb;
          }
          return a.expiresAt - b.expiresAt;
        }
        return b.createdAt - a.createdAt;
      });
    });
  },

  getBounty(bountyId, viewerId, now) {
    return read((db) => {
      void now;
      const bounty = db.bounties.find((b) => b.id === bountyId);
      return bounty ? viewBounty(db, bounty, viewerId) : null;
    });
  },

  listApplications(bountyId) {
    return read((db) =>
      db.applications
        .filter((a) => a.bountyId === bountyId)
        .sort((a, b) => a.createdAt - b.createdAt)
    );
  },

  createBounty(input, now) {
    return write<CreateBountyResult>((db) => {
      if (!isInsideArea({ lat: input.lat, lng: input.lng })) {
        return { ok: false, reason: 'outside_area' };
      }
      if (!input.targetText.trim() || input.acceptCount < 1 || input.reward < MIN_PRICE) {
        return { ok: false, reason: 'invalid' };
      }
      const total = input.reward * input.acceptCount;
      if (balanceOf(db.wallet, input.requesterId).available < total) {
        return { ok: false, reason: 'insufficient_balance' };
      }
      const bounty: Bounty = {
        id: newId('bo'),
        requesterId: input.requesterId,
        category: input.category,
        lat: input.lat,
        lng: input.lng,
        radiusM: input.radiusM,
        areaLabel: input.areaLabel.trim() || '指定エリア',
        targetText: input.targetText.trim(),
        reward: input.reward,
        acceptCount: input.acceptCount,
        acceptedCount: 0,
        createdAt: now,
        expiresAt: now + input.ttlMinutes * MIN,
        status: 'open',
      };
      db.bounties.push(bounty);
      holdForBounty(db.wallet, input.requesterId, total, bounty.id, bounty.targetText, now);
      return { ok: true, bounty };
    });
  },

  applyToBounty(bountyId, userId, now) {
    return write<ApplyResult>((db) => {
      runTick(db, now);
      const bounty = db.bounties.find((b) => b.id === bountyId);
      if (!bounty) return { ok: false, reason: 'not_found' };
      if (bounty.requesterId === userId) return { ok: false, reason: 'own_bounty' };
      if (!isBountyOpen(bounty, now)) return { ok: false, reason: 'closed' };
      const active = db.applications.find(
        (a) =>
          a.bountyId === bountyId &&
          a.applicantId === userId &&
          (a.status === 'heading' || a.status === 'reported' || a.status === 'accepted')
      );
      if (active) return { ok: false, reason: 'duplicate' };

      db.applications.push({
        id: newId('ap'),
        bountyId,
        applicantId: userId,
        status: 'heading',
        createdAt: now,
        reportedAt: null,
        reportText: null,
        photoUri: null,
        decidedAt: null,
      });
      return { ok: true };
    });
  },

  reportToBounty(applicationId, report, now) {
    return write<ReportResult>((db) => {
      runTick(db, now);
      const app = db.applications.find((a) => a.id === applicationId);
      if (!app) return { ok: false, reason: 'not_found' };
      if (app.status !== 'heading') return { ok: false, reason: 'not_heading' };
      const bounty = db.bounties.find((b) => b.id === app.bountyId);
      if (!bounty) return { ok: false, reason: 'not_found' };
      if (!isBountyOpen(bounty, now)) return { ok: false, reason: 'closed' };
      if (!report.photoUri) return { ok: false, reason: 'photo_required' };

      app.status = 'reported';
      app.reportedAt = now;
      app.reportText = report.text.trim();
      app.photoUri = report.photoUri;
      return { ok: true, accepted: false };
    });
  },

  decideApplication(applicationId, accept, now) {
    return write((db) => {
      const app = db.applications.find((a) => a.id === applicationId);
      if (!app || app.status !== 'reported') return;
      const bounty = db.bounties.find((b) => b.id === app.bountyId);
      if (!bounty || bounty.status !== 'open') return;
      if (accept) {
        acceptApplication(db, app, bounty, now);
      } else {
        app.status = 'rejected';
        app.decidedAt = now;
      }
    });
  },

  cancelBounty(bountyId, requesterId, now) {
    return write((db) => {
      const bounty = db.bounties.find((b) => b.id === bountyId);
      if (!bounty || bounty.requesterId !== requesterId || bounty.status !== 'open') return;
      closeBounty(db, bounty, 'cancelled', now);
    });
  },

  askPriceChange(targetKind, targetId, userId, desired, now) {
    return write<AskResult>((db) => {
      if (targetKind === 'pin') {
        const pin = db.pins.find((p) => p.id === targetId);
        if (!pin) return { ok: false, reason: 'not_found' };
        if (pin.sellerId === userId) return { ok: false, reason: 'own_item' };
        if (!isPurchasable(pin, now)) return { ok: false, reason: 'closed' };
        // 売り物に頼めるのは値下げだけ
        if (desired < MIN_PRICE || desired >= pin.price) return { ok: false, reason: 'invalid' };
      } else {
        const bounty = db.bounties.find((b) => b.id === targetId);
        if (!bounty) return { ok: false, reason: 'not_found' };
        if (bounty.requesterId === userId) return { ok: false, reason: 'own_item' };
        if (!isBountyOpen(bounty, now)) return { ok: false, reason: 'closed' };
        // 依頼に頼めるのは値上げだけ
        if (desired <= bounty.reward || desired > MAX_PRICE) return { ok: false, reason: 'invalid' };
      }

      const existing = db.asks.find(
        (a) => a.targetKind === targetKind && a.targetId === targetId && a.userId === userId
      );
      if (existing) {
        existing.desired = desired;
        existing.createdAt = now;
      } else {
        db.asks.push({
          id: newId('ask'),
          targetKind,
          targetId,
          userId,
          desired,
          createdAt: now,
        });
      }
      return { ok: true };
    });
  },

  withdrawPriceAsk(targetKind, targetId, userId) {
    return write((db) => {
      db.asks = db.asks.filter(
        (a) => !(a.targetKind === targetKind && a.targetId === targetId && a.userId === userId)
      );
    });
  },

  applyPriceChange(targetKind, targetId, ownerId, amount, now) {
    return write<ApplyPriceResult>((db) => {
      if (targetKind === 'pin') {
        const pin = db.pins.find((p) => p.id === targetId);
        if (!pin) return { ok: false, reason: 'not_found' };
        if (pin.sellerId !== ownerId) return { ok: false, reason: 'forbidden' };
        if (!isPurchasable(pin, now)) return { ok: false, reason: 'closed' };
        if (amount < MIN_PRICE || amount >= pin.price) return { ok: false, reason: 'invalid' };
        // すでに買った人は買ったときの値段のまま。安くなるのはこれから買う人だけ
        pin.price = amount;
      } else {
        const bounty = db.bounties.find((b) => b.id === targetId);
        if (!bounty) return { ok: false, reason: 'not_found' };
        if (bounty.requesterId !== ownerId) return { ok: false, reason: 'forbidden' };
        if (!isBountyOpen(bounty, now)) return { ok: false, reason: 'closed' };
        if (amount <= bounty.reward || amount > MAX_PRICE) return { ok: false, reason: 'invalid' };

        // 残っている採用枠のぶんだけ、差額を追加で預かる
        const openSlots = bountyRemainingSlots(bounty);
        const delta = (amount - bounty.reward) * openSlots;
        if (balanceOf(db.wallet, ownerId).available < delta) {
          return { ok: false, reason: 'insufficient_balance' };
        }
        holdForBounty(db.wallet, ownerId, delta, bounty.id, `報酬の引き上げ ${bounty.targetText}`, now);
        bounty.reward = amount;
      }

      // 値段が動いたら、それまでの希望は役目を終える
      db.asks = db.asks.filter((a) => !(a.targetKind === targetKind && a.targetId === targetId));
      return { ok: true };
    });
  },

  getBalance(userId) {
    return read<Balance>((db) => balanceOf(db.wallet, userId));
  },

  listWalletEntries(userId) {
    return read<WalletEntry[]>((db) =>
      db.wallet.filter((e) => e.userId === userId).sort((a, b) => b.createdAt - a.createdAt)
    );
  },

  requestPayout(userId, amount, now) {
    return write<PayoutResult>((db) => {
      if (amount <= 0) return { ok: false, reason: 'invalid' };
      if (balanceOf(db.wallet, userId).available < amount) {
        return { ok: false, reason: 'insufficient_balance' };
      }
      const payout: PayoutRequest = {
        id: newId('po'),
        userId,
        amount,
        status: 'requested',
        createdAt: now,
      };
      db.payouts.push(payout);
      withdraw(db.wallet, userId, amount, payout.id, now);
      return { ok: true };
    });
  },

  listPayouts(userId) {
    return read<PayoutRequest[]>((db) =>
      db.payouts
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt) as PayoutRequest[]
    );
  },

  createReport(reporterId, targetKind, targetId, reason, now) {
    return write((db) => {
      const report: Report = {
        id: newId('rp'),
        reporterId,
        targetKind,
        targetId,
        reason,
        createdAt: now,
      };
      db.reports.push(report);
    });
  },

  resetAll(now) {
    return serialize(async () => {
      cache = buildSeed(now);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    });
  },
};

export async function getCurrentUserId(): Promise<UserId> {
  return read((db) => db.currentUserId);
}

export async function setCurrentUserId(userId: UserId): Promise<void> {
  return write((db) => {
    db.currentUserId = userId;
  });
}

export type { User };
