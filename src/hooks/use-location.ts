import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { AREA } from '@/config/area';
import { isInsideArea } from '@/domain/rules';
import type { LatLng } from '@/domain/types';

export type LocationStatus = 'idle' | 'granted' | 'denied' | 'error';

export interface UserLocation {
  /** 実際に取れた座標 */
  raw: LatLng | null;
  /** 検証エリアの外にいる場合はエリア中心に寄せた座標。アプリはこちらを使う */
  effective: LatLng;
  /** 検証エリア外にいて中心に寄せているか */
  simulated: boolean;
  status: LocationStatus;
  /** 位置が確定したか。フォームの初期値をここで待つ */
  resolved: boolean;
  request: () => Promise<LatLng>;
}

/**
 * MVPは都心に絞っているので、エリア外から開いた人は何も出品できず地図も空になる。
 * 実座標がエリア外なら中心へ寄せて、寄せていることを画面で明示する。
 */
export function useUserLocation(autoRequest = true): UserLocation {
  const [raw, setRaw] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  const request = useCallback(async (): Promise<LatLng> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatus('denied');
        return AREA.center;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      setRaw(point);
      setStatus('granted');
      return isInsideArea(point) ? point : AREA.center;
    } catch {
      setStatus('error');
      return AREA.center;
    }
  }, []);

  useEffect(() => {
    // 端末という外部システムに問い合わせ、返ってきたら state を更新する。
    // setState はすべて await の後に起きるが、lint からは非同期の境界が見えない
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoRequest) void request();
  }, [autoRequest, request]);

  const inside = raw !== null && isInsideArea(raw);
  return {
    raw,
    effective: inside && raw ? raw : AREA.center,
    simulated: !inside,
    status,
    resolved: status !== 'idle',
    request,
  };
}
