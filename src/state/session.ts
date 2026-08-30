import { create } from 'zustand';

import { getCurrentUserId, repository, setCurrentUserId } from '@/data';
import type { Balance, User, UserId } from '@/domain/types';
import { nowMs } from '@/lib/clock';

export const repo = repository;

interface SessionState {
  ready: boolean;
  userId: UserId;
  users: User[];
  me: User | null;
  balance: Balance;
  /** 書き込みのたびに増える。画面はこれを依存配列に入れて取り直す */
  revision: number;
  init: () => Promise<void>;
  /** 何か書き込んだあとに呼ぶ。残高とユーザーを取り直して画面を更新させる */
  bump: () => Promise<void>;
  switchUser: (userId: UserId) => Promise<void>;
  resetAll: () => Promise<void>;
}

async function snapshot(userId: UserId) {
  const [users, balance] = await Promise.all([repo.listUsers(), repo.getBalance(userId)]);
  return { users, balance, me: users.find((u) => u.id === userId) ?? null };
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  userId: '',
  users: [],
  me: null,
  balance: { available: 0, pending: 0 },
  revision: 0,

  async init() {
    if (get().ready) return;
    const userId = await getCurrentUserId();
    await repo.tick(nowMs());
    const snap = await snapshot(userId);
    set({ ready: true, userId, ...snap, revision: get().revision + 1 });
  },

  async bump() {
    const { userId } = get();
    if (!userId) return;
    const snap = await snapshot(userId);
    set({ ...snap, revision: get().revision + 1 });
  },

  async switchUser(userId) {
    await setCurrentUserId(userId);
    const snap = await snapshot(userId);
    set({ userId, ...snap, revision: get().revision + 1 });
  },

  async resetAll() {
    await repo.resetAll(nowMs());
    const userId = await getCurrentUserId();
    const snap = await snapshot(userId);
    set({ userId, ...snap, revision: get().revision + 1 });
  },
}));
