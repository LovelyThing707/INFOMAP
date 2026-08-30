import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PinCard } from '@/components/sheet/PinCard';
import { Avatar, ScoreBadge } from '@/components/badges';
import { Banner, Button, Card, EmptyState, SectionTitle } from '@/components/ui';
import { Colors, Fonts, MAX_CONTENT_WIDTH, Spacing } from '@/constants/theme';
import { isRestricted } from '@/domain/rules';
import type { UserProfileView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { closeModal } from '@/lib/navigation';
import { repo, useSession } from '@/state/session';

/**
 * 他人のプロフィール。当たり率だけでは「たまたま1件当てた人」と区別がつかないので、
 * 判定件数と、いま出している情報を並べて、買う前に確かめられるようにする。
 * 残高や購入履歴は出さない。
 */
export default function UserModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const location = useUserLocation();
  const now = useNow(5000);

  const { value: profile } = useAsync<UserProfileView | null>(
    () => (id ? repo.getUserProfile(id, nowMs()) : Promise.resolve(null)),
    [id, revision],
    null
  );

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>この利用者は見つかりません</Text>
      </View>
    );
  }

  const restricted = isRestricted(profile, now);
  const isMe = profile.id === meId;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Card style={styles.headCard}>
        <View style={styles.headRow}>
          <Avatar emoji={profile.emoji} size={48} />
          <View style={styles.headText}>
            <Text style={styles.handle}>
              {profile.handle}
              {isMe ? '（あなた）' : ''}
            </Text>
            <ScoreBadge score={profile.score} deals={profile.hitCount + profile.missCount} />
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="当たり" value={`${profile.hitCount}`} tone={Colors.money} />
          <Stat label="外れ" value={`${profile.missCount}`} tone={Colors.danger} />
          <Stat label="出した数" value={`${profile.listingCount}`} />
          <Stat label="売れた数" value={`${profile.soldCount}`} />
        </View>

        {profile.acceptedReportCount > 0 ? (
          <View style={styles.badgeRow}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.money} />
            <Text style={styles.badgeText}>
              依頼の報告が {profile.acceptedReportCount}件 採用されています
            </Text>
          </View>
        ) : null}
      </Card>

      {restricted && profile.restrictedUntil ? (
        <Banner
          tone="danger"
          icon="alert-circle"
          title="いま出品を止められています"
          body={`外れの申告が続いたため、${new Date(profile.restrictedUntil).toLocaleString('ja-JP')}まで新しく出せません`}
        />
      ) : null}

      {profile.score === null ? (
        <Banner
          tone="warn"
          icon="help-circle"
          title="まだ判定の実績がありません"
          body="当たり外れの申告が集まるまでは、この人の精度はわかりません"
        />
      ) : null}

      <View>
        <SectionTitle>いま出している情報（{profile.activePins.length}）</SectionTitle>
        {profile.activePins.length === 0 ? (
          <EmptyState title="いま出している情報はありません" />
        ) : (
          <View style={styles.pinList}>
            {profile.activePins.map((pin) => (
              <PinCard
                key={pin.id}
                pin={pin}
                now={now}
                origin={location.effective}
                onPress={() => router.push({ pathname: '/pin/[id]', params: { id: pin.id } })}
              />
            ))}
          </View>
        )}
      </View>

      <Button label="閉じる" variant="ghost" onPress={() => closeModal('/')} />
    </ScrollView>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.lg,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headCard: { gap: Spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headText: { gap: 5 },
  handle: { fontSize: 19, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },

  stats: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  statLabel: { fontSize: 11, color: Colors.textSub, fontFamily: Fonts.sans },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  badgeText: { fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },

  pinList: { gap: Spacing.sm },
  muted: { fontSize: 13, color: Colors.textSub, fontFamily: Fonts.sans },
});
