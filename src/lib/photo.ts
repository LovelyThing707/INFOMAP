import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import type { PhotoProof } from '@/domain/types';

const MAX_WIDTH = 900;

export interface Evidence {
  uri: string;
  /** 位置が取れなかったときは null。その場合は未検証として扱う */
  proof: PhotoProof | null;
}

/**
 * 端末の写真をそのまま持つと localStorage に入り切らないので、
 * 幅900pxのJPEGに落としてから data URI にする。
 */
async function normalize(uri: string): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri).resize({ width: MAX_WIDTH });
    const image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });
    if (result.base64) return `data:image/jpeg;base64,${result.base64}`;
    return result.uri;
  } catch {
    return uri;
  }
}

async function currentProof(takenAt: number): Promise<PhotoProof | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      takenAt,
      accuracyM: position.coords.accuracy ?? null,
      // Android だけが偽装を申告する。取れない端末では false のまま扱う
      mocked: position.mocked === true,
    };
  } catch {
    return null;
  }
}

/**
 * その場で撮って、撮った位置と時刻を一緒に持ち帰る。
 *
 * ライブラリから選ばせないのがこの関数の要点。持ち込み画像を許すと、
 * 去年の写真でも他人の投稿でも出品できてしまい、写真が証拠として機能しない。
 * 位置は撮影の直後に取る。並べて取ると、撮ってから移動した場合にずれる。
 */
export async function captureEvidence(): Promise<Evidence | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets.length) return null;

  const takenAt = Date.now();
  const [uri, proof] = await Promise.all([
    normalize(result.assets[0].uri),
    currentProof(takenAt),
  ]);
  return { uri, proof };
}
