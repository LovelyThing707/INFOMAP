import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { AREA } from '@/config/area';
import type { LatLng } from '@/domain/types';

export type LocationStatus = 'idle' | 'granted' | 'denied' | 'error';

export interface UserLocation {
  /** 実際に取れた座標 */
  raw: LatLng | null;
  /** 取れた座標。取れなければエリア中心 */
  effective: LatLng;
  /** GPSが取れずエリア中心にしている */
  simulated: boolean;
  status: LocationStatus;
  /** 位置が確定したか。フォームの初期値をここで待つ */
  resolved: boolean;
  request: () => Promise<LatLng>;
}

function readBrowserPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('geolocation_unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 15000 }
    );
  });
}

async function readPosition(): Promise<LatLng> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch (error) {
    if (Platform.OS === 'web') return readBrowserPosition();
    throw error;
  }
}

/**
 * 地図の現在地は実座標を使う。エリア外でも東京へ寄せない。
 * 出品できるかは各画面の isInsideArea で見る。
 */
export function useUserLocation(autoRequest = true): UserLocation {
  const [raw, setRaw] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  const request = useCallback(async (): Promise<LatLng> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        if (Platform.OS === 'web') {
          try {
            const point = await readBrowserPosition();
            setRaw(point);
            setStatus('granted');
            return point;
          } catch {
            setStatus('denied');
            return AREA.center;
          }
        }
        setStatus('denied');
        return AREA.center;
      }
      const point = await readPosition();
      setRaw(point);
      setStatus('granted');
      return point;
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

  return {
    raw,
    effective: raw ?? AREA.center,
    simulated: raw === null,
    status,
    resolved: status !== 'idle',
    request,
  };
}
