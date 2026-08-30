import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { formatFreshness, formatRemaining, formatScore, type Urgency } from '@/domain/rules';
import type { EscrowState } from '@/domain/types';

import { Pill, type Tone } from './ui';

export const URGENCY_TONE: Record<Urgency, Tone> = {
  fresh: 'brand',
  warn: 'warn',
  urgent: 'urgent',
  dead: 'dead',
};

export function CountdownBadge({
  expiresAt,
  now,
  urgency,
  prefix = '残り',
}: {
  expiresAt: number;
  now: number;
  urgency: Urgency;
  prefix?: string;
}) {
  const left = Math.max(0, expiresAt - now);
  if (left <= 0) return <Pill tone="dead">期限切れ</Pill>;
  return (
    <Pill tone={URGENCY_TONE[urgency]} solid={urgency === 'urgent'}>
      {prefix}
      {formatRemaining(left)}
    </Pill>
  );
}

export function FreshnessBadge({ createdAt, now }: { createdAt: number; now: number }) {
  return <Pill tone="neutral">{formatFreshness(Math.max(0, now - createdAt))}の情報</Pill>;
}

export function SlotBadge({ total, taken }: { total: number; taken: number }) {
  const left = Math.max(0, total - taken);
  if (left <= 0) return <Pill tone="dead">売り切れ</Pill>;
  if (left === 1) return <Pill tone="urgent">あと1人</Pill>;
  return (
    <Pill tone="neutral">
      あと{left}人 / {total}
    </Pill>
  );
}

export function ScoreBadge({ score, deals }: { score: number | null; deals: number }) {
  if (score === null) return <Pill tone="neutral">実績なし</Pill>;
  const tone: Tone = score >= 0.8 ? 'money' : score >= 0.6 ? 'neutral' : 'danger';
  return (
    <Pill tone={tone}>
      {formatScore(score)}・{deals}件
    </Pill>
  );
}

const ESCROW: Record<EscrowState, { label: string; tone: Tone }> = {
  held: { label: '預かり中', tone: 'warn' },
  released: { label: '確定', tone: 'money' },
  refunded: { label: '返金済み', tone: 'danger' },
};

export function EscrowBadge({ escrow }: { escrow: EscrowState }) {
  const e = ESCROW[escrow];
  return <Pill tone={e.tone}>{e.label}</Pill>;
}

export function Avatar({ emoji, size = 28 }: { emoji: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ fontSize: size * 0.55 }}>{emoji}</Text>
    </View>
  );
}

export function SellerLine({
  emoji,
  handle,
  score,
  deals,
  onPress,
}: {
  emoji: string;
  handle: string;
  score: number | null;
  deals: number;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Avatar emoji={emoji} size={24} />
      <Text style={styles.sellerName}>{handle}</Text>
      <ScoreBadge score={score} deals={deals} />
    </>
  );

  if (!onPress) return <View style={styles.sellerLine}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sellerLine, pressed && styles.sellerLinePressed]}>
      {content}
      <Ionicons name="chevron-forward" size={15} color={Colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: Colors.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sellerLinePressed: { opacity: 0.55 },
  sellerName: { fontSize: 13, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
});
