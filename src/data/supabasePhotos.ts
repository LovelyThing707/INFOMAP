import { requireSupabase } from '@/lib/supabase';

/**
 * 写真の置き場（Supabase Storage）。
 *
 * DBには photo_path しか持たない。バケットは public = false なので、
 * パスが漏れてもURLを叩くだけでは取れない。読める人にだけ短命の署名URLを出す。
 *
 * パスは必ず `<利用者のuuid>/<ファイル名>` にする。
 * Storage 側のポリシーが先頭のフォルダ名を auth.uid() と突き合わせているので、
 * この形を崩すと自分の写真すら置けなくなる。
 * ポリシーは supabase/migrations/20260831010000_storage.sql にある。
 */
const BUCKET = 'photos';

/** 署名URLの寿命。閲覧に足りて、貼り回されても腐る長さ */
const SIGN_TTL_SEC = 60 * 10;

function extensionOf(mime: string): string {
  return mime === 'image/png' ? 'png' : 'jpg';
}

/** data URI を Blob に戻す。Storage は生のバイト列を受け取る */
function toBlob(dataUri: string): { blob: Blob; mime: string } | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUri);
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

/**
 * 撮った写真を上げて、DBに入れるパスを返す。
 * 上げられなかったら null。呼び出し側は写真必須の処理を中止する。
 */
export async function uploadPhoto(
  dataUri: string | null,
  ownerId: string
): Promise<string | null> {
  if (!dataUri) return null;
  const decoded = toBlob(dataUri);
  if (!decoded) return null;

  const path = `${ownerId}/${globalThis.crypto.randomUUID()}.${extensionOf(decoded.mime)}`;
  const { error } = await requireSupabase()
    .storage.from(BUCKET)
    .upload(path, decoded.blob, { contentType: decoded.mime, upsert: false });

  return error ? null : path;
}

/**
 * 読める人にだけ出るURL。読む権限が無ければ Storage 側で弾かれて null になる。
 * ここで null が返るのは異常ではなく、未購入者に対する正常な結果。
 */
export async function signPhoto(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await requireSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(path, SIGN_TTL_SEC);
  return error ? null : (data?.signedUrl ?? null);
}

/** 出品をやめたときなど、参照されなくなったものを片付ける */
export async function removePhoto(path: string | null): Promise<void> {
  if (!path) return;
  await requireSupabase().storage.from(BUCKET).remove([path]);
}
