import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import {
  AREA,
  MAP_ATTRIBUTION,
  MAP_ATTRIBUTION_URL,
  TILE_MAX_NATIVE_ZOOM,
  TILE_SUBDOMAINS,
  TILE_URL,
} from '@/config/area';
import { Colors } from '@/constants/theme';
import type { Bounds, LatLng } from '@/domain/types';

import type { MapCameraTarget, MapCanvasProps, MapMarkerModel } from './types';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * LUUPのポートピンが台数を見せているのと同じ役割を、価格・残り時間・残枠で担う。
 * divIcon にすることで、色や点滅の表現を global.css 側に寄せられる。
 */
function pinIcon(marker: MapMarkerModel): L.DivIcon {
  const classes = ['im-pin', `im-pin--${marker.tone}`, `im-pin--${marker.kind}`];
  if (marker.selected) classes.push('im-pin--selected');
  const time = marker.time ? `<span class="im-pin__time">${escapeHtml(marker.time)}</span>` : '';
  const last = marker.badge ? `<span class="im-pin__last">${escapeHtml(marker.badge)}</span>` : '';
  // iconSize を渡すと Leaflet が要素に width/height を焼き込んでピルが潰れる。
  // 大きさは中身に任せ、位置合わせは CSS の translate だけで行う。
  return L.divIcon({
    className: 'im-pin-icon',
    html:
      `<div class="im-pin-anchor"><div class="${classes.join(' ')}">` +
      `<span>${escapeHtml(marker.price)}</span>${time}${last}` +
      `</div></div>`,
  });
}

// 密集した場所では重なるので、消えかけているものほど前に出す
const TONE_LAYER: Record<MapMarkerModel['tone'], number> = {
  urgent: 600,
  warn: 400,
  fresh: 200,
  dead: 0,
};

const userIcon = L.divIcon({
  className: 'im-dot-icon',
  html: '<div class="im-dot-anchor"><div class="im-dot"></div></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const draftIcon = L.divIcon({
  className: 'im-pin-icon',
  html: '<div class="im-pin-anchor"><div class="im-draft">ここ</div><div class="im-draft__tail"></div></div>',
});

/**
 * OpenStreetMap 系のタイルはクレジットの表示が利用条件なので、必ず見える位置に置く。
 * 地図タブは下をシートが覆うので、呼び出し側から inset をもらって持ち上げる。
 */
function isFinitePoint(point: LatLng | undefined): point is LatLng {
  return (
    !!point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
}

function mapHasSize(map: L.Map): boolean {
  const size = map.getSize();
  return size.x >= 2 && size.y >= 2;
}

function Attribution({ inset }: { inset: number }) {
  return (
    <Pressable
      style={[styles.attribution, { bottom: inset }]}
      onPress={() => Linking.openURL(MAP_ATTRIBUTION_URL)}>
      <Text style={styles.attributionText}>{MAP_ATTRIBUTION}</Text>
    </Pressable>
  );
}

function MapEvents({
  onBoundsChange,
  onMapPress,
}: {
  onBoundsChange?: (bounds: Bounds) => void;
  onMapPress?: (point: LatLng) => void;
}) {
  const emit = (map: L.Map) => {
    if (!onBoundsChange || !mapHasSize(map)) return;
    const b = map.getBounds();
    const north = b.getNorth();
    const south = b.getSouth();
    const east = b.getEast();
    const west = b.getWest();
    if (![north, south, east, west].every(Number.isFinite)) return;
    onBoundsChange({ north, south, east, west });
  };

  const map = useMapEvents({
    moveend: () => emit(map),
    zoomend: () => emit(map),
    click: (event) => onMapPress?.({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });

  useEffect(() => {
    // 画面遷移の直後はコンテナの大きさが確定しておらず、Leaflet が誤った表示領域を
    // 計算してピンが1つも範囲に入らないことがある。大きさが変わるたびに測り直す。
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      emit(map);
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

function CameraController({
  camera,
  zoomNudge,
}: {
  camera?: MapCameraTarget | null;
  zoomNudge?: { delta: number; nonce: number } | null;
}) {
  const map = useMap();
  const lastCamera = useRef<number>(-1);
  const lastZoom = useRef<number>(-1);

  useEffect(() => {
    if (!camera || camera.nonce === lastCamera.current) return;
    if (!isFinitePoint(camera.center)) return;

    const zoom = camera.zoom ?? map.getZoom();
    if (!Number.isFinite(zoom)) return;

    const move = () => {
      if (!mapHasSize(map)) return false;
      map.invalidateSize();
      // タブ切替や iframe 直後は箱が 0 のまま flyTo すると Leaflet が NaN を投げる
      map.setView([camera.center.lat, camera.center.lng], zoom, { animate: false });
      lastCamera.current = camera.nonce;
      return true;
    };

    if (move()) return;

    const observer = new ResizeObserver(() => {
      if (move()) observer.disconnect();
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [camera, map]);

  useEffect(() => {
    if (!zoomNudge || zoomNudge.nonce === lastZoom.current) return;
    if (!mapHasSize(map)) return;
    lastZoom.current = zoomNudge.nonce;
    if (zoomNudge.delta > 0) map.zoomIn();
    else map.zoomOut();
  }, [zoomNudge, map]);

  return null;
}

export default function MapCanvas({
  initialCenter,
  initialZoom,
  markers,
  rings,
  userLocation,
  draft,
  camera,
  zoomNudge,
  attributionInset = 4,
  onMarkerPress,
  onBoundsChange,
  onMapPress,
  interactive = true,
  style,
}: MapCanvasProps) {
  const icons = useMemo(() => markers.map((m) => ({ marker: m, icon: pinIcon(m) })), [markers]);

  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]}>
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        minZoom={AREA.minZoom}
        maxZoom={AREA.maxZoom}
        /**
         * 横に流し続けると地球を1周して戻ってくる。タイルはもともと繰り返し描かれるが、
         * ピンは2周目の座標には置かれないので、そのままだと回した先が空になる。
         * worldCopyJump は1周ぶん進んだ時点で表示を元の世界へ差し替え、
         * 見た目を保ったままピンが消えないようにする。
         */
        worldCopyJump
        dragging={interactive}
        scrollWheelZoom={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        className={interactive ? undefined : 'im-map--static'}
        zoomControl={false}
        attributionControl={false}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <TileLayer
          url={TILE_URL}
          subdomains={TILE_SUBDOMAINS}
          detectRetina
          maxNativeZoom={TILE_MAX_NATIVE_ZOOM}
          maxZoom={AREA.maxZoom}
        />

        {rings?.map((ring, index) => {
          const bounty = ring.tone === 'bounty';
          return (
            <Circle
              key={`ring-${index}`}
              center={[ring.center.lat, ring.center.lng]}
              radius={ring.radiusM}
              interactive={false}
              pathOptions={{
                color: bounty ? Colors.warn : Colors.borderStrong,
                weight: 1,
                opacity: bounty ? 0.6 : 0.55,
                fillColor: bounty ? Colors.warn : Colors.textFaint,
                fillOpacity: bounty ? 0.06 : 0.02,
              }}
            />
          );
        })}

        {icons.map(({ marker, icon }) => (
          <Marker
            key={marker.id}
            position={[marker.lat, marker.lng]}
            icon={icon}
            zIndexOffset={marker.selected ? 1000 : TONE_LAYER[marker.tone]}
            eventHandlers={{ click: () => onMarkerPress?.(marker.id) }}
          />
        ))}

        {userLocation ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userIcon}
            interactive={false}
          />
        ) : null}

        {draft ? (
          <Marker position={[draft.lat, draft.lng]} icon={draftIcon} interactive={false} />
        ) : null}

        <MapEvents onBoundsChange={onBoundsChange} onMapPress={onMapPress} />
        <CameraController camera={camera} zoomNudge={zoomNudge} />
      </MapContainer>
      <Attribution inset={attributionInset} />
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    left: 6,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  attributionText: { fontSize: 9, color: '#64748B' },
});
