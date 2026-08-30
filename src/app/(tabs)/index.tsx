import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SnapSheet } from '@/components/SnapSheet';
import MapCanvas from '@/components/map/MapCanvas';
import type { MapCameraTarget, MapMarkerModel, MapRing } from '@/components/map/types';
import { BountyCard } from '@/components/sheet/BountyCard';
import { PinCard } from '@/components/sheet/PinCard';
import { PinDetail } from '@/components/sheet/PinDetail';
import { EmptyState } from '@/components/ui';
import { AREA } from '@/config/area';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { PurchaseFailure } from '@/data/repository';
import {
  boundsContain,
  formatRemaining,
  formatRemainingShort,
  formatYen,
  isBountyOpen,
  isPurchasable,
  remainingMs,
  remainingSlots,
  URGENT_MS,
  urgencyOf,
  WARN_MS,
  type Urgency,
} from '@/domain/rules';
import type { Bounds, BountyView, PublicPin } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

const PEEK_HEIGHT = 104;
/** SnapSheet のつまみ + 見出しぶん。中身の高さからシートの高さを決めるのに使う */
const SHEET_HEADER_HEIGHT = 52;

const PURCHASE_ERROR: Record<PurchaseFailure, string> = {
  not_found: 'この情報は見つかりませんでした',
  voided: '出品者が取り下げました',
  expired: '賞味期限が切れました',
  sold_out: '一足違いで枠が埋まりました',
  own_pin: '自分の出品は買えません',
  already_bought: 'すでに購入済みです',
  insufficient_balance: '残高が足りません',
};

/** 地図に何を出すか。既定は懸賞（報酬がかかっている依頼） */
type MapMode = 'bounty' | 'sale';

type FilterId = 'openOnly' | 'soon' | 'cheap' | 'noRivals' | 'highReward';

const FILTERS: Record<MapMode, { id: FilterId; label: string }[]> = {
  bounty: [
    { id: 'soon', label: '10分以内' },
    { id: 'noRivals', label: '誰も向かっていない' },
    { id: 'highReward', label: '300円以上' },
  ],
  sale: [
    { id: 'openOnly', label: '販売中' },
    { id: 'soon', label: '10分以内' },
    { id: 'cheap', label: '〜500円' },
  ],
};

function toneFor(remaining: number): Urgency {
  if (remaining <= URGENT_MS) return 'urgent';
  if (remaining <= WARN_MS) return 'warn';
  return 'fresh';
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const now = useNow(1000);
  const userId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const balance = useSession((s) => s.balance);
  const bump = useSession((s) => s.bump);
  const location = useUserLocation();

  const [mode, setMode] = useState<MapMode>('bounty');
  const [containerHeight, setContainerHeight] = useState(720);
  const [detailHeight, setDetailHeight] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [filters, setFilters] = useState<Set<FilterId>>(() => new Set<FilterId>());
  const [camera, setCamera] = useState<MapCameraTarget | null>(null);
  const [zoomNudge, setZoomNudge] = useState<{ delta: number; nonce: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraNonce = useRef(0);
  const zoomNonce = useRef(0);

  const boundsKey = bounds
    ? [bounds.north, bounds.south, bounds.east, bounds.west].map((v) => v.toFixed(4)).join(',')
    : '';

  const { value: pins } = useAsync<PublicPin[]>(
    () => repo.listPins({ viewerId: userId, now: nowMs(), bounds: bounds ?? undefined }),
    [userId, revision, boundsKey],
    []
  );

  const { value: bounties } = useAsync<BountyView[]>(
    () => repo.listBounties({ viewerId: userId, now: nowMs(), origin: location.effective }),
    [userId, revision],
    []
  );

  const { value: selectedPin } = useAsync(
    () =>
      mode === 'sale' && selectedId
        ? repo.getPin(selectedId, userId, nowMs())
        : Promise.resolve(null),
    [userId, revision, selectedId, mode],
    null
  );

  const origin = location.effective;

  const visiblePins = useMemo(
    () =>
      pins.filter((pin) => {
        if (filters.has('openOnly') && !isPurchasable(pin, now)) return false;
        if (filters.has('soon') && remainingMs(pin, now) > WARN_MS) return false;
        if (filters.has('cheap') && pin.price > 500) return false;
        return true;
      }),
    [pins, filters, now]
  );

  const visibleBounties = useMemo(
    () =>
      bounties.filter((bounty) => {
        // 締め切られた依頼は地図から消す。記録はリクエストタブに残る
        if (!isBountyOpen(bounty, now)) return false;
        if (bounds && !boundsContain(bounds, { lat: bounty.lat, lng: bounty.lng })) return false;
        if (filters.has('soon') && bounty.expiresAt - now > WARN_MS) return false;
        if (filters.has('noRivals') && bounty.headingCount > 0) return false;
        if (filters.has('highReward') && bounty.reward < 300) return false;
        return true;
      }),
    [bounties, bounds, filters, now]
  );

  const selectedBounty = useMemo(
    () =>
      mode === 'bounty' && selectedId ? (bounties.find((b) => b.id === selectedId) ?? null) : null,
    [mode, selectedId, bounties]
  );

  const sortedPins = useMemo(
    () =>
      visiblePins
        .slice()
        .sort(
          (a, b) =>
            Number(!isPurchasable(a, now)) - Number(!isPurchasable(b, now)) ||
            a.expiresAt - b.expiresAt
        ),
    [visiblePins, now]
  );

  const markers = useMemo<MapMarkerModel[]>(() => {
    if (mode === 'bounty') {
      return visibleBounties.map((bounty) => {
        const left = Math.max(0, bounty.expiresAt - now);
        const tone = toneFor(left);
        return {
          id: bounty.id,
          kind: 'bounty' as const,
          lat: bounty.lat,
          lng: bounty.lng,
          price: formatYen(bounty.reward),
          time: tone === 'fresh' ? null : formatRemainingShort(left),
          // 何人が向かっているかは、応募するかどうかの判断に一番効く
          badge: bounty.headingCount > 0 ? `${bounty.headingCount}人` : null,
          tone,
          selected: bounty.id === selectedId,
        };
      });
    }
    return visiblePins.map((pin) => {
      const tone = urgencyOf(pin, now);
      return {
        id: pin.id,
        kind: 'sale' as const,
        lat: pin.lat,
        lng: pin.lng,
        price: formatYen(pin.price),
        // 全部に残り時間を出すと地図が文字で埋まる。急いでいるものにだけ添えて、
        // 「時間が出ている＝もうすぐ消える」を見た目のルールにする
        time:
          tone === 'warn' || tone === 'urgent' ? formatRemainingShort(remainingMs(pin, now)) : null,
        badge: isPurchasable(pin, now) && remainingSlots(pin) === 1 ? 'あと1' : null,
        tone,
        selected: pin.id === selectedId,
      };
    });
  }, [mode, visibleBounties, visiblePins, now, selectedId]);

  const rings = useMemo<MapRing[]>(() => {
    const base: MapRing[] = [{ center: AREA.center, radiusM: AREA.radiusM }];
    // 依頼の対象範囲は選んだものだけ描く。全部出すと円だらけになる
    if (selectedBounty) {
      base.push({
        center: { lat: selectedBounty.lat, lng: selectedBounty.lng },
        radiusM: selectedBounty.radiusM,
        tone: 'bounty',
      });
    }
    return base;
  }, [selectedBounty]);

  const soonest = useMemo(() => {
    if (mode === 'bounty') {
      if (!visibleBounties.length) return null;
      const best = visibleBounties.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b));
      return { expiresAt: best.expiresAt, label: best.areaLabel };
    }
    const open = visiblePins.filter((p) => isPurchasable(p, now));
    if (!open.length) return null;
    const best = open.reduce((a, b) => (a.expiresAt < b.expiresAt ? a : b));
    return { expiresAt: best.expiresAt, label: best.placeLabel };
  }, [mode, visibleBounties, visiblePins, now]);

  const flyTo = useCallback((lat: number, lng: number, zoom?: number) => {
    cameraNonce.current += 1;
    setCamera({ center: { lat, lng }, zoom, nonce: cameraNonce.current });
  }, []);

  const nudgeZoom = useCallback((delta: number) => {
    zoomNonce.current += 1;
    setZoomNudge({ delta, nonce: zoomNonce.current });
  }, []);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setError(null);
      setSheetIndex((current) => Math.max(current, 1));
      const target =
        mode === 'bounty' ? bounties.find((b) => b.id === id) : pins.find((p) => p.id === id);
      if (target) flyTo(target.lat, target.lng);
    },
    [mode, bounties, pins, flyTo]
  );

  const switchMode = (next: MapMode) => {
    setMode(next);
    setSelectedId(null);
    setError(null);
    setFilters(new Set<FilterId>(next === 'sale' ? ['openOnly'] : []));
  };

  const handleBuy = useCallback(async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    const result = await repo.purchase(selectedId, userId, nowMs());
    if (!result.ok) setError(PURCHASE_ERROR[result.reason]);
    await bump();
    setBusy(false);
  }, [selectedId, userId, bump]);

  const handleReport = useCallback(async () => {
    if (!selectedId) return;
    await repo.createReport(userId, 'pin', selectedId, '扱わない情報の疑い', nowMs());
    await bump();
    setError('通報を受け付けました');
  }, [selectedId, userId, bump]);

  const handleApply = useCallback(
    async (bountyId: string) => {
      await repo.applyToBounty(bountyId, userId, nowMs());
      await bump();
    },
    [userId, bump]
  );

  const toggleFilter = (id: FilterId) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setContainerHeight(event.nativeEvent.layout.height);
  };

  const count = mode === 'bounty' ? visibleBounties.length : visiblePins.length;
  const detailOpen = mode === 'sale' ? Boolean(selectedPin) : Boolean(selectedBounty);

  // 依頼の詳細はカード1枚ぶんしかないので、決め打ちの高さまで開くと下に空白が残る。
  // 中身を測って、その高さで止める。
  const snapPoints = useMemo(() => {
    const full = Math.round(containerHeight * 0.92);
    const listMid = Math.round(containerHeight * 0.48);
    if (mode !== 'bounty' || !detailOpen || detailHeight <= 0) {
      return [PEEK_HEIGHT, listMid, full];
    }
    const fitted = Math.min(full, Math.max(200, Math.round(detailHeight) + SHEET_HEADER_HEIGHT));
    return [PEEK_HEIGHT, fitted, full];
  }, [containerHeight, mode, detailOpen, detailHeight]);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <MapCanvas
        initialCenter={AREA.center}
        initialZoom={AREA.defaultZoom}
        markers={markers}
        rings={rings}
        userLocation={location.raw && !location.simulated ? location.raw : AREA.center}
        camera={camera}
        zoomNudge={zoomNudge}
        attributionInset={PEEK_HEIGHT + 6}
        onMarkerPress={select}
        onBoundsChange={setBounds}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.modeSwitch}>
            <Pressable
              onPress={() => switchMode('bounty')}
              style={[styles.modeButton, mode === 'bounty' && styles.modeButtonActive]}>
              <Ionicons
                name="megaphone"
                size={13}
                color={mode === 'bounty' ? '#fff' : Colors.textSub}
              />
              <Text style={[styles.modeText, mode === 'bounty' && styles.modeTextActive]}>募集</Text>
            </Pressable>
            <Pressable
              onPress={() => switchMode('sale')}
              style={[styles.modeButton, mode === 'sale' && styles.modeButtonActiveSale]}>
              <Ionicons name="pricetag" size={13} color={mode === 'sale' ? '#fff' : Colors.textSub} />
              <Text style={[styles.modeText, mode === 'sale' && styles.modeTextActive]}>販売</Text>
            </Pressable>
          </View>
          <View style={styles.balanceChip}>
            <Text style={styles.balanceText}>{formatYen(balance.available)}</Text>
          </View>
        </View>

        <View style={styles.filterRow} pointerEvents="box-none">
          {FILTERS[mode].map((filter) => {
            const active = filters.has(filter.id);
            return (
              <Pressable
                key={filter.id}
                onPress={() => toggleFilter(filter.id)}
                style={[styles.filterChip, active && styles.filterChipActive]}>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
          {location.simulated ? (
            <View style={styles.hintChip}>
              <Ionicons name="information-circle" size={12} color={Colors.warn} />
              <Text style={styles.hintText}>現在地はエリア中心</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.floatingButtons, { bottom: PEEK_HEIGHT + Spacing.md }]}>
        <View style={styles.zoomGroup}>
          <Pressable style={styles.zoomButton} onPress={() => nudgeZoom(1)}>
            <Ionicons name="add" size={19} color={Colors.text} />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable style={styles.zoomButton} onPress={() => nudgeZoom(-1)}>
            <Ionicons name="remove" size={19} color={Colors.text} />
          </Pressable>
        </View>
        <Pressable
          style={styles.roundButton}
          onPress={async () => {
            const point = await location.request();
            flyTo(point.lat, point.lng, AREA.defaultZoom);
          }}>
          <Ionicons name="locate" size={19} color={Colors.text} />
        </Pressable>
      </View>

      <SnapSheet
        snapPoints={snapPoints}
        index={sheetIndex}
        onIndexChange={setSheetIndex}
        header={
          detailOpen ? (
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeaderTitle} numberOfLines={1}>
                {mode === 'sale' ? selectedPin?.headline : selectedBounty?.targetText}
              </Text>
            </View>
          ) : (
            <View style={styles.sheetHeaderRow}>
              <Pressable
                style={styles.sheetHeader}
                onPress={() => setSheetIndex(sheetIndex === 0 ? 1 : 0)}>
                <Text style={styles.summaryMain}>
                  {mode === 'bounty' ? 'この範囲に依頼が ' : 'この範囲に '}
                  <Text style={styles.summaryStrong}>{count}件</Text>
                </Text>
                <Text style={styles.summarySub}>
                  {soonest
                    ? `最短 残り${formatRemaining(soonest.expiresAt - now)}・${soonest.label}`
                    : mode === 'bounty'
                      ? '募集中の依頼はありません'
                      : '販売中の情報はありません'}
                </Text>
              </Pressable>
              {mode === 'bounty' ? (
                <Pressable style={styles.newButton} onPress={() => router.push('/request-new')}>
                  <Ionicons name="add" size={15} color="#fff" />
                  <Text style={styles.newButtonText}>依頼</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }>
        {mode === 'sale' && selectedPin ? (
          <PinDetail
            pin={selectedPin}
            now={now}
            origin={origin}
            available={balance.available}
            meId={userId}
            busy={busy}
            error={error}
            onBuy={handleBuy}
            onClose={() => {
              setSelectedId(null);
              setError(null);
            }}
            onReport={handleReport}
            onOpenSeller={() =>
              router.push({ pathname: '/user/[id]', params: { id: selectedPin.sellerId } })
            }
          />
        ) : mode === 'bounty' && selectedBounty ? (
          <View
            style={styles.detail}
            onLayout={(event) => setDetailHeight(event.nativeEvent.layout.height)}>
            <Pressable style={styles.backRow} onPress={() => setSelectedId(null)} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={Colors.textSub} />
              <Text style={styles.backText}>一覧へ</Text>
            </Pressable>
            <BountyCard
              bounty={selectedBounty}
              now={now}
              userId={userId}
              origin={origin}
              onApply={() => handleApply(selectedBounty.id)}
              onOpen={() =>
                router.push({ pathname: '/request/[id]', params: { id: selectedBounty.id } })
              }
            />
          </View>
        ) : mode === 'bounty' ? (
          <FlatList
            data={visibleBounties}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState
                title="この範囲に募集はありません"
                body="地図を動かすか、フィルタを外してみてください。報酬を置いて探してもらうこともできます"
              />
            }
            renderItem={({ item }) => (
              <BountyCard
                bounty={item}
                now={now}
                userId={userId}
                origin={origin}
                onApply={() => handleApply(item.id)}
                onOpen={() => select(item.id)}
              />
            )}
          />
        ) : (
          <FlatList
            data={sortedPins}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState
                title="この範囲には情報がありません"
                body="地図を動かすか、フィルタを外してみてください。腐る前の情報しか出ないので、時間帯によっては空になります"
              />
            }
            renderItem={({ item }) => (
              <PinCard
                pin={item}
                now={now}
                origin={origin}
                selected={item.id === selectedId}
                onPress={() => select(item.id)}
              />
            )}
          />
        )}
      </SnapSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bgAlt },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: Colors.bg,
    borderRadius: Radius.pill,
    padding: 3,
    gap: 2,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  modeButtonActive: { backgroundColor: Colors.money },
  modeButtonActiveSale: { backgroundColor: Colors.brand },
  modeText: { fontSize: 13, fontWeight: '700', color: Colors.textSub, fontFamily: Fonts.sans },
  modeTextActive: { color: '#fff', fontWeight: '800' },

  balanceChip: {
    marginLeft: 'auto',
    backgroundColor: Colors.bg,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  balanceText: { fontSize: 13, fontWeight: '800', color: Colors.money, fontFamily: Fonts.sans },

  filterRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterChip: {
    backgroundColor: Colors.bg,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  filterChipActive: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  filterText: { fontSize: 12, fontWeight: '700', color: Colors.textSub, fontFamily: Fonts.sans },
  filterTextActive: { color: '#fff' },

  hintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  hintText: { fontSize: 11, color: Colors.warn, fontFamily: Fonts.sans },

  floatingButtons: {
    position: 'absolute',
    right: Spacing.md,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  zoomGroup: {
    width: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  zoomButton: { height: 40, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 8 },

  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Spacing.lg,
  },
  sheetHeader: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: 2 },
  sheetHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textSub,
    fontFamily: Fonts.sans,
  },
  summaryMain: { fontSize: 16, color: Colors.text, fontFamily: Fonts.sans },
  summaryStrong: { fontSize: 20, fontWeight: '800', color: Colors.text },
  summarySub: { fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },

  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.money,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  newButtonText: { fontSize: 12, fontWeight: '800', color: '#fff', fontFamily: Fonts.sans },

  detail: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },

  listContent: { padding: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: 40 },
});
