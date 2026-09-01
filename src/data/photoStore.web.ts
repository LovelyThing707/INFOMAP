/**
 * Web にはファイルシステムがない。
 *
 * ただしカメラも使えないので、Web で増える写真はサンプルのSVG（1枚1KB強）だけ。
 * 逃がす先を作る必要がないので、受け取ったものをそのまま通す。
 * 実機で撮った写真は photoStore.ts 側でファイルへ書き出される。
 */
export async function keepPhoto(source: string | null): Promise<string | null> {
  return source;
}

export async function dropPhoto(): Promise<void> {}

export async function sweepPhotos(): Promise<number> {
  return 0;
}

export async function photoBytes(): Promise<number> {
  return 0;
}
