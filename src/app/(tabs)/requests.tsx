import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import {
  amountOptions,
  boolFilter,
  distanceOptions,
  FilterBar,
  minuteOptions,
  numberFilter,
  stringFilter,
  type FilterDef,
  type FilterValues,
} from '@/components/FilterBar';
import { Screen } from '@/components/Screen';
import { BountyCard } from '@/components/sheet/BountyCard';
import { EmptyState, Segmented } from '@/components/ui';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import type { ApplyFailure } from '@/data/repository';
import { distanceM, isBountyOpen, MAX_ACTIVE_CLAIMS } from '@/domain/rules';
import type { BountyView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { requireSignedIn } from '@/lib/auth-gate';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

type Side = 'near' | 'mine';
type SortId = 'near' | 'reward' | 'deadline' | 'new';

const REWARD_STEPS = [100, 200, 300, 500, 1000];
const MINUTE_STEPS = [10, 30, 60, 120];
const DISTANCE_STEPS = [300, 600, 1000, 2000];

const NEAR_FILTERS: FilterDef[] = [
  // いま応募できるものを探しに来る画面なので、締め切られたものは既定で伏せる
  { kind: 'toggle', id: 'openOnly', label: '募集中' },
  { kind: 'choice', id: 'minReward', label: '報酬', options: amountOptions(REWARD_STEPS, 'min') },
  { kind: 'choice', id: 'withinMin', label: '残り時間', options: minuteOptions(MINUTE_STEPS) },
  { kind: 'choice', id: 'withinM', label: '距離', options: distanceOptions(DISTANCE_STEPS) },
  { kind: 'toggle', id: 'noRivals', label: '誰も向かっていない' },
  { kind: 'toggle', id: 'notApplied', label: '未応募' },
  {
    kind: 'choice',
    id: 'sort',
    label: '並び替え',
    clearable: false,
    options: [
      { value: 'near', label: '近い順' },
      { value: 'reward', label: '報酬が高い順' },
      { value: 'deadline', label: '締切が近い順' },
    ],
  },
];

const MINE_FILTERS: FilterDef[] = [
  { kind: 'toggle', id: 'openOnly', label: '募集中' },
  { kind: 'toggle', id: 'reported', label: '報告が届いている' },
  {
    kind: 'choice',
    id: 'sort',
    label: '並び替え',
    clearable: false,
    options: [
      { value: 'new', label: '新しい順' },
      { value: 'deadline', label: '締切が近い順' },
      { value: 'reward', label: '報酬が高い順' },
    ],
  },
];

const APPLY_ERROR: Record<ApplyFailure, string> = {
  not_found: 'この依頼は見つかりませんでした',
  closed: 'もう締め切られています',
  own_bounty: '自分の依頼には応募できません',
  duplicate: 'すでに応募しています',
  too_many: `同時に応募できるのは${MAX_ACTIVE_CLAIMS}件までです`,
};

const DEFAULTS: Record<Side, FilterValues> = {
  near: { openOnly: true, sort: 'near' },
  mine: { openOnly: true, sort: 'new' },
};

export default function RequestsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const now = useNow(1000);
  const location = useUserLocation();
  const [side, setSide] = useState<Side>('near');
  const [filters, setFilters] = useState<FilterValues>(DEFAULTS.near);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { value: bounties } = useAsync<BountyView[]>(
    () => repo.listBounties({ viewerId: userId, now: nowMs(), origin: location.effective }),
    [userId, revision],
    []
  );

  const near = useMemo(() => bounties.filter((b) => b.requesterId !== userId), [bounties, userId]);
  const mine = useMemo(() => bounties.filter((b) => b.requesterId === userId), [bounties, userId]);

  const origin = location.effective;
  const minReward = numberFilter(filters, 'minReward');
  const withinMin = numberFilter(filters, 'withinMin');
  const withinM = numberFilter(filters, 'withinM');
  const sort = stringFilter<SortId>(filters, 'sort', side === 'near' ? 'near' : 'new');

  const list = useMemo(() => {
    const source = side === 'near' ? near : mine;
    const filtered = source.filter((bounty) => {
      const open = isBountyOpen(bounty, now);
      if (boolFilter(filters, 'openOnly') && !open) return false;
      if (minReward !== null && bounty.reward < minReward) return false;
      if (withinMin !== null && bounty.expiresAt - now > withinMin * 60 * 1000) return false;
      if (withinM !== null && distanceM(origin, { lat: bounty.lat, lng: bounty.lng }) > withinM) {
        return false;
      }
      if (boolFilter(filters, 'noRivals') && bounty.headingCount > 0) return false;
      if (boolFilter(filters, 'notApplied') && bounty.myApplication !== null) return false;
      if (boolFilter(filters, 'reported') && bounty.reportedCount === 0) return false;
      return true;
    });

    // 締め切られたものは、並び順にかかわらず後ろにまとめる
    return filtered.sort((a, b) => {
      const closed = Number(!isBountyOpen(a, now)) - Number(!isBountyOpen(b, now));
      if (closed !== 0) return closed;
      if (sort === 'reward') return b.reward - a.reward;
      if (sort === 'deadline') return a.expiresAt - b.expiresAt;
      if (sort === 'new') return b.createdAt - a.createdAt;
      return (
        distanceM(origin, { lat: a.lat, lng: a.lng }) -
        distanceM(origin, { lat: b.lat, lng: b.lng })
      );
    });
  }, [side, near, mine, filters, now, minReward, withinMin, withinM, sort, origin]);

  const switchSide = (next: Side) => {
    setSide(next);
    setFilters(DEFAULTS[next]);
  };

  const apply = async (bountyId: string) => {
    if (!requireSignedIn()) return;
    const bounty = bounties.find((b) => b.id === bountyId);
    if (!bounty) return;
    // 座標は渡さない。押した地点から依頼中心までの距離だけを残す
    const away = distanceM(origin, { lat: bounty.lat, lng: bounty.lng });
    const result = await repo.applyToBounty(bountyId, userId, away, nowMs());
    setApplyError(result.ok ? null : APPLY_ERROR[result.reason]);
    await bump();
  };

  const source = side === 'near' ? near : mine;
  const narrowed = list.length !== source.length;

  return (
    <Screen
      title="リクエスト"
      subtitle="欲しい人が先に報酬を置いて、現場にいる人に確かめてもらう"
      scroll={false}
      right={
        <Pressable
          style={styles.newButton}
          onPress={() => {
            if (!requireSignedIn()) return;
            router.push('/request-new');
          }}>
          <Ionicons name="add" size={17} color={colors.onBrand} />
          <Text style={styles.newButtonText}>依頼</Text>
        </Pressable>
      }>
      <Segmented<Side>
        options={[
          { id: 'near', label: '近くの依頼', count: near.filter((b) => isBountyOpen(b, now)).length },
          { id: 'mine', label: '自分の依頼', count: mine.length },
        ]}
        value={side}
        onChange={switchSide}
      />

      <FilterBar
        filters={side === 'near' ? NEAR_FILTERS : MINE_FILTERS}
        values={filters}
        onChange={(id, value) => setFilters((current) => ({ ...current, [id]: value }))}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {applyError ? <Text style={styles.applyError}>{applyError}</Text> : null}

        {narrowed ? (
          <Text style={styles.count}>
            {source.length}件中 {list.length}件
          </Text>
        ) : null}

        {list.length === 0 ? (
          <EmptyState
            title={
              narrowed
                ? '条件に合う依頼がありません'
                : side === 'near'
                  ? '近くに依頼はありません'
                  : 'まだ依頼を出していません'
            }
            body={
              narrowed
                ? '絞り込みを緩めてみてください'
                : side === 'near'
                  ? '誰かが報酬を置くとここに並びます。向かっている人数も見えるので、無駄足を避けられます'
                  : '自分では行けない場所の状態を、報酬を置いて確かめてもらえます'
            }
          />
        ) : (
          list.map((bounty) => (
            <BountyCard
              key={bounty.id}
              bounty={bounty}
              now={now}
              userId={userId}
              origin={origin}
              onApply={() => apply(bounty.id)}
              onOpen={() => router.push({ pathname: '/request/[id]', params: { id: bounty.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.brand,
      borderRadius: Radius.pill,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    newButtonText: { fontSize: 13, fontWeight: '800', color: colors.onBrand, fontFamily: Fonts.sans },
    list: { flex: 1 },
    listContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
    count: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },
    applyError: { fontSize: 12, fontWeight: '700', color: colors.danger, fontFamily: Fonts.sans },
  });
}
