import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  bountyRemainingSlots,
  canApply,
  distanceM,
  formatDistance,
  formatRemaining,
  formatYen,
  isBountyOpen,
} from '@/domain/rules';
import type { BountyView, LatLng } from '@/domain/types';

import { PriceNegotiation } from '../PriceNegotiation';
import { Button, Card, Pill } from '../ui';

export function BountyCard({
  bounty,
  now,
  userId,
  origin,
  onApply,
  onOpen,
}: {
  bounty: BountyView;
  now: number;
  userId: string;
  origin: LatLng;
  onApply: () => void;
  onOpen: () => void;
}) {
  const open = isBountyOpen(bounty, now);
  const mine = bounty.requesterId === userId;
  const distance = distanceM(origin, { lat: bounty.lat, lng: bounty.lng });
  const applicable = canApply(bounty, bounty.myApplication, userId, now);
  const myStatus = bounty.myApplication?.status ?? null;

  return (
    <Card style={[styles.card, !open && styles.cardClosed]} onPress={onOpen}>
      <View style={styles.head}>
        <Text style={styles.target} numberOfLines={3}>
          {bounty.targetText}
        </Text>
        <View style={styles.rewardBox}>
          <Text style={styles.reward}>{formatYen(bounty.reward)}</Text>
          {bounty.acceptCount > 1 ? (
            <Text style={styles.rewardSub}>×{bounty.acceptCount}人</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.placeRow}>
        <Ionicons name="locate-outline" size={13} color={Colors.textFaint} />
        <Text style={styles.place} numberOfLines={1}>
          {bounty.areaLabel}・半径{bounty.radiusM}m
        </Text>
        <Text style={styles.distance}>{formatDistance(distance)}</Text>
      </View>

      <View style={styles.badges}>
        {open ? (
          <Pill tone="brand">残り{formatRemaining(bounty.expiresAt - now)}</Pill>
        ) : (
          <Pill tone="dead">
            {bounty.status === 'filled'
              ? '成立済み'
              : bounty.status === 'cancelled'
                ? '取り下げ'
                : '期限切れ'}
          </Pill>
        )}
        {/* 何人が同じ報酬に向かっているかを応募前に見せて、殺到を抑える */}
        <Pill tone={bounty.headingCount >= 3 ? 'warn' : 'neutral'}>
          向かっている {bounty.headingCount}人
        </Pill>
        {bounty.reportedCount > 0 ? <Pill tone="money">報告 {bounty.reportedCount}件</Pill> : null}
        {open ? <Pill tone="neutral">採用枠 {bountyRemainingSlots(bounty)}</Pill> : null}
      </View>

      {mine ? (
        <Text style={styles.note}>
          {bounty.reportedCount > 0
            ? '報告が届いています。開いて採用を決められます'
            : `報酬 ${formatYen(bounty.reward * bounty.acceptCount)} を預けています。未採用分は期限で戻ります`}
        </Text>
      ) : myStatus === 'heading' ? (
        <Button label="報告する" variant="secondary" onPress={onOpen} />
      ) : myStatus === 'reported' ? (
        <Text style={styles.note}>報告済み。依頼者の確認待ちです</Text>
      ) : myStatus === 'accepted' ? (
        <Text style={[styles.note, { color: Colors.money }]}>
          採用されました。報酬が残高に入っています
        </Text>
      ) : applicable ? (
        <Button label="向かう" onPress={onApply} hint="応募すると、向かっている人数に反映されます" />
      ) : null}

      <PriceNegotiation
        targetKind="bounty"
        targetId={bounty.id}
        amount={bounty.reward}
        ownerId={bounty.requesterId}
        summary={bounty.asks}
        closed={!open}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, padding: Spacing.md },
  cardClosed: { opacity: 0.6 },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  target: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    lineHeight: 22,
    fontFamily: Fonts.sans,
  },
  rewardBox: { alignItems: 'flex-end' },
  reward: { fontSize: 20, fontWeight: '800', color: Colors.money, fontFamily: Fonts.sans },
  rewardSub: { fontSize: 11, color: Colors.textSub, fontFamily: Fonts.sans },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  distance: { fontSize: 12, fontWeight: '700', color: Colors.textFaint, fontFamily: Fonts.sans },

  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  note: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
});
