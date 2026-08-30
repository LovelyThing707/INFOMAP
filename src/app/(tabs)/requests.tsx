import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { BountyCard } from '@/components/sheet/BountyCard';
import { EmptyState, Segmented } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { isBountyOpen } from '@/domain/rules';
import type { BountyView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

type Side = 'near' | 'mine';

export default function RequestsScreen() {
  const userId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const now = useNow(1000);
  const location = useUserLocation();
  const [side, setSide] = useState<Side>('near');

  const { value: bounties } = useAsync<BountyView[]>(
    () => repo.listBounties({ viewerId: userId, now: nowMs(), origin: location.effective }),
    [userId, revision],
    []
  );

  const near = useMemo(() => bounties.filter((b) => b.requesterId !== userId), [bounties, userId]);
  const mine = useMemo(() => bounties.filter((b) => b.requesterId === userId), [bounties, userId]);

  const apply = async (bountyId: string) => {
    await repo.applyToBounty(bountyId, userId, nowMs());
    await bump();
  };

  const list = side === 'near' ? near : mine;

  return (
    <Screen
      title="リクエスト"
      subtitle="欲しい人が先に報酬を置いて、現場にいる人に確かめてもらう"
      scroll={false}
      right={
        <Pressable style={styles.newButton} onPress={() => router.push('/request-new')}>
          <Ionicons name="add" size={17} color="#fff" />
          <Text style={styles.newButtonText}>依頼</Text>
        </Pressable>
      }>
      <Segmented<Side>
        options={[
          { id: 'near', label: '近くの依頼', count: near.filter((b) => isBountyOpen(b, now)).length },
          { id: 'mine', label: '自分の依頼', count: mine.length },
        ]}
        value={side}
        onChange={setSide}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {list.length === 0 ? (
          <EmptyState
            title={side === 'near' ? '近くに依頼はありません' : 'まだ依頼を出していません'}
            body={
              side === 'near'
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
              origin={location.effective}
              onApply={() => apply(bounty.id)}
              onOpen={() => router.push({ pathname: '/request/[id]', params: { id: bounty.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.brand,
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  newButtonText: { fontSize: 13, fontWeight: '800', color: '#fff', fontFamily: Fonts.sans },
  list: { flex: 1 },
  listContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
});
