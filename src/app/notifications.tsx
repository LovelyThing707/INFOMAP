import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from '@/components/AuthGate';
import { EmptyState } from '@/components/ui';
import { Fonts, MAX_CONTENT_WIDTH, Spacing, type ThemeColors } from '@/constants/theme';
import type { SellerPinView } from '@/data/repository';
import { formatYen } from '@/domain/rules';
import type { BountyView, RevealedPin } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

type Notice = {
  id: string;
  title: string;
  body: string;
  onPress: () => void;
};

export default function NotificationsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = useSession((s) => s.userId);
  const signedIn = useSession((s) => s.signedIn);
  const revision = useSession((s) => s.revision);

  const { value: bought } = useAsync<RevealedPin[]>(
    () => (signedIn ? repo.listMyPurchases(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: sold } = useAsync<SellerPinView[]>(
    () => (signedIn ? repo.listMyPins(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: bounties } = useAsync<BountyView[]>(
    () => repo.listBounties({ viewerId: userId, now: nowMs() }),
    [userId, revision],
    []
  );

  const notices: Notice[] = [];

  for (const pin of bought) {
    if (pin.purchase.escrow !== 'held') continue;
    notices.push({
      id: `buy-${pin.purchase.id}`,
      title: '現地の申告がまだです',
      body: `${pin.headline}（${formatYen(pin.purchase.price)}）`,
      onPress: () => router.replace('/(tabs)/deals'),
    });
  }

  for (const item of sold) {
    const held = item.purchases.filter((purchase) => purchase.escrow === 'held').length;
    if (held === 0) continue;
    notices.push({
      id: `sell-${item.pin.id}`,
      title: '売れて、買い手の申告待ちです',
      body: `${item.pin.headline}・${held}件`,
      onPress: () => router.replace('/(tabs)/deals'),
    });
  }

  for (const bounty of bounties) {
    if (bounty.requesterId === userId && bounty.reportedCount > 0) {
      notices.push({
        id: `report-${bounty.id}`,
        title: '報告が届いています',
        body: bounty.targetText,
        onPress: () => router.push({ pathname: '/request/[id]', params: { id: bounty.id } }),
      });
    }
    if (bounty.myApplication?.status === 'heading') {
      notices.push({
        id: `head-${bounty.id}`,
        title: '向かっている依頼があります',
        body: bounty.targetText,
        onPress: () => router.push({ pathname: '/request/[id]', params: { id: bounty.id } }),
      });
    }
    if (bounty.myApplication?.status === 'reported') {
      notices.push({
        id: `mine-${bounty.id}`,
        title: '報告の採用待ちです',
        body: bounty.targetText,
        onPress: () => router.push({ pathname: '/request/[id]', params: { id: bounty.id } }),
      });
    }
  }

  if (!signedIn) {
    return (
      <AuthGate title="通知" body="取引や応募の動きを見るには、ログインが必要です" />
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {notices.length === 0 ? (
        <EmptyState title="いま動いている通知はありません" body="買う・売る・向かうと、ここに届きます" />
      ) : (
        notices.map((notice) => (
          <Pressable
            key={notice.id}
            onPress={notice.onPress}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.icon}>
              <Ionicons name="notifications" size={16} color={colors.brand} />
            </View>
            <View style={styles.text}>
              <Text style={styles.title}>{notice.title}</Text>
              <Text style={styles.body} numberOfLines={2}>
                {notice.body}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      padding: Spacing.lg,
      paddingBottom: 48,
      gap: Spacing.sm,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.bgAlt,
      borderRadius: 14,
      padding: Spacing.md,
    },
    rowPressed: { opacity: 0.7 },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { flex: 1, gap: 2 },
    title: { fontSize: 14, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    body: { fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
  });
}
