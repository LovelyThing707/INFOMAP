import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from '@/components/AuthGate';
import { Screen } from '@/components/Screen';
import { ThemePreferencePicker } from '@/components/ThemePreferencePicker';
import { Avatar, ScoreBadge } from '@/components/badges';
import { Banner, Button, Card, Divider, Input, SectionTitle } from '@/components/ui';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { LEDGER_LABELS } from '@/data/ledger';
import type { StorageUsage } from '@/data/repository';
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
import type { PayoutRequest, UserProfileView, WalletEntry } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

export default function MeScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = useSession((s) => s.userId);
  const signedIn = useSession((s) => s.signedIn);
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
    () => (signedIn ? repo.listWalletEntries(userId) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: payouts } = useAsync<PayoutRequest[]>(
    () => (signedIn ? repo.listPayouts(userId) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: profile } = useAsync<UserProfileView | null>(
    () => (signedIn ? repo.getUserProfile(userId, nowMs(), userId) : Promise.resolve(null)),
    [userId, revision, signedIn],
    null
  );
  const { value: usage } = useAsync<StorageUsage>(() => repo.storageUsage(), [revision], {
    recordBytes: 0,
    photoBytes: 0,
    pins: 0,
    bounties: 0,
    ledgerEntries: 0,
  });

  const hits = profile?.hitCount ?? me?.hitCount ?? 0;
  const misses = profile?.missCount ?? me?.missCount ?? 0;
  const gones = profile?.goneCount ?? me?.goneCount ?? 0;
  const score = sellerScore(hits, misses);
  const judged = judgedCount({ hitCount: hits, missCount: misses });
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

  if (!signedIn) {
    return (
      <AuthGate title="マイページ" body="残高と実績を見るには、ログインが必要です" />
    );
  }

  return (
    <Screen title="マイページ" subtitle="お金と信用">
      <ThemePreferencePicker />
      <Card style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <View style={styles.balanceItem}>
            <Text style={styles.balanceLabel}>出金できる</Text>
            <Text style={[styles.balanceValue, { color: colors.money }]}>
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
        {profile ? (
          <Text style={styles.balanceNote}>
            フォロワー {profile.followerCount}人・フォロー {profile.followingCount}人
          </Text>
        ) : null}
      </Card>

      <View>
        <SectionTitle>出金</SectionTitle>
        <Card style={styles.card}>
          <Text style={styles.body}>
            申請した額はすぐに残高から引き、出金として確定します
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
              label="出金する"
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
                {new Date(payout.createdAt).toLocaleDateString('ja-JP')}・出金済み
              </Text>
            </View>
          ))}
        </Card>
      </View>

      <View>
        <SectionTitle>出した情報の正確さ</SectionTitle>
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
            情報どおり {hits}件・違っていた {misses}件
          </Text>
          <Text style={styles.muted}>
            このほかに「着いたら無くなっていた」が {gones}件あります。
            返金はされますが、腐る情報では避けられないので記録には数えていません
          </Text>
          {restricted && me?.restrictedUntil ? (
            <Banner
              tone="danger"
              icon="alert-circle"
              title="いま出品できません"
              body={`情報が違っていたという申告が${Math.round(RESTRICT_MISS_RATE * 100)}%を超えたため、${new Date(
                me.restrictedUntil
              ).toLocaleString('ja-JP')}まで出品を止めています。解除後、情報どおりという申告が増えれば再び制限はかかりません`}
            />
          ) : (
            <Text style={styles.muted}>
              買い手からの申告が{RESTRICT_MIN_JUDGED}件を超えたあと、「違っていた」が
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
                        { color: entry.availableDelta > 0 ? colors.money : colors.text },
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
              <Ionicons name="close-circle" size={14} color={colors.textFaint} />
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
          <Text style={styles.muted}>
            見つけたらピンの詳細から通報してください。運営が無効化した出品は、未確定の代金が買い手へ戻ります
          </Text>
        </Card>
      </View>

      <View>
        <SectionTitle>位置情報の扱い</SectionTitle>
        <Card style={styles.card}>
          <Text style={styles.body}>
            使うのは次の3つの場面だけです。近くの情報を並べるとき、写真を撮ったとき、
            依頼に「向かう」を押したときです。
          </Text>
          <Text style={styles.muted}>
            撮影地点と応募地点は、受け取った時点で対象からの距離に変換して、
            緯度経度そのものは保存しません。他の利用者に渡るのも距離だけで、
            あなたがどこにいたかは分かりません。
          </Text>
          <Text style={styles.muted}>
            移動中の追跡はしていません。位置を読むのは上の3つの操作をした瞬間だけで、
            アプリを閉じている間は何も取得しません。
          </Text>
          <Text style={styles.muted}>
            端末が位置の偽装を申告した場合、その写真は「位置が偽装されています」と表示され、
            懸賞の自動採用からも外れます。
          </Text>
        </Card>
      </View>

      <View>
        <SectionTitle>保存している量</SectionTitle>
        <Card style={styles.card}>
          <View style={styles.usageRow}>
            <Usage label="記録" value={formatBytes(usage.recordBytes)} />
            <Usage label="写真" value={formatBytes(usage.photoBytes)} />
            <Usage label="台帳" value={`${usage.ledgerEntries}行`} />
          </View>
          <Text style={styles.muted}>
            出品 {usage.pins}件・依頼 {usage.bounties}件。写真は端末のファイルに置いていて、
            期限切れから24時間で自動的に削除されます。記録のほうは残高の元になるので消しません
          </Text>
        </Card>
      </View>

      {/*
        ユーザー切替は押すだけで他人になれる。本番ビルドに残すと、
        あとから認証を入れても丸ごと迂回されるので、開発ビルドだけに出す。
        データの初期化も同じ理由でここに置く。
      */}
      {__DEV__ ? (
        <View>
          <SectionTitle>動作確認用（開発ビルドのみ）</SectionTitle>
          <Card style={styles.card}>
            <Text style={styles.muted}>
              売り手と買い手、依頼者と報告者の往復を1台で試すためのユーザー切替です。
              本番のビルドには含まれません
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
      ) : null}
    </Screen>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

function Usage({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.usageItem}>
      <Text style={styles.usageLabel}>{label}</Text>
      <Text style={styles.usageValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    balanceCard: { gap: Spacing.md },
    balanceRow: { flexDirection: 'row', alignItems: 'center' },
    balanceItem: { flex: 1, gap: 2 },
    balanceDivider: { width: 1, height: 36, backgroundColor: colors.border },
    balanceLabel: { fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
    balanceValue: { fontSize: 24, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    balanceNote: { fontSize: 11, color: colors.textFaint, lineHeight: 17, fontFamily: Fonts.sans },

    card: { gap: Spacing.md, padding: Spacing.md },
    body: { fontSize: 13, color: colors.text, lineHeight: 20, fontFamily: Fonts.sans },
    muted: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
    errorText: { fontSize: 12, color: colors.danger, fontWeight: '600', fontFamily: Fonts.sans },

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
    handle: { fontSize: 16, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: 7,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    entryLeft: { flex: 1, gap: 1 },
    entryKind: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    entryMemo: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
    entryRight: { alignItems: 'flex-end' },
    entryAmount: { fontSize: 14, fontWeight: '800', fontFamily: Fonts.sans },
    entryPending: { fontSize: 11, color: colors.warn, fontWeight: '600', fontFamily: Fonts.sans },
    entryTime: { fontSize: 10, color: colors.textFaint, fontFamily: Fonts.sans },

    usageRow: { flexDirection: 'row', gap: Spacing.sm },
    usageItem: { flex: 1, gap: 2 },
    usageLabel: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
    usageValue: { fontSize: 16, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ruleText: { flex: 1, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },

    userGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    userChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    userChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
    userEmoji: { fontSize: 15 },
    userName: { fontSize: 13, fontWeight: '600', color: colors.textSub, fontFamily: Fonts.sans },
    userNameActive: { color: colors.brand, fontWeight: '800' },
  });
}
