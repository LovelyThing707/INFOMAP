import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { stockLabel } from '@/domain/catalog';
import {
  confirmedAtOf,
  distanceM,
  formatDistance,
  formatFreshness,
  formatYen,
  isExpired,
  isOpenEnded,
  isPurchasable,
  isRevealed,
  isSoldOut,
  REPORT_REASON_LABEL,
  REPORTS_TO_VOID,
} from '@/domain/rules';
import type {
  LatLng,
  PublicPin,
  ReportReason,
  RevealedPin,
  StockState,
} from '@/domain/types';
import { useColors } from '@/hooks/use-colors';

import { requireSignedIn } from '@/lib/auth-gate';
import { repo, useSession } from '@/state/session';

import { PriceNegotiation } from '../PriceNegotiation';
import { EvidenceLine, PinLifeBadge, SellerLine, SlotBadge } from '../badges';
import { Button, Pill, type Tone } from '../ui';

const REPORT_REASONS: ReportReason[] = ['forbidden', 'false_info', 'stale_photo', 'other'];

const STOCK_TONE: Record<StockState, Tone> = {
  in_stock: 'money',
  few: 'warn',
  out: 'danger',
};

export function PinDetail({
  pin,
  now,
  origin,
  available,
  meId,
  busy,
  error,
  onBuy,
  onClose,
  onReport,
  onOpenSeller,
  onOpenDetail,
  backLabel = '一覧へ',
  /**
   * 地図シート用。募集プレビューと同じく、買う材料の手前までで止めて詳細画面へ送る。
   * 「現場で撮影」以降（証拠・中身・値下げ・購入）は出さない。
   */
  preview = false,
}: {
  pin: PublicPin | RevealedPin;
  now: number;
  origin: LatLng | null;
  available: number;
  meId: string;
  busy: boolean;
  error: string | null;
  onBuy: () => void;
  onClose: () => void;
  onReport: (reason: ReportReason) => void;
  onOpenSeller?: () => void;
  onOpenDetail?: () => void;
  backLabel?: string;
  preview?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [reporting, setReporting] = useState(false);
  const revealed = isRevealed(pin);
  const mine = pin.sellerId === meId;
  const distance = origin ? distanceM(origin, { lat: pin.lat, lng: pin.lng }) : null;
  const open = isPurchasable(pin, now);
  const enough = available >= pin.price;
  const bump = useSession((s) => s.bump);

  const closedReason = isExpired(pin, now)
    ? '賞味期限が切れました'
    : isSoldOut(pin)
      ? '先着の枠が埋まりました'
      : pin.status === 'voided'
        ? '掲載が止まりました'
        : null;

  const body = (
    <>
      <View style={styles.topRow}>
        <Pressable onPress={onClose} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={colors.textSub} />
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
        {preview ? null : (
          <Pressable onPress={() => setReporting((v) => !v)} hitSlop={8}>
            <Text style={styles.reportText}>{reporting ? 'やめる' : '通報'}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.headlineRow}>
        <Text style={styles.headline}>{pin.headline}</Text>
        <Pressable
          onPress={() => {
            if (!requireSignedIn()) return;
            void repo.togglePinLike(meId, pin.id).then(() => bump());
          }}
          hitSlop={8}
          style={styles.like}
        >
          <Ionicons
            name={pin.likedByMe ? 'heart' : 'heart-outline'}
            size={18}
            color={pin.likedByMe ? colors.urgent : colors.textFaint}
          />
          <Text style={[styles.likeCount, pin.likedByMe && styles.likeOn]}>{pin.likeCount}</Text>
        </Pressable>
      </View>

      <View style={styles.placeRow}>
        <Ionicons name="location-outline" size={14} color={colors.textFaint} />
        <Text style={styles.place}>{pin.placeLabel}</Text>
        {distance !== null ? <Text style={styles.distance}>{formatDistance(distance)}</Text> : null}
      </View>

      <View style={styles.badges}>
        <PinLifeBadge pin={pin} now={now} />
        <SlotBadge total={pin.slotTotal} taken={pin.slotTaken} />
        {isOpenEnded(pin) ? null : (
          <Pill tone="neutral">{formatFreshness(now - confirmedAtOf(pin))}の情報</Pill>
        )}
      </View>

      <SellerLine
        emoji={pin.sellerEmoji}
        handle={pin.sellerHandle}
        score={pin.sellerScore}
        deals={pin.sellerDeals}
        onPress={onOpenSeller}
      />

      {reporting && !preview ? (
        <View style={styles.reportBox}>
          <Text style={styles.reportTitle}>どこが問題ですか</Text>
          {REPORT_REASONS.map((reason) => (
            <Button
              key={reason}
              label={REPORT_REASON_LABEL[reason]}
              variant="secondary"
              onPress={() => {
                onReport(reason);
                setReporting(false);
              }}
            />
          ))}
          <Text style={styles.reportNote}>
            別々の{REPORTS_TO_VOID}人から届いた時点で自動的に取り下げ、預かっている代金は買い手へ返します
          </Text>
        </View>
      ) : null}

      {preview ? (
        <>
          <Text style={styles.previewNote}>
            撮影の裏づけ・中身・購入は詳細で確認できます
          </Text>
          <Button
            label="詳細を見る"
            onPress={() => onOpenDetail?.()}
            hint={`${formatYen(pin.price)}・先着 ${pin.slotTotal - pin.slotTaken}/${pin.slotTotal}枠`}
          />
        </>
      ) : (
        <>
          <View style={styles.divider} />

          <EvidenceLine evidence={pin.evidence} now={now} />

          {revealed ? <RevealedBody pin={pin} mine={mine} /> : <LockedBody price={pin.price} />}

          <PriceNegotiation
            targetKind="pin"
            targetId={pin.id}
            amount={pin.price}
            ownerId={pin.sellerId}
            summary={pin.asks}
            closed={!open}
          />

          {revealed ? null : (
            <View style={styles.buyBlock}>
              {closedReason ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>{closedReason}</Text>
                </View>
              ) : mine ? (
                <View style={styles.notice}>
                  <Text style={styles.noticeText}>これはあなたの出品です</Text>
                </View>
              ) : (
                <>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>情報料</Text>
                    <Text style={styles.priceValue}>{formatYen(pin.price)}</Text>
                  </View>
                  <Button
                    label={busy ? '処理中…' : `${formatYen(pin.price)}で買う`}
                    hint={open ? '先着枠。買うと今の状態と写真が開きます' : undefined}
                    onPress={onBuy}
                    disabled={busy || !open || !enough}
                  />
                  {!enough ? (
                    <Text style={styles.warnText}>
                      残高が足りません（いま {formatYen(available)}）。マイページから確認できます
                    </Text>
                  ) : null}
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                </>
              )}
            </View>
          )}
        </>
      )}
    </>
  );

  // プレビューは高さを測ってシートを合わせるので、伸びる ScrollView にしない
  if (preview) {
    return <View style={styles.content}>{body}</View>;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}

function LockedBody({ price }: { price: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.locked}>
      <View style={styles.lockIcon}>
        <Ionicons name="lock-closed" size={18} color={colors.textFaint} />
      </View>
      <Text style={styles.lockTitle}>買うと開くもの</Text>
      <View style={styles.lockList}>
        <LockItem text="現場の写真 1枚" />
        <LockItem text="今の状態（ある / 残りわずか / ない）と残数" />
        <LockItem text="どこの棚か、条件は何か、という出品者のメモ" />
      </View>
      <Text style={styles.lockNote}>
        写真と本文は、買った人にしか届きません。{formatYen(price)}を払う前に見られる情報はここまでです。
        違っていたら、2時間以内の申告で全額戻ります。
      </Text>
    </View>
  );
}

function LockItem({ text }: { text: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.lockItem}>
      <Ionicons name="ellipse" size={5} color={colors.textFaint} />
      <Text style={styles.lockItemText}>{text}</Text>
    </View>
  );
}

function RevealedBody({ pin, mine }: { pin: RevealedPin; mine: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.revealed}>
      {pin.photoUri ? (
        <Image source={{ uri: pin.photoUri }} style={styles.photo} contentFit="cover" />
      ) : null}

      <View style={styles.stateRow}>
        <Pill tone={STOCK_TONE[pin.stockState]} solid>
          {stockLabel(pin.stockState)}
        </Pill>
        {pin.quantityNote ? <Text style={styles.quantity}>{pin.quantityNote}</Text> : null}
      </View>

      <Text style={styles.payload}>{pin.payloadText}</Text>

      <Text style={styles.revealedNote}>
        {mine
          ? 'これはあなたの出品です。売れ行きは取引タブで確認できます'
          : '購入済み。情報が合っていたかの申告は取引タブからできます'}
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: 40 },

    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 13, fontWeight: '600', color: colors.textSub, fontFamily: Fonts.sans },
    reportText: { fontSize: 12, color: colors.textFaint, fontFamily: Fonts.sans },

    headlineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    headline: {
      flex: 1,
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 28,
      fontFamily: Fonts.sans,
    },
    like: { alignItems: 'center', gap: 2, paddingTop: 4 },
    likeCount: { fontSize: 12, fontWeight: '700', color: colors.textFaint, fontFamily: Fonts.sans },
    likeOn: { color: colors.urgent },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    place: { flex: 1, fontSize: 13, color: colors.textSub, fontFamily: Fonts.sans },
    distance: { fontSize: 13, fontWeight: '700', color: colors.textFaint, fontFamily: Fonts.sans },
    badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    previewNote: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },

    divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },

    locked: {
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    lockIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.bgSunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lockTitle: { fontSize: 14, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    lockList: { gap: 6 },
    lockItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    lockItemText: { fontSize: 13, color: colors.textSub, flex: 1, fontFamily: Fonts.sans },
    lockNote: {
      fontSize: 11,
      color: colors.textFaint,
      lineHeight: 17,
      marginTop: 2,
      fontFamily: Fonts.sans,
    },

    revealed: { gap: Spacing.md },
    photo: { width: '100%', aspectRatio: 3 / 2, borderRadius: Radius.md, backgroundColor: colors.bgAlt },
    stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    quantity: { fontSize: 14, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    payload: { fontSize: 15, color: colors.text, lineHeight: 24, fontFamily: Fonts.sans },
    revealedNote: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },

    buyBlock: { gap: Spacing.sm },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    priceLabel: { fontSize: 13, color: colors.textSub, fontFamily: Fonts.sans },
    priceValue: { fontSize: 24, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    notice: {
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: 'center',
    },
    noticeText: { fontSize: 13, fontWeight: '600', color: colors.textSub, fontFamily: Fonts.sans },
    reportBox: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: colors.dangerSoft,
    },
    reportTitle: { fontSize: 13, fontWeight: '800', color: colors.danger, fontFamily: Fonts.sans },
    reportNote: { fontSize: 11, color: colors.textSub, lineHeight: 17, fontFamily: Fonts.sans },

    warnText: { fontSize: 12, color: colors.warn, fontFamily: Fonts.sans },
    errorText: { fontSize: 12, color: colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
  });
}
