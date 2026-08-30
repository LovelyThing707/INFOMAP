import { formatYen } from '@/domain/rules';
import type { Balance, LedgerKind, UserId, WalletEntry } from '@/domain/types';

import { newId } from './ids';

/**
 * 残高は保存しない。この台帳の合計だけが正。
 * available（出金可能）と pending（預かり中）の増減を1行に両方持たせるので、
 * 「available から pending へ移す」が1行で表現でき、片側だけ書き換わる事故が起きない。
 */
export function balanceOf(entries: WalletEntry[], userId: UserId): Balance {
  let available = 0;
  let pending = 0;
  for (const e of entries) {
    if (e.userId !== userId) continue;
    available += e.availableDelta;
    pending += e.pendingDelta;
  }
  return { available, pending };
}

interface PostInput {
  userId: UserId;
  kind: LedgerKind;
  availableDelta?: number;
  pendingDelta?: number;
  memo: string;
  refId?: string | null;
}

function post(entries: WalletEntry[], input: PostInput, now: number): WalletEntry {
  const entry: WalletEntry = {
    id: newId('wl'),
    userId: input.userId,
    kind: input.kind,
    availableDelta: input.availableDelta ?? 0,
    pendingDelta: input.pendingDelta ?? 0,
    memo: input.memo,
    refId: input.refId ?? null,
    createdAt: now,
  };
  entries.push(entry);
  return entry;
}

export function topUp(
  entries: WalletEntry[],
  userId: UserId,
  amount: number,
  now: number
): void {
  post(entries, { userId, kind: 'topup', availableDelta: amount, memo: '初期付与' }, now);
}

export function holdForPurchase(
  entries: WalletEntry[],
  buyerId: UserId,
  price: number,
  purchaseId: string,
  headline: string,
  now: number
): void {
  post(
    entries,
    {
      userId: buyerId,
      kind: 'purchase_hold',
      availableDelta: -price,
      pendingDelta: price,
      memo: `購入（預かり）${headline}`,
      refId: purchaseId,
    },
    now
  );
}

/** 手数料は売上と別行にして、履歴の上で内訳が読めるようにする */
export function settlePurchase(
  entries: WalletEntry[],
  buyerId: UserId,
  sellerId: UserId,
  price: number,
  fee: number,
  purchaseId: string,
  headline: string,
  now: number
): void {
  post(
    entries,
    {
      userId: buyerId,
      kind: 'purchase_settle',
      pendingDelta: -price,
      memo: `購入確定 ${headline}`,
      refId: purchaseId,
    },
    now
  );
  post(
    entries,
    {
      userId: sellerId,
      kind: 'sale_income',
      availableDelta: price,
      memo: `売上 ${headline}`,
      refId: purchaseId,
    },
    now
  );
  if (fee > 0) {
    post(
      entries,
      {
        userId: sellerId,
        kind: 'platform_fee',
        availableDelta: -fee,
        memo: `手数料（${formatYen(price)}の20%）`,
        refId: purchaseId,
      },
      now
    );
  }
}

export function refundPurchase(
  entries: WalletEntry[],
  buyerId: UserId,
  price: number,
  purchaseId: string,
  headline: string,
  now: number
): void {
  post(
    entries,
    {
      userId: buyerId,
      kind: 'purchase_refund',
      availableDelta: price,
      pendingDelta: -price,
      memo: `返金 ${headline}`,
      refId: purchaseId,
    },
    now
  );
}

export function holdForBounty(
  entries: WalletEntry[],
  requesterId: UserId,
  total: number,
  bountyId: string,
  target: string,
  now: number
): void {
  post(
    entries,
    {
      userId: requesterId,
      kind: 'bounty_hold',
      availableDelta: -total,
      pendingDelta: total,
      memo: `依頼の報酬を預け入れ ${target}`,
      refId: bountyId,
    },
    now
  );
}

export function payBounty(
  entries: WalletEntry[],
  requesterId: UserId,
  applicantId: UserId,
  reward: number,
  fee: number,
  bountyId: string,
  target: string,
  now: number
): void {
  post(
    entries,
    {
      userId: requesterId,
      kind: 'bounty_payout',
      pendingDelta: -reward,
      memo: `採用による支払 ${target}`,
      refId: bountyId,
    },
    now
  );
  post(
    entries,
    {
      userId: applicantId,
      kind: 'bounty_income',
      availableDelta: reward,
      memo: `報酬 ${target}`,
      refId: bountyId,
    },
    now
  );
  if (fee > 0) {
    post(
      entries,
      {
        userId: applicantId,
        kind: 'platform_fee',
        availableDelta: -fee,
        memo: `手数料（${formatYen(reward)}の20%）`,
        refId: bountyId,
      },
      now
    );
  }
}

export function returnBounty(
  entries: WalletEntry[],
  requesterId: UserId,
  amount: number,
  bountyId: string,
  target: string,
  now: number
): void {
  post(
    entries,
    {
      userId: requesterId,
      kind: 'bounty_return',
      availableDelta: amount,
      pendingDelta: -amount,
      memo: `未採用分の返還 ${target}`,
      refId: bountyId,
    },
    now
  );
}

export function withdraw(
  entries: WalletEntry[],
  userId: UserId,
  amount: number,
  payoutId: string,
  now: number
): void {
  post(
    entries,
    {
      userId,
      kind: 'payout',
      availableDelta: -amount,
      memo: '出金申請',
      refId: payoutId,
    },
    now
  );
}

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  topup: '初期付与',
  purchase_hold: '購入（預かり）',
  purchase_settle: '購入確定',
  purchase_refund: '返金',
  sale_income: '売上',
  platform_fee: '手数料',
  bounty_hold: '依頼の預け入れ',
  bounty_return: '返還',
  bounty_payout: '採用の支払',
  bounty_income: '報酬',
  payout: '出金',
};
