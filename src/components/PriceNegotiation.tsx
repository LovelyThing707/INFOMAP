import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatYen, lowerSuggestions, raiseSuggestions } from '@/domain/rules';
import type { AskTargetKind, PriceAskSummary } from '@/domain/types';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

/**
 * 「この額なら動く」という一票を集める仕組み。
 *
 * 出品も依頼も、値付けは出した人の当てずっぽうで始まる。安すぎる依頼には誰も行かず、
 * 高すぎる出品は腐って消える。どちらも「いくらなら成立したのか」が持ち主に返らない。
 * 数分で消える情報なので値段交渉をしている時間はなく、一票と中央値だけを見せて
 * 持ち主が一度で決められるようにしている。
 */
export function PriceNegotiation({
  targetKind,
  targetId,
  amount,
  ownerId,
  summary,
  closed = false,
}: {
  targetKind: AskTargetKind;
  targetId: string;
  /** いまの価格または報酬 */
  amount: number;
  ownerId: string;
  summary: PriceAskSummary;
  closed?: boolean;
}) {
  const userId = useSession((s) => s.userId);
  const bump = useSession((s) => s.bump);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = ownerId === userId;
  const lowering = targetKind === 'pin';
  const verb = lowering ? '値下げ' : '値上げ';
  const suggestions = lowering ? lowerSuggestions(amount) : raiseSuggestions(amount);

  if (closed) return null;

  const submit = async (desired: number) => {
    setError(null);
    const result = await repo.askPriceChange(targetKind, targetId, userId, desired, nowMs());
    if (!result.ok) {
      setError(result.reason === 'closed' ? 'もう締め切られています' : `${verb}をお願いできません`);
      return;
    }
    setOpen(false);
    await bump();
  };

  const withdraw = async () => {
    await repo.withdrawPriceAsk(targetKind, targetId, userId);
    await bump();
  };

  const apply = async (next: number) => {
    setError(null);
    const result = await repo.applyPriceChange(targetKind, targetId, userId, next, nowMs());
    if (!result.ok) {
      setError(
        result.reason === 'insufficient_balance'
          ? '差額を預けるだけの残高がありません'
          : result.reason === 'closed'
            ? 'もう締め切られています'
            : '変更できませんでした'
      );
      return;
    }
    await bump();
  };

  if (isOwner) {
    if (summary.count === 0) return null;
    // 中央値をいちばん左に置く。ここに合わせれば半分以上が動く
    const options = [...new Set([summary.median, ...suggestions])].filter((v) =>
      lowering ? v < amount : v > amount
    );

    return (
      <View style={[styles.panel, lowering ? styles.panelSale : styles.panelBounty]}>
        <View style={styles.panelHead}>
          <Ionicons
            name={lowering ? 'trending-down' : 'trending-up'}
            size={15}
            color={lowering ? Colors.brand : Colors.money}
          />
          <Text style={styles.panelTitle}>
            {summary.count}人が{verb}を待っています
          </Text>
        </View>
        <Text style={styles.panelBody}>
          希望の中央値は {formatYen(summary.median)}。ここに合わせると、待っている人の半分以上が動きます
        </Text>
        <View style={styles.chipRow}>
          {options.map((value, index) => (
            <Pressable
              key={value}
              onPress={() => apply(value)}
              style={[styles.chip, index === 0 && styles.chipPrimary]}>
              <Text style={[styles.chipText, index === 0 && styles.chipTextPrimary]}>
                {formatYen(value)}
                {lowering ? 'に下げる' : 'に上げる'}
              </Text>
            </Pressable>
          ))}
        </View>
        {!lowering ? (
          <Text style={styles.note}>上げたぶんは、残っている採用枠のぶんだけ追加で預かります</Text>
        ) : (
          <Text style={styles.note}>すでに買った人の支払いは変わりません</Text>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  if (summary.mine !== null) {
    return (
      <View style={styles.askedRow}>
        <Ionicons name="checkmark-circle" size={15} color={Colors.textSub} />
        <Text style={styles.askedText}>
          {formatYen(summary.mine)}なら動く、と伝えました
          {summary.count > 1 ? `（ほかに${summary.count - 1}人）` : ''}
        </Text>
        <Pressable onPress={withdraw} hitSlop={8}>
          <Text style={styles.withdraw}>取り消す</Text>
        </Pressable>
      </View>
    );
  }

  if (!suggestions.length) return null;

  if (!open) {
    return (
      <Pressable style={styles.askButton} onPress={() => setOpen(true)}>
        <Ionicons
          name={lowering ? 'trending-down' : 'trending-up'}
          size={15}
          color={Colors.textSub}
        />
        <Text style={styles.askButtonText}>{verb}をお願いする</Text>
        {summary.count > 0 ? (
          <Text style={styles.askButtonCount}>{summary.count}人が待機中</Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={styles.askOpen}>
      <Text style={styles.askPrompt}>いくらなら動きますか</Text>
      <View style={styles.chipRow}>
        {suggestions.map((value) => (
          <Pressable key={value} onPress={() => submit(value)} style={styles.chip}>
            <Text style={styles.chipText}>{formatYen(value)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setOpen(false)} style={styles.cancelChip}>
          <Text style={styles.cancelText}>やめる</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 6,
    borderWidth: 1,
  },
  panelSale: { backgroundColor: Colors.brandSoft, borderColor: '#C7D8FF' },
  panelBounty: { backgroundColor: Colors.moneySoft, borderColor: '#A7E7CB' },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  panelTitle: { fontSize: 13, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  panelBody: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
  note: { fontSize: 11, color: Colors.textFaint, fontFamily: Fonts.sans },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipPrimary: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipText: { fontSize: 12, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  chipTextPrimary: { color: '#fff' },

  cancelChip: { paddingHorizontal: 12, paddingVertical: 8 },
  cancelText: { fontSize: 12, color: Colors.textFaint, fontFamily: Fonts.sans },

  askButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  askButtonText: { fontSize: 12, fontWeight: '700', color: Colors.textSub, fontFamily: Fonts.sans },
  askButtonCount: {
    marginLeft: 'auto',
    fontSize: 11,
    color: Colors.textFaint,
    fontFamily: Fonts.sans,
  },

  askOpen: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 4,
  },
  askPrompt: { fontSize: 12, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },

  askedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  askedText: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  withdraw: { fontSize: 12, fontWeight: '700', color: Colors.danger, fontFamily: Fonts.sans },

  error: { fontSize: 12, color: Colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
});
