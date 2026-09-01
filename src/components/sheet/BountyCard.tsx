import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
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
import { useColors } from '@/hooks/use-colors';

import { PriceNegotiation } from '../PriceNegotiation';
import { Button, Card, Pill } from '../ui';

export function BountyCard({
  bounty,
  now,
  userId,
  origin,
  onApply,
  onOpen,
  /**
   * 一覧では畳んで件数だけ出し、1件を選んで見ているときは中身まで出す。
   * 質問の答えは「行くかどうか」を決める材料なので、決める場所に置く。
   */
  showQuestions = false,
  /**
   * 地図上のプレビューでは「向かう」を出さない。
   * ボタンと値下げがシートを占めて地図が見えなくなるため、詳細画面へ送る。
   */
  showApply = true,
}: {
  bounty: BountyView;
  now: number;
  userId: string;
  origin: LatLng;
  onApply: () => void;
  onOpen: () => void;
  showQuestions?: boolean;
  showApply?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        <Ionicons name="locate-outline" size={13} color={colors.textFaint} />
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
        {/* 何人が、どこから向かっているか。人数だけだと 5km先の3人と 100m先の1人が同じに見える */}
        <Pill tone={bounty.headingCount >= 3 ? 'warn' : 'neutral'}>
          向かっている {bounty.headingCount}人
          {bounty.nearestHeadingM === null
            ? ''
            : `・最短 ${formatDistance(bounty.nearestHeadingM)}`}
        </Pill>
        {bounty.reportedCount > 0 ? <Pill tone="money">報告 {bounty.reportedCount}件</Pill> : null}
        {open ? <Pill tone="neutral">採用枠 {bountyRemainingSlots(bounty)}</Pill> : null}
        {!showQuestions && bounty.questions.length ? (
          <Pill tone={bounty.openQuestionCount > 0 ? 'warn' : 'neutral'}>
            コメント {bounty.questions.length}件
          </Pill>
        ) : null}
      </View>

      {/* 条件の追記は、依頼文だけでは分からないところを埋める。開く前に読めたほうがいい */}
      {showQuestions && (bounty.placeHint || bounty.photoWanted || !bounty.payIfAbsent) ? (
        <View style={styles.terms}>
          {bounty.placeHint ? <Term label="対象" value={bounty.placeHint} /> : null}
          {bounty.photoWanted ? <Term label="欲しい写真" value={bounty.photoWanted} /> : null}
          {!bounty.payIfAbsent ? (
            <Term label="無かった場合" value="有った場合のみ報酬" tone={colors.warn} />
          ) : null}
        </View>
      ) : null}

      {showQuestions && bounty.questions.length ? (
        <View style={styles.qa}>
          {bounty.questions.slice(0, 3).map((q) => (
            <View key={q.id} style={styles.qaItem}>
              <Text style={styles.qaQuestion} numberOfLines={2}>
                Q. {q.body}
              </Text>
              {q.answer ? (
                <Text style={styles.qaAnswer} numberOfLines={3}>
                  A. {q.answer}
                </Text>
              ) : (
                <Text style={styles.qaWaiting}>依頼者の回答待ち</Text>
              )}
            </View>
          ))}
          {bounty.questions.length > 3 ? (
            <Text style={styles.qaMore}>ほか{bounty.questions.length - 3}件</Text>
          ) : null}
        </View>
      ) : null}

      {showApply && mine ? (
        <Text style={styles.note}>
          {bounty.reportedCount > 0
            ? '報告が届いています。開いて採用を決められます'
            : `報酬 ${formatYen(bounty.reward * bounty.acceptCount)} を預けています。未採用分は期限で戻ります`}
        </Text>
      ) : showApply && myStatus === 'heading' ? (
        <Button label="報告する" variant="secondary" onPress={onOpen} />
      ) : showApply && myStatus === 'reported' ? (
        <Text style={styles.note}>報告済み。依頼者の確認待ちです</Text>
      ) : showApply && myStatus === 'accepted' ? (
        <Text style={[styles.note, { color: colors.money }]}>
          採用されました。報酬が残高に入っています
        </Text>
      ) : showApply && applicable ? (
        <Button
          label="向かう"
          onPress={onApply}
          hint={`いまいる場所（${formatDistance(distance)}）が記録されます`}
        />
      ) : !showApply ? (
        <Text style={styles.note}>タップして詳細を見る</Text>
      ) : null}

      {showApply ? (
        <PriceNegotiation
          targetKind="bounty"
          targetId={bounty.id}
          amount={bounty.reward}
          ownerId={bounty.requesterId}
          summary={bounty.asks}
          closed={!open}
        />
      ) : null}
    </Card>
  );
}

function Term({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{label}</Text>
      <Text style={[styles.termValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { gap: Spacing.sm, padding: Spacing.md },
    cardClosed: { opacity: 0.6 },

    head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    target: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      lineHeight: 22,
      fontFamily: Fonts.sans,
    },
    rewardBox: { alignItems: 'flex-end' },
    reward: { fontSize: 20, fontWeight: '800', color: colors.money, fontFamily: Fonts.sans },
    rewardSub: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },

    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    place: { flex: 1, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
    distance: { fontSize: 12, fontWeight: '700', color: colors.textFaint, fontFamily: Fonts.sans },

    badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    note: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },

    terms: { backgroundColor: colors.bgAlt, borderRadius: Radius.md, padding: Spacing.sm, gap: 3 },
    termRow: { flexDirection: 'row', gap: Spacing.sm },
    termLabel: { width: 74, fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
    termValue: {
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 18,
      fontFamily: Fonts.sans,
    },

    qa: {
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: Spacing.sm,
    },
    qaItem: { gap: 2 },
    qaQuestion: { fontSize: 12, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    qaAnswer: { fontSize: 12, color: colors.money, lineHeight: 18, fontFamily: Fonts.sans },
    qaWaiting: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },
    qaMore: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },
  });
}
