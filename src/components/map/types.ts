import type { StyleProp, ViewStyle } from 'react-native';

import type { Urgency } from '@/domain/rules';
import type { Bounds, LatLng } from '@/domain/types';

/** 売り物のピンか、報酬がかかっている依頼か */
export type MarkerKind = 'sale' | 'bounty';

export interface MapMarkerModel {
  id: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  /** ピルの主表示。価格または報酬 */
  price: string;
  /**
   * ピルの副表示。残り時間。
   * 全部のピンに出すと地図が文字だらけになるので、急ぎのものだけ null 以外にする。
   */
  time: string | null;
  /** 右端の小さいバッジ。「あと1」や「3人」 */
  badge: string | null;
  tone: Urgency;
  selected: boolean;
}

export interface MapRing {
  center: LatLng;
  radiusM: number;
  tone?: 'area' | 'bounty';
}

/** 同じ座標へ二度飛ばしたいことがあるので nonce で発火させる */
export interface MapCameraTarget {
  center: LatLng;
  zoom?: number;
  nonce: number;
}

export interface MapCanvasProps {
  initialCenter: LatLng;
  initialZoom: number;
  markers: MapMarkerModel[];
  rings?: MapRing[];
  userLocation?: LatLng | null;
  /** 出品や依頼で位置を決めているときの仮ピン */
  draft?: LatLng | null;
  camera?: MapCameraTarget | null;
  /** ズームボタン用。delta の符号だけを見て段階的に寄せる */
  zoomNudge?: { delta: number; nonce: number } | null;
  /** タイルのクレジットを下から持ち上げる量。シートが覆う画面で使う */
  attributionInset?: number;
  onMarkerPress?: (id: string) => void;
  onBoundsChange?: (bounds: Bounds) => void;
  onMapPress?: (point: LatLng) => void;
  /**
   * false にすると地図は見せるだけで、ドラッグ・ホイール・ピンチを受けない。
   * スクロール画面の先頭に置くと、指が地図に取られてページが動かなくなる。
   */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
}
