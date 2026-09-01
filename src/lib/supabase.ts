import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

/**
 * Supabase への接続。
 *
 * 公開鍵（sb_publishable_、または旧 anon）はアプリのバンドルに埋まる。
 * これは隠せないし、隠す前提でもない。
 * 守っているのは鍵ではなく、DB側の権限と行レベル制限。
 * 詳しくは supabase/migrations/ の「権限（関数）」の節を参照。
 * 権限が意図どおり閉じているかは `npm run verify:schema` で実測できる。
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 両方揃っているときだけ Supabase を使う。
 * 片方だけで中途半端に繋ぐと、どちらの実装で動いているのか分からなくなる。
 */
export const isSupabaseEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseEnabled
  ? createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        // Web はリダイレクト後のURLからセッションを拾う。native には拾う先が無い
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

/** 呼ぶ側で null 判定を繰り返さないための入口 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('supabase_not_configured');
  return supabase;
}

/** Supabase が返すエラーを画面に出せる日本語にする */
export function authErrorMessage(raw: string): string {
  const message = raw.toLowerCase();
  if (message.includes('invalid login credentials')) {
    return 'メールアドレスかパスワードが違います';
  }
  if (message.includes('email not confirmed')) {
    return 'メールの確認が済んでいません。届いたリンクを開いてください';
  }
  if (message.includes('user already registered') || message.includes('already been registered')) {
    return 'このメールアドレスは登録済みです。ログインしてください';
  }
  if (message.includes('password')) {
    return 'パスワードが条件を満たしていません（8文字以上）';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return '試行が続いています。少し待ってからもう一度お試しください';
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return '接続できません。EXPO_PUBLIC_SUPABASE_URL を確認してください';
  }
  return raw;
}
