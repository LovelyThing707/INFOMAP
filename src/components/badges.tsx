import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import {
  confirmedAtOf,
  formatDistance,
  formatFreshness,
  formatRemaining,
  formatScore,
  isOpenEnded,
  PROOF_LABEL,
  urgencyOf,
  type Urgency,
} from '@/domain/rules';
import type { EscrowState, PhotoEvidence, ProofLevel, StoredProof } from '@/domain/types';
import { useColors } from '@/hooks/use-colors';

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
  expiresAt: number | null;
  now: number;
  urgency: Urgency;
  prefix?: string;
}) {
  if (expiresAt === null) return <Pill tone="neutral">無期限</Pill>;
  const left = Math.max(0, expiresAt - now);
  if (left <= 0) return <Pill tone="dead">期限切れ</Pill>;
  return (
    <Pill tone={URGENCY_TONE[urgency]} solid={urgency === 'urgent'}>
      {prefix}
      {formatRemaining(left)}
    </Pill>
  );
}

/** 期限つきは残り時間。無期限は撮影／確認時刻 */
export function PinLifeBadge({
  pin,
  now,
}: {
  pin: {
    createdAt: number;
    expiresAt: number | null;
    status: 'active' | 'voided';
    slotTotal: number;
    slotTaken: number;
    evidence?: PhotoEvidence;
    proof?: StoredProof | null;
  };
  now: number;
}) {
  const urgency = urgencyOf(pin, now);
  if (isOpenEnded(pin)) {
    return (
      <Pill tone={URGENCY_TONE[urgency]}>
        {formatFreshness(Math.max(0, now - confirmedAtOf(pin)))}に確認
      </Pill>
    );
  }
  return <CountdownBadge expiresAt={pin.expiresAt} now={now} urgency={urgency} />;
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

const PROOF_TONE: Record<ProofLevel, Tone> = {
  onsite: 'money',
  offsite: 'warn',
  mocked: 'danger',
  none: 'danger',
};

const PROOF_ICON: Record<ProofLevel, keyof typeof Ionicons.glyphMap> = {
  onsite: 'shield-checkmark',
  offsite: 'alert-circle',
  mocked: 'warning',
  none: 'help-circle',
};

export function ProofBadge({ level }: { level: ProofLevel }) {
  return <Pill tone={PROOF_TONE[level]}>{PROOF_LABEL[level]}</Pill>;
}

/**
 * 買う前に出す撮影の裏づけ。写真は見せずに、端末が記録した位置と時刻だけを渡す。
 * 「写真があります」ではなく「3分前に、この場所から12m以内で撮られています」まで言えると、
 * 持ち込み画像との差がその場で分かる。
 */
export function EvidenceLine({ evidence, now }: { evidence: PhotoEvidence; now: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const detail =
    evidence.level === 'mocked'
      ? '端末が、この座標は作られたものだと申告しています'
      : evidence.takenAt === null
        ? '端末の位置と時刻が残っていません'
        : `${formatFreshness(Math.max(0, now - evidence.takenAt))}に撮影` +
          (evidence.distanceM === null
            ? ''
            : `・この場所から${formatDistance(evidence.distanceM)}`);

  const tone =
    evidence.level === 'onsite'
      ? colors.money
      : evidence.level === 'offsite'
        ? colors.warn
        : colors.danger;

  return (
    <View style={[styles.evidence, { borderColor: tone }]}>
      <Ionicons name={PROOF_ICON[evidence.level]} size={16} color={tone} />
      <View style={styles.evidenceText}>
        <Text style={[styles.evidenceTitle, { color: tone }]}>{PROOF_LABEL[evidence.level]}</Text>
        <Text style={styles.evidenceDetail}>{detail}</Text>
      </View>
    </View>
  );
}

export function Avatar({ emoji, size = 28 }: { emoji: string; size?: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    avatar: {
      backgroundColor: colors.bgAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sellerLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sellerLinePressed: { opacity: 0.55 },
    sellerName: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },

    evidence: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 9,
    },
    evidenceText: { flex: 1, gap: 1 },
    evidenceTitle: { fontSize: 13, fontWeight: '800', fontFamily: Fonts.sans },
    evidenceDetail: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
  });
}
