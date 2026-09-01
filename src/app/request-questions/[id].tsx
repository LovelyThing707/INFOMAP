import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BountyQuestions } from '@/components/bounty/BountyQuestions';
import { Button } from '@/components/ui';
import { Fonts, MAX_CONTENT_WIDTH, Spacing, type ThemeColors } from '@/constants/theme';
import type { BountyView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useNow } from '@/hooks/use-now';
import { requireSignedIn } from '@/lib/auth-gate';
import { nowMs } from '@/lib/clock';
import { closeModal } from '@/lib/navigation';
import { repo, useSession } from '@/state/session';

export default function RequestQuestionsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const now = useNow(5000);

  const { value: bounty } = useAsync<BountyView | null>(
    () => (id ? repo.getBounty(id, userId, nowMs()) : Promise.resolve(null)),
    [id, userId, revision],
    null
  );

  if (!bounty) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>依頼が見つかりません</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.target} numberOfLines={2}>
        {bounty.targetText}
      </Text>
      <BountyQuestions
        bounty={bounty}
        now={now}
        userId={userId}
        isRequester={bounty.requesterId === userId}
        onAsk={async (body) => {
          if (!requireSignedIn()) return;
          await repo.askQuestion(bounty.id, body, userId, nowMs());
          await bump();
        }}
        onAnswer={async (questionId, text) => {
          await repo.answerQuestion(questionId, userId, text, nowMs());
          await bump();
        }}
      />
      <Button
        label="依頼に戻る"
        variant="ghost"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else closeModal({ pathname: '/request/[id]', params: { id: bounty.id } });
        }}
      />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      padding: Spacing.lg,
      paddingBottom: 48,
      gap: Spacing.md,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    target: { fontSize: 16, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    muted: { fontSize: 13, color: colors.textSub, fontFamily: Fonts.sans },
  });
}
