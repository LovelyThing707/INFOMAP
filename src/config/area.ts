import type { LatLng } from '@/domain/types';

/**
 * MVPは1エリアだけ。ここを変えれば検証地域を移せる。
 * 同じ場所で売買が繰り返されるかを見たいので、歩いて回れる都心の範囲に留める。
 */
export const AREA = {
  id: 'tokyo-area',
  label: '東京圏',
  // 御茶ノ水あたりを中心に、新宿・渋谷・池袋から横浜・大宮・船橋までを含む
  center: { lat: 35.69, lng: 139.75 } as LatLng,
  radiusM: 30000,
  // 初期表示で山手線の内外がまとめて入る高さ。寄りたい人は自分で拡大する
  defaultZoom: 12,
  // 引きは世界地図まで、寄りは棚の前まで。検証エリアは出品の可否だけに使い、
  // 見るぶんには制限しない。どこまでが対象かは引いて確かめられたほうがいい
  minZoom: 2,
  maxZoom: 20,
} as const;

const CARTO_KEY = process.env.EXPO_PUBLIC_CARTO_KEY;

/**
 * CARTO Voyager。道と水面だけ色を残してラベルを間引いた Google マップ寄りの見え方で、
 * 上に重ねる価格と残り時間が読みやすい。@2x があるので高解像度でも滲まない。
 *
 * キーなしでも表示はできるが「API KEY REQUIRED」の透かしが入る。
 * キーは無料（月500万タイルまで、https://carto.com/basemaps/apikey）。
 * 取得したら .env.local に EXPO_PUBLIC_CARTO_KEY を入れると透かしが消える。
 */
export const TILE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' +
  (CARTO_KEY ? `?key=${CARTO_KEY}` : '');
export const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
export const TILE_MAX_NATIVE_ZOOM = 20;
export const HAS_TILE_KEY = Boolean(CARTO_KEY);
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
export const MAP_ATTRIBUTION_URL = 'https://carto.com/attributions';
