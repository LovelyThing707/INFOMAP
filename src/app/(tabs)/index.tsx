import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  amountOptions,
  boolFilter,
  FilterBar,
  minuteOptions,
  numberFilter,
  type FilterDef,
  type FilterValues,
} from '@/components/FilterBar';
import { SnapSheet } from '@/components/SnapSheet';
import MapCanvas from '@/components/map/MapCanvas';
import type { MapCameraTarget, MapMarkerModel, MapRing } from '@/components/map/types';
import { BountyCard } from '@/components/sheet/BountyCard';
import { PinCard } from '@/components/sheet/PinCard';
import { Avatar } from '@/components/badges';
import { EmptyState } from '@/components/ui';
import { AREA } from '@/config/area';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';
import type { ApplyFailure, SellerPinView } from '@/data/repository';
import {
  boundsContain,
  compareDeadline,
  isInsideArea,
  confirmedAtOf,
  distanceM,
  formatFreshness,
  formatRemaining,
  formatRemainingShort,
  formatYen,
  isBountyOpen,
  isOpenEnded,
  isPurchasable,
  MAX_ACTIVE_CLAIMS,
  remainingMs,
  remainingSlots,
  URGENT_MS,
  urgencyOf,
  WARN_MS,
  type Urgency,
} from '@/domain/rules';
import type { Bounds, BountyView, PublicPin, RevealedPin } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { openSignIn, requireSignedIn } from '@/lib/auth-gate';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

const PEEK_HEIGHT = 104;
/** SnapSheet のつまみ + 見出しぶん。中身の高さからシートの高さを決めるのに使う */
const SHEET_HEADER_HEIGHT = 52;

const APPLY_ERROR: Record<ApplyFailure, string> = {
  not_found: 'この依頼は見つかりませんでした',
  closed: 'もう締め切られています',
  own_bounty: '自分の依頼には応募できません',
  duplicate: 'すでに応募しています',
  too_many: `同時に応募できるのは${MAX_ACTIVE_CLAIMS}件までです`,
};

/** 地図に何を出すか。既定は懸賞（報酬がかかっている依頼） */
type MapMode = 'bounty' | 'sale';

const REWARD_STEPS = [100, 200, 300, 500, 1000];
const PRICE_STEPS = [100, 200, 300, 500, 1000];
const MINUTE_STEPS = [5, 10, 30, 60];

const FILTERS: Record<MapMode, FilterDef[]> = {
  bounty: [
    { kind: 'choice', id: 'minReward', label: '報酬', options: amountOptions(REWARD_STEPS, 'min') },
    { kind: 'choice', id: 'withinMin', label: '残り時間', options: minuteOptions(MINUTE_STEPS) },
    { kind: 'toggle', id: 'noRivals', label: '誰も向かっていない' },
  ],
  sale: [
    { kind: 'toggle', id: 'openOnly', label: '販売中' },
    { kind: 'choice', id: 'maxPrice', label: '価格', options: amountOptions(PRICE_STEPS, 'max') },
    { kind: 'choice', id: 'withinMin', label: '残り時間', options: minuteOptions(MINUTE_STEPS) },
  ],
};

function toneFor(remaining: number): Urgency {
  if (remaining <= URGENT_MS) return 'urgent';
  if (remaining <= WARN_MS) return 'warn';
  return 'fresh';
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const now = useNow(1000);
  const userId = useSession((s) => s.userId);
  const signedIn = useSession((s) => s.signedIn);
  const me = useSession((s) => s.me);
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
  const [filters, setFilters] = useState<FilterValues>({});
  const [camera, setCamera] = useState<MapCameraTarget | null>(null);
  const [zoomNudge, setZoomNudge] = useState<{ delta: number; nonce: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const cameraNonce = useRef(0);
  const zoomNonce = useRef(0);
  const didFlyToUser = useRef(false);

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

  const { value: myPurchases } = useAsync<RevealedPin[]>(
    () => (signedIn ? repo.listMyPurchases(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: mySold } = useAsync<SellerPinView[]>(
    () => (signedIn ? repo.listMyPins(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
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

  const withinMin = numberFilter(filters, 'withinMin');
  const withinMs = withinMin === null ? null : withinMin * 60 * 1000;
  const maxPrice = numberFilter(filters, 'maxPrice');
  const minReward = numberFilter(filters, 'minReward');

  const needle = query.trim().toLowerCase();
  const hitsQuery = (text: string) => !needle || text.toLowerCase().includes(needle);

  const visiblePins = useMemo(
    () =>
      pins.filter((pin) => {
        if (boolFilter(filters, 'openOnly') && !isPurchasable(pin, now)) return false;
        if (withinMs !== null && remainingMs(pin, now) > withinMs) return false;
        if (maxPrice !== null && pin.price > maxPrice) return false;
        if (!hitsQuery(`${pin.headline} ${pin.placeLabel}`)) return false;
        return true;
      }),
    [pins, filters, now, withinMs, maxPrice, needle]
  );

  const visibleBounties = useMemo(
    () =>
      bounties.filter((bounty) => {
        // 締め切られた依頼は地図から消す。記録はリクエストタブに残る
        if (!isBountyOpen(bounty, now)) return false;
        if (bounds && !boundsContain(bounds, { lat: bounty.lat, lng: bounty.lng })) return false;
        if (withinMs !== null && bounty.expiresAt - now > withinMs) return false;
        if (boolFilter(filters, 'noRivals') && bounty.headingCount > 0) return false;
        if (minReward !== null && bounty.reward < minReward) return false;
        if (!hitsQuery(`${bounty.targetText} ${bounty.areaLabel} ${bounty.placeHint ?? ''}`)) {
          return false;
        }
        return true;
      }),
    [bounties, bounds, filters, now, withinMs, minReward, needle]
  );

  const noticeCount = useMemo(() => {
    const pendingBuy = myPurchases.filter((pin) => pin.purchase.escrow === 'held').length;
    const pendingSell = mySold.filter((item) =>
      item.purchases.some((purchase) => purchase.escrow === 'held')
    ).length;
    const reports = bounties.filter(
      (bounty) => bounty.requesterId === userId && bounty.reportedCount > 0
    ).length;
    const mine = bounties.filter(
      (bounty) =>
        bounty.myApplication?.status === 'heading' || bounty.myApplication?.status === 'reported'
    ).length;
    return pendingBuy + pendingSell + reports + mine;
  }, [myPurchases, mySold, bounties, userId]);

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
            compareDeadline(a, b)
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
        time: isOpenEnded(pin)
          ? tone === 'warn'
            ? formatFreshness(now - confirmedAtOf(pin))
            : null
          : tone === 'warn' || tone === 'urgent'
            ? formatRemainingShort(remainingMs(pin, now))
            : null,
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
      return { kind: 'deadline' as const, at: best.expiresAt, label: best.areaLabel };
    }
    const open = visiblePins.filter((p) => isPurchasable(p, now));
    if (!open.length) return null;
    const timed = open.filter((p) => p.expiresAt !== null);
    if (timed.length) {
      const best = timed.reduce((a, b) => (compareDeadline(a, b) < 0 ? a : b));
      return { kind: 'deadline' as const, at: best.expiresAt as number, label: best.placeLabel };
    }
    const freshest = open.reduce((a, b) => (confirmedAtOf(a) >= confirmedAtOf(b) ? a : b));
    return { kind: 'fresh' as const, at: confirmedAtOf(freshest), label: freshest.placeLabel };
  }, [mode, visibleBounties, visiblePins, now]);

  const flyTo = useCallback((lat: number, lng: number, zoom?: number) => {
    cameraNonce.current += 1;
    setCamera({ center: { lat, lng }, zoom, nonce: cameraNonce.current });
  }, []);

  useEffect(() => {
    if (didFlyToUser.current || !location.raw) return;
    didFlyToUser.current = true;
    flyTo(location.raw.lat, location.raw.lng, AREA.defaultZoom);
  }, [location.raw, flyTo]);

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
    setFilters(next === 'sale' ? { openOnly: true } : {});
  };

  const handleApply = useCallback(
    async (bountyId: string) => {
      if (!requireSignedIn()) return;
      const bounty = bounties.find((b) => b.id === bountyId);
      if (!bounty) return;
      // 座標は渡さない。押した地点から依頼中心までの距離だけを残す
      const away = distanceM(location.effective, { lat: bounty.lat, lng: bounty.lng });
      const result = await repo.applyToBounty(bountyId, userId, away, nowMs());
      if (!result.ok) setError(APPLY_ERROR[result.reason]);
      await bump();
    },
    [userId, bump, location.effective, bounties]
  );

  const changeFilter = (id: string, value: FilterValues[string]) => {
    setFilters((current) => ({ ...current, [id]: value }));
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setContainerHeight(event.nativeEvent.layout.height);
  };

  const count =
    mode === 'bounty' ? visibleBounties.length : visiblePins.length;
  const detailOpen = mode === 'sale' ? Boolean(selectedPin) : Boolean(selectedBounty);

  // 依頼／販売のプレビューはカードぶんしかないので、中身を測ってその高さで止める。
  const snapPoints = useMemo(() => {
    const full = Math.round(containerHeight * 0.92);
    const listMid = Math.round(containerHeight * 0.48);
    if (!detailOpen || detailHeight <= 0) {
      return [PEEK_HEIGHT, listMid, full];
    }
    const fitted = Math.min(full, Math.max(200, Math.round(detailHeight) + SHEET_HEADER_HEIGHT));
    return [PEEK_HEIGHT, fitted, full];
  }, [containerHeight, detailOpen, detailHeight]);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <MapCanvas
        initialCenter={AREA.center}
        initialZoom={AREA.defaultZoom}
        markers={markers}
        rings={rings}
        userLocation={location.raw ?? AREA.center}
        camera={camera}
        zoomNudge={zoomNudge}
        attributionInset={PEEK_HEIGHT + 6}
        onMarkerPress={select}
        onBoundsChange={setBounds}
      />

      <View style={styles.topBar} pointerEvents="box-none">
        {/*
          paddingTop を横並び行に載せると Web で縦中央寄せと干渉し、
          検索バーが Dynamic Island に被ることがある。余白は別 View に分離する。
        */}
        <View style={[styles.homeHeader, { backgroundColor: colors.bg }]}>
          <View style={{ height: insets.top, backgroundColor: colors.bg }} />
          <View style={styles.homeHeaderRow}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  if (text.trim()) {
                    setSelectedId(null);
                    setSheetIndex((index) => (index === 0 ? 1 : index));
                  }
                }}
                placeholder="探す"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                returnKeyType="search"
              />
            </View>
            <Pressable
              onPress={() => (signedIn ? router.push('/notifications') : openSignIn())}
              style={styles.headerIcon}
              hitSlop={8}
              accessibilityLabel="通知">
              <Ionicons name="notifications-outline" size={22} color={colors.text} />
              {noticeCount > 0 ? (
                <View style={styles.noticeDot}>
                  <Text style={styles.noticeDotText}>{noticeCount > 9 ? '9+' : noticeCount}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => (signedIn ? router.navigate('/(tabs)/me') : openSignIn())}
              style={styles.headerIcon}
              hitSlop={8}
              accessibilityLabel="マイページ">
              {me ? (
                <Avatar emoji={me.emoji} size={30} />
              ) : (
                <Ionicons name="person-circle-outline" size={26} color={colors.text} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.topPad} pointerEvents="box-none">
          <View style={styles.topRow} pointerEvents="box-none">
            <View style={styles.modeSwitch}>
              <Pressable
                onPress={() => switchMode('bounty')}
                style={[styles.modeButton, mode === 'bounty' && styles.modeButtonActive]}>
                <Ionicons
                  name="megaphone"
                  size={13}
                  color={mode === 'bounty' ? colors.onBrand : colors.textSub}
                />
                <Text style={[styles.modeText, mode === 'bounty' && styles.modeTextActive]}>
                  募集
                </Text>
              </Pressable>
              <Pressable
                onPress={() => switchMode('sale')}
                style={[styles.modeButton, mode === 'sale' && styles.modeButtonActiveSale]}>
                <Ionicons
                  name="pricetag"
                  size={13}
                  color={mode === 'sale' ? colors.onBrand : colors.textSub}
                />
                <Text style={[styles.modeText, mode === 'sale' && styles.modeTextActive]}>販売</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.balanceChip}
              onPress={signedIn ? undefined : openSignIn}
              accessibilityLabel={signedIn ? '残高' : 'ログイン'}>
              <Text style={styles.balanceText}>
                {signedIn ? formatYen(balance.available) : 'ログイン'}
              </Text>
            </Pressable>
          </View>

          <FilterBar
            filters={FILTERS[mode]}
            values={filters}
            onChange={changeFilter}
            elevated
          />

          {location.simulated ? (
            <View style={styles.hintChip}>
              <Ionicons name="information-circle" size={12} color={colors.warn} />
              <Text style={styles.hintText}>現在地を取得できませんでした</Text>
            </View>
          ) : location.raw && !isInsideArea(location.raw) ? (
            <View style={styles.hintChip}>
              <Ionicons name="information-circle" size={12} color={colors.warn} />
              <Text style={styles.hintText}>東京圏の外です。見るだけできます</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.floatingButtons, { bottom: PEEK_HEIGHT + Spacing.md }]}>
        <View style={styles.zoomGroup}>
          <Pressable style={styles.zoomButton} onPress={() => nudgeZoom(1)}>
            <Ionicons name="add" size={19} color={colors.text} />
          </Pressable>
          <View style={styles.zoomDivider} />
          <Pressable style={styles.zoomButton} onPress={() => nudgeZoom(-1)}>
            <Ionicons name="remove" size={19} color={colors.text} />
          </Pressable>
        </View>
        <Pressable
          style={styles.roundButton}
          onPress={async () => {
            const point = await location.request();
            flyTo(point.lat, point.lng, AREA.defaultZoom);
          }}>
          <Ionicons name="locate" size={19} color={colors.text} />
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
                  {mode === 'bounty' ? 'この範囲に依頼が ' : 'この範囲に情報が '}
                  <Text style={styles.summaryStrong}>{count}件</Text>
                </Text>
                <Text style={styles.summarySub}>
                  {soonest
                    ? soonest.kind === 'deadline'
                      ? `最短 残り${formatRemaining(soonest.at - now)}・${soonest.label}`
                      : `確認 ${formatFreshness(now - soonest.at)}・${soonest.label}`
                    : mode === 'bounty'
                      ? '募集中の依頼はありません'
                      : '販売中の情報はありません'}
                </Text>
              </Pressable>
              {mode === 'bounty' ? (
                <Pressable style={styles.newButton} onPress={() => router.push('/request-new')}>
                  <Ionicons name="add" size={15} color={colors.onBrand} />
                  <Text style={styles.newButtonText}>依頼</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }>
        {mode === 'sale' && selectedPin ? (
          <View
            style={styles.detail}
            onLayout={(event) => setDetailHeight(event.nativeEvent.layout.height)}>
            <Pressable
              style={styles.backRow}
              onPress={() => {
                setSelectedId(null);
                setError(null);
              }}
              hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.textSub} />
              <Text style={styles.backText}>一覧へ</Text>
            </Pressable>
            {error ? <Text style={styles.applyError}>{error}</Text> : null}
            <PinCard
              pin={selectedPin}
              now={now}
              origin={origin}
              preview
              onOpen={() =>
                router.push({ pathname: '/pin/[id]', params: { id: selectedPin.id } })
              }
            />
          </View>
        ) : mode === 'bounty' && selectedBounty ? (
          <View
            style={styles.detail}
            onLayout={(event) => setDetailHeight(event.nativeEvent.layout.height)}>
            <Pressable style={styles.backRow} onPress={() => setSelectedId(null)} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.textSub} />
              <Text style={styles.backText}>一覧へ</Text>
            </Pressable>
            {error ? <Text style={styles.applyError}>{error}</Text> : null}
            <BountyCard
              bounty={selectedBounty}
              now={now}
              userId={userId}
              origin={origin}
              showApply={false}
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
            ListHeaderComponent={
              error ? <Text style={styles.applyError}>{error}</Text> : null
            }
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
                onOpen={() => select(item.id)}
              />
            )}
          />
        )}
      </SnapSheet>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgAlt },

    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    homeHeader: {
      backgroundColor: colors.bg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    homeHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: Spacing.md,
      paddingBottom: 8,
      paddingTop: 2,
    },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.pill,
      paddingHorizontal: 12,
      height: 36,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      fontFamily: Fonts.sans,
      padding: 0,
    },
    headerIcon: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noticeDot: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 15,
      height: 15,
      paddingHorizontal: 3,
      borderRadius: 8,
      backgroundColor: colors.urgent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noticeDotText: {
      fontSize: 9,
      fontWeight: '800',
      color: colors.onBrand,
      fontFamily: Fonts.sans,
    },
    topPad: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      gap: Spacing.sm,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

    modeSwitch: {
      flexDirection: 'row',
      backgroundColor: colors.bg,
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
    modeButtonActive: { backgroundColor: colors.money },
    modeButtonActiveSale: { backgroundColor: colors.brand },
    modeText: { fontSize: 13, fontWeight: '700', color: colors.textSub, fontFamily: Fonts.sans },
    modeTextActive: { color: colors.onBrand, fontWeight: '800' },

    balanceChip: {
      marginLeft: 'auto',
      backgroundColor: colors.bg,
      borderRadius: Radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
      shadowColor: '#0F172A',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    balanceText: { fontSize: 13, fontWeight: '800', color: colors.money, fontFamily: Fonts.sans },

    hintChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.warnSoft,
      borderRadius: Radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.warn,
    },
    hintText: { fontSize: 11, color: colors.warn, fontFamily: Fonts.sans },

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
      backgroundColor: colors.bg,
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
      backgroundColor: colors.bg,
      overflow: 'hidden',
      shadowColor: '#0F172A',
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    zoomButton: { height: 40, alignItems: 'center', justifyContent: 'center' },
    zoomDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: 8 },

    sheetHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: Spacing.lg,
    },
    sheetHeader: { flex: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: 2 },
    sheetHeaderTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textSub,
      fontFamily: Fonts.sans,
    },
    summaryMain: { fontSize: 16, color: colors.text, fontFamily: Fonts.sans },
    summaryStrong: { fontSize: 20, fontWeight: '800', color: colors.text },
    summarySub: { fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },

    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.money,
      borderRadius: Radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    newButtonText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.onBrand,
      fontFamily: Fonts.sans,
    },

    detail: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 13, fontWeight: '600', color: colors.textSub, fontFamily: Fonts.sans },

    listContent: { padding: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: 40 },
    applyError: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.danger,
      marginBottom: Spacing.sm,
      fontFamily: Fonts.sans,
    },
  });
}
