import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_WIDTH = 900;

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

export async function takePhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets.length) return null;
  return normalize(result.assets[0].uri);
}

export async function pickPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets.length) return null;
  return normalize(result.assets[0].uri);
}

/**
 * PCで動作を確認するとき用。カメラもライブラリもない環境で、
 * 写真必須のフローを止めないための代用。
 */
export function placeholderPhoto(label: string): string {
  const safe = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">` +
    `<rect width="640" height="420" fill="#DBE3EC"/>` +
    `<g fill="#94A3B8"><rect x="60" y="110" width="520" height="10" rx="5"/>` +
    `<rect x="60" y="230" width="520" height="10" rx="5"/>` +
    `<rect x="90" y="46" width="80" height="64" rx="8"/><rect x="200" y="60" width="80" height="50" rx="8"/>` +
    `<rect x="310" y="40" width="80" height="70" rx="8"/><rect x="120" y="170" width="80" height="60" rx="8"/>` +
    `<rect x="230" y="186" width="80" height="44" rx="8"/></g>` +
    `<rect x="0" y="352" width="640" height="68" fill="rgba(15,23,42,0.72)"/>` +
    `<text x="24" y="394" fill="#fff" font-family="sans-serif" font-size="24" font-weight="700">${safe}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
