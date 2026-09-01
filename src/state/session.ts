import { create } from 'zustand';

import { backend, getCurrentUserId, repository, setCurrentUserId } from '@/data';
import type { Balance, User, UserId } from '@/domain/types';
import { nowMs } from '@/lib/clock';
import { authErrorMessage, requireSupabase } from '@/lib/supabase';

export const repo = repository;

const EMPTY_BALANCE: Balance = { available: 0, pending: 0 };

interface SessionState {
  ready: boolean;
  /**
   * 地図は未ログインでも見られる。買う・売る・頼むときだけ true が要る。
   * ローカル実装には本人確認が無いので、常に true。
   */
  signedIn: boolean;
  userId: UserId;
  users: User[];
  me: User | null;
  balance: Balance;
  /** 書き込みのたびに増える。画面はこれを依存配列に入れて取り直す */
  revision: number;

  authBusy: boolean;
  authError: string | null;
  /** 登録は通ったが、メールの確認がまだ済んでいない */
  awaitingConfirmation: boolean;

  init: () => Promise<void>;
  /** 何か書き込んだあとに呼ぶ。残高とユーザーを取り直して画面を更新させる */
  bump: () => Promise<void>;
  switchUser: (userId: UserId) => Promise<void>;
  resetAll: () => Promise<void>;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, handle: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
}

async function snapshot(userId: UserId) {
  const [users, balance, me] = await Promise.all([
    repo.listUsers(),
    repo.getBalance(userId),
    repo.getUser(userId),
  ]);
  return { users, balance, me };
}

export const useSession = create<SessionState>((set, get) => {
  /** Supabase のセッションを取り込む。userId が null ならサインアウト状態 */
  async function adopt(userId: UserId | null) {
    if (!userId) {
      set({ signedIn: false, userId: '', me: null, users: [], balance: EMPTY_BALANCE });
      return;
    }
    const snap = await snapshot(userId);
    set({ signedIn: true, userId, ...snap, revision: get().revision + 1 });
  }

  return {
    ready: false,
    signedIn: false,
    userId: '',
    users: [],
    me: null,
    balance: EMPTY_BALANCE,
    revision: 0,
    authBusy: false,
    authError: null,
    awaitingConfirmation: false,

    async init() {
      if (get().ready) return;

      if (backend === 'supabase') {
        const client = requireSupabase();
        // 別のタブでのサインアウトやトークンの更新にも追従させる
        client.auth.onAuthStateChange((_event, session) => {
          void adopt(session?.user?.id ?? null);
        });
        const { data } = await client.auth.getSession();
        await adopt(data.session?.user?.id ?? null);
        set({ ready: true });
        return;
      }

      const userId = await getCurrentUserId();
      await repo.tick(nowMs());
      const snap = await snapshot(userId);
      set({ ready: true, signedIn: true, userId, ...snap, revision: get().revision + 1 });
    },

    async bump() {
      const { userId } = get();
      if (!userId) return;
      const snap = await snapshot(userId);
      set({ ...snap, revision: get().revision + 1 });
    },

    /**
     * 動作確認用の切替。画面を隠すだけでは、経路が残っていれば呼ばれうる。
     * 本番ビルドでは何もしないようにして、認証を入れたあとの迂回路を塞いでおく。
     */
    async switchUser(userId) {
      if (!__DEV__ || backend !== 'local') return;
      await setCurrentUserId(userId);
      const snap = await snapshot(userId);
      set({ userId, ...snap, revision: get().revision + 1 });
    },

    async resetAll() {
      if (!__DEV__ || backend !== 'local') return;
      await repo.resetAll(nowMs());
      const userId = await getCurrentUserId();
      const snap = await snapshot(userId);
      set({ userId, ...snap, revision: get().revision + 1 });
    },

    async signIn(email, password) {
      set({ authBusy: true, authError: null, awaitingConfirmation: false });
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      set({ authBusy: false, authError: error ? authErrorMessage(error.message) : null });
    },

    async signUp(email, password, handle) {
      set({ authBusy: true, authError: null, awaitingConfirmation: false });
      const { data, error } = await requireSupabase().auth.signUp({
        email: email.trim(),
        password,
        // handle_new_user() トリガがここから表示名を取って profiles を作る
        options: { data: { handle: handle.trim().slice(0, 20) } },
      });
      if (error) {
        set({ authBusy: false, authError: authErrorMessage(error.message) });
        return;
      }
      // 確認メールを要求する設定だと、この時点ではまだセッションが無い
      set({ authBusy: false, awaitingConfirmation: !data.session });
    },

    async signOut() {
      set({ authBusy: true, authError: null, awaitingConfirmation: false });
      if (backend === 'supabase') {
        await requireSupabase().auth.signOut();
      } else {
        // ローカルは「未ログインで地図を見る」初回体験を再現する
        set({
          signedIn: false,
          userId: '',
          me: null,
          users: [],
          balance: EMPTY_BALANCE,
        });
      }
      set({ authBusy: false });
    },

    clearAuthError() {
      set({ authError: null });
    },
  };
});
