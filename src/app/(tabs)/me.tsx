import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Avatar, ScoreBadge } from '@/components/badges';
import { Banner, Button, Card, Divider, Input, SectionTitle } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { LEDGER_LABELS } from '@/data/ledger';
import { FORBIDDEN_RULES } from '@/domain/catalog';
import {
  formatClock,
  formatYen,
  isRestricted,
  judgedCount,
  RESTRICT_MIN_JUDGED,
  RESTRICT_MISS_RATE,
  sellerScore,
} from '@/domain/rules';
import type { PayoutRequest, WalletEntry } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

export default function MeScreen() {
  const userId = useSession((s) => s.userId);
  const users = useSession((s) => s.users);
  const me = useSession((s) => s.me);
  const balance = useSession((s) => s.balance);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const switchUser = useSession((s) => s.switchUser);
  const resetAll = useSession((s) => s.resetAll);
  const now = useNow(30000);

  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutError, setPayoutError] = useState<string | null>(null);

  const { value: entries } = useAsync<WalletEntry[]>(
    () => repo.listWalletEntries(userId),
    [userId, revision],
    []
  );
  const { value: payouts } = useAsync<PayoutRequest[]>(
    () => repo.listPayouts(userId),
    [userId, revision],
    []
  );

  const score = me ? sellerScore(me.hitCount, me.missCount) : null;
  const judged = me ? judgedCount(me) : 0;
  const restricted = me ? isRestricted(me, now) : false;

  const requestPayout = async () => {
    const amount = Number(payoutAmount.replace(/[^0-9]/g, ''));
    setPayoutError(null);
    const result = await repo.requestPayout(userId, amount, nowMs());
    if (!result.ok) {
      setPayoutError(
        result.reason === 'insufficient_balance' ? '残高が足りません' : '金額が不正です'
      );
      return;
    }
    setPayoutAmount('');
    await bump();
  };

  return (
    <Screen title="マイページ" subtitle="お金と信用">
      <Card style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <View style={styles.balanceItem}>
            <Text style={styles.balanceLabel}>出金できる</Text>
            <Text style={[styles.balanceValue, { color: Colors.money }]}>
              {formatYen(balance.available)}
            </Text>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceItem}>
            <Text style={styles.balanceLabel}>預かり中</Text>
            <Text style={styles.balanceValue}>{formatYen(balance.pending)}</Text>
          </View>
        </View>
        <Text style={styles.balanceNote}>
          預かり中は、買い手の判定待ちの売上と、まだ採用が決まっていない依頼の報酬です。確定するまでは出金できません
        </Text>
      </Card>

      <View>
        <SectionTitle>出金</SectionTitle>
        <Card style={styles.card}>
          <Text style={styles.body}>
            申請は週次でまとめて処理します。ここでは残高から引くところまでを再現しています
          </Text>
          <View style={styles.payoutRow}>
            <Input
              value={payoutAmount}
              onChangeText={setPayoutAmount}
              placeholder="金額"
              keyboardType="number-pad"
              style={styles.payoutInput}
            />
            <Button
              label="申請"
              onPress={requestPayout}
              disabled={!payoutAmount}
              style={styles.payoutButton}
            />
          </View>
          {payoutError ? <Text style={styles.errorText}>{payoutError}</Text> : null}
          {payouts.map((payout) => (
            <View key={payout.id} style={styles.payoutItem}>
              <Text style={styles.body}>{formatYen(payout.amount)}</Text>
              <Text style={styles.muted}>
                {new Date(payout.createdAt).toLocaleDateString('ja-JP')}・受付済み
              </Text>
            </View>
          ))}
        </Card>
      </View>

      <View>
        <SectionTitle>出品者としての信用</SectionTitle>
        <Card style={styles.card}>
          <View style={styles.scoreRow}>
            <Avatar emoji={me?.emoji ?? '❔'} size={40} />
            <View style={styles.scoreText}>
              <Text style={styles.handle}>{me?.handle}</Text>
              <ScoreBadge score={score} deals={judged} />
            </View>
          </View>
          <Divider />
          <Text style={styles.body}>
            当たり {me?.hitCount ?? 0}件・外れ {me?.missCount ?? 0}件
          </Text>
          {restricted && me?.restrictedUntil ? (
            <Banner
              tone="danger"
              icon="alert-circle"
              title="いま出品できません"
              body={`外れの割合が${Math.round(RESTRICT_MISS_RATE * 100)}%を超えたため、${new Date(
                me.restrictedUntil
              ).toLocaleString('ja-JP')}まで出品を止めています。解除後、当たりの申告が増えれば再び制限はかかりません`}
            />
          ) : (
            <Text style={styles.muted}>
              判定が{RESTRICT_MIN_JUDGED}件を超えたあと、外れが
              {Math.round(RESTRICT_MISS_RATE * 100)}%以上になると24時間出品できなくなります
            </Text>
          )}
        </Card>
      </View>

      <View>
        <SectionTitle>入出金の履歴</SectionTitle>
        <Card style={styles.card}>
          {entries.length === 0 ? (
            <Text style={styles.muted}>まだ記録がありません</Text>
          ) : (
            entries.slice(0, 40).map((entry) => (
              <View key={entry.id} style={styles.entry}>
                <View style={styles.entryLeft}>
                  <Text style={styles.entryKind}>{LEDGER_LABELS[entry.kind]}</Text>
                  <Text style={styles.entryMemo} numberOfLines={1}>
                    {entry.memo}
                  </Text>
                </View>
                <View style={styles.entryRight}>
                  {entry.availableDelta !== 0 ? (
                    <Text
                      style={[
                        styles.entryAmount,
                        { color: entry.availableDelta > 0 ? Colors.money : Colors.text },
                      ]}>
                      {entry.availableDelta > 0 ? '+' : ''}
                      {formatYen(entry.availableDelta)}
                    </Text>
                  ) : null}
                  {entry.pendingDelta !== 0 ? (
                    <Text style={styles.entryPending}>
                      預かり {entry.pendingDelta > 0 ? '+' : ''}
                      {formatYen(entry.pendingDelta)}
                    </Text>
                  ) : null}
                  <Text style={styles.entryTime}>{formatClock(entry.createdAt)}</Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionTitle>扱わない情報</SectionTitle>
        <Card style={styles.card}>
          {FORBIDDEN_RULES.map((rule) => (
            <View key={rule} style={styles.ruleItem}>
              <Ionicons name="close-circle" size={14} color={Colors.textFaint} />
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
          <Text style={styles.muted}>
            見つけたらピンの詳細から通報してください。運営が無効化した出品は、未確定の代金が買い手へ戻ります
          </Text>
        </Card>
      </View>

      <View>
        <SectionTitle>動作確認用</SectionTitle>
        <Card style={styles.card}>
          <Text style={styles.muted}>
            売り手と買い手、依頼者と報告者の往復を1台で試すためのユーザー切替です
          </Text>
          <View style={styles.userGrid}>
            {users.map((user) => {
              const active = user.id === userId;
              return (
                <Pressable
                  key={user.id}
                  onPress={() => switchUser(user.id)}
                  style={[styles.userChip, active && styles.userChipActive]}>
                  <Text style={styles.userEmoji}>{user.emoji}</Text>
                  <Text style={[styles.userName, active && styles.userNameActive]}>
                    {user.handle}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button label="データを初期状態に戻す" variant="danger" onPress={() => resetAll()} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { gap: Spacing.md },
  balanceRow: { flexDirection: 'row', alignItems: 'center' },
  balanceItem: { flex: 1, gap: 2 },
  balanceDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  balanceLabel: { fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  balanceValue: { fontSize: 24, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  balanceNote: { fontSize: 11, color: Colors.textFaint, lineHeight: 17, fontFamily: Fonts.sans },

  card: { gap: Spacing.md, padding: Spacing.md },
  body: { fontSize: 13, color: Colors.text, lineHeight: 20, fontFamily: Fonts.sans },
  muted: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
  errorText: { fontSize: 12, color: Colors.danger, fontWeight: '600', fontFamily: Fonts.sans },

  payoutRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  payoutInput: { flex: 1 },
  payoutButton: { minWidth: 88 },
  payoutItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },

  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  scoreText: { gap: 4 },
  handle: { fontSize: 16, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },

  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  entryLeft: { flex: 1, gap: 1 },
  entryKind: { fontSize: 13, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  entryMemo: { fontSize: 11, color: Colors.textSub, fontFamily: Fonts.sans },
  entryRight: { alignItems: 'flex-end' },
  entryAmount: { fontSize: 14, fontWeight: '800', fontFamily: Fonts.sans },
  entryPending: { fontSize: 11, color: Colors.warn, fontWeight: '600', fontFamily: Fonts.sans },
  entryTime: { fontSize: 10, color: Colors.textFaint, fontFamily: Fonts.sans },

  ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleText: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },

  userGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  userChipActive: { borderColor: Colors.brand, backgroundColor: Colors.brandSoft },
  userEmoji: { fontSize: 15 },
  userName: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
  userNameActive: { color: Colors.brand, fontWeight: '800' },
});
