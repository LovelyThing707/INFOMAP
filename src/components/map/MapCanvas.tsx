import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';

import { AREA } from '@/config/area';
import { Colors } from '@/constants/theme';
import type { Urgency } from '@/domain/rules';

import type { MapCanvasProps } from './types';

const TONE_BG: Record<Urgency, string> = {
  fresh: Colors.fresh,
  warn: Colors.warn,
  urgent: Colors.urgent,
  dead: Colors.dead,
};

// 報酬がかかっている依頼は、余裕があるうちは売り物と別の色で出す
function markerColor(kind: MapCanvasProps['markers'][number]['kind'], tone: Urgency): string {
  if (kind === 'bounty' && tone === 'fresh') return Colors.money;
  return TONE_BG[tone];
}

function deltaForZoom(zoom: number): number {
  return 360 / 2 ** zoom;
}

/**
 * ネイティブ側の実装。Web 版（MapCanvas.web.tsx）と props を揃えてあるので、
 * 呼び出し側は差を意識しない。実機確認は次段階。
 */
export default function MapCanvas({
  initialCenter,
  initialZoom,
  markers,
  rings,
  userLocation,
  draft,
  camera,
  zoomNudge,
  onMarkerPress,
  onBoundsChange,
  onMapPress,
  interactive = true,
  style,
}: MapCanvasProps) {
  const mapRef = useRef<MapView | null>(null);
  const lastCamera = useRef(-1);
  const lastZoom = useRef(-1);

  useEffect(() => {
    if (!camera || camera.nonce === lastCamera.current) return;
    lastCamera.current = camera.nonce;
    const delta = deltaForZoom(camera.zoom ?? initialZoom);
    mapRef.current?.animateToRegion(
      {
        latitude: camera.center.lat,
        longitude: camera.center.lng,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      550
    );
  }, [camera, initialZoom]);

  useEffect(() => {
    if (!zoomNudge || zoomNudge.nonce === lastZoom.current) return;
    lastZoom.current = zoomNudge.nonce;
    mapRef.current?.getCamera().then((current) => {
      const zoom = (current.zoom ?? initialZoom) + (zoomNudge.delta > 0 ? 1 : -1);
      mapRef.current?.animateCamera({ zoom }, { duration: 250 });
    });
  }, [zoomNudge, initialZoom]);

  const handleRegion = (region: Region) => {
    onBoundsChange?.({
      north: region.latitude + region.latitudeDelta / 2,
      south: region.latitude - region.latitudeDelta / 2,
      east: region.longitude + region.longitudeDelta / 2,
      west: region.longitude - region.longitudeDelta / 2,
    });
  };

  const initialDelta = deltaForZoom(initialZoom);

  return (
    <View style={[{ flex: 1 }, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        showsUserLocation={!userLocation}
        showsMyLocationButton={false}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        pitchEnabled={interactive}
        rotateEnabled={interactive}
        minZoomLevel={AREA.minZoom}
        maxZoomLevel={AREA.maxZoom}
        initialRegion={{
          latitude: initialCenter.lat,
          longitude: initialCenter.lng,
          latitudeDelta: initialDelta,
          longitudeDelta: initialDelta,
        }}
        onRegionChangeComplete={handleRegion}
        onPress={(event) =>
          onMapPress?.({
            lat: event.nativeEvent.coordinate.latitude,
            lng: event.nativeEvent.coordinate.longitude,
          })
        }>
        {rings?.map((ring, index) => (
          <Circle
            key={`ring-${index}`}
            center={{ latitude: ring.center.lat, longitude: ring.center.lng }}
            radius={ring.radiusM}
            strokeColor={ring.tone === 'bounty' ? Colors.warn : Colors.brand}
            strokeWidth={1.5}
            fillColor="rgba(29,78,216,0.05)"
          />
        ))}

        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.lat, longitude: marker.lng }}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={marker.selected ? 1000 : 1}
            onPress={() => onMarkerPress?.(marker.id)}>
            <View
              style={[
                styles.pin,
                { backgroundColor: markerColor(marker.kind, marker.tone) },
                marker.selected && styles.pinSelected,
                marker.tone === 'dead' && styles.pinDead,
              ]}>
              <Text style={styles.pinPrice}>{marker.price}</Text>
              {marker.time ? <Text style={styles.pinTime}>{marker.time}</Text> : null}
              {marker.badge ? (
                <View style={styles.pinLast}>
                  <Text style={styles.pinLastText}>{marker.badge}</Text>
                </View>
              ) : null}
            </View>
          </Marker>
        ))}

        {draft ? (
          <Marker coordinate={{ latitude: draft.lat, longitude: draft.lng }} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.draft}>
              <Text style={styles.draftText}>ここ</Text>
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinSelected: { transform: [{ scale: 1.16 }] },
  pinDead: { opacity: 0.75, transform: [{ scale: 0.85 }] },
  pinPrice: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pinTime: { color: '#fff', fontSize: 11, fontWeight: '600', opacity: 0.85 },
  pinLast: {
    marginLeft: 2,
    paddingHorizontal: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  pinLastText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  draft: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.text,
  },
  draftText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
