import { Directory, File, Paths } from 'expo-file-system';

import { newId } from './ids';

/**
 * 写真の置き場。
 *
 * 端末で撮った写真は1枚100KB前後あり、本体の保存（キー1つのJSON）に混ぜると
 * 数十枚で上限に当たる。しかも書き込みのたびに全体を書き直すので、
 * 写真が増えるほど出品1件が重くなる。だから写真だけファイルへ逃がし、
 * 保存には file:// のパスだけを持たせる。
 *
 * この形は Supabase 側のスキーマ（photo_path にパスだけ持つ）と同じなので、
 * 移行するときも構造を変えずに済む。
 */
const FOLDER = 'photos';

function photoDir(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** data URI ならファイルに書き出してパスを返す。それ以外はそのまま通す */
export async function keepPhoto(source: string | null): Promise<string | null> {
  if (!source) return null;
  const match = /^data:image\/([a-z+]+);base64,(.+)$/s.exec(source);
  // SVG のサンプルや、すでにファイルになっているものは触らない
  if (!match) return source;

  try {
    const [, kind, base64] = match;
    const file = new File(photoDir(), `${newId('ph')}.${kind === 'png' ? 'png' : 'jpg'}`);
    file.write(base64, { encoding: 'base64' });
    return file.uri;
  } catch {
    // 書けなかったら元のまま持つ。表示はできるので、動かなくなるよりまし
    return source;
  }
}

export async function dropPhoto(uri: string | null): Promise<void> {
  if (!uri?.startsWith('file://')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 消せなくても致命ではない。次の掃除で拾う
  }
}

/**
 * どこからも参照されていないファイルを消す。
 * 出品を途中でやめた場合など、書いたのに使われない写真が残るため。
 */
export async function sweepPhotos(keep: Set<string>): Promise<number> {
  try {
    let removed = 0;
    for (const entry of photoDir().list()) {
      if (entry instanceof Directory) continue;
      if (keep.has(entry.uri)) continue;
      entry.delete();
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

/** 写真が占めている容量(バイト)。マイページに出して、増え方を見えるようにする */
export async function photoBytes(): Promise<number> {
  try {
    return photoDir()
      .list()
      .reduce((total, entry) => total + (entry instanceof Directory ? 0 : (entry.size ?? 0)), 0);
  } catch {
    return 0;
  }
}
