import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { stockLabel } from '@/domain/catalog';
import {
  distanceM,
  formatDistance,
  formatFreshness,
  formatYen,
  isExpired,
  isPurchasable,
  isRevealed,
  isSoldOut,
  urgencyOf,
} from '@/domain/rules';
import type { LatLng, PublicPin, RevealedPin, StockState } from '@/domain/types';

import { PriceNegotiation } from '../PriceNegotiation';
import { CountdownBadge, SellerLine, SlotBadge } from '../badges';
import { Button, Pill, type Tone } from '../ui';

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
  backLabel = '一覧へ',
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
  onReport: () => void;
  onOpenSeller?: () => void;
  backLabel?: string;
}) {
  const revealed = isRevealed(pin);
  const mine = pin.sellerId === meId;
  const urgency = urgencyOf(pin, now);
  const distance = origin ? distanceM(origin, { lat: pin.lat, lng: pin.lng }) : null;
  const open = isPurchasable(pin, now);
  const enough = available >= pin.price;

  const closedReason = isExpired(pin, now)
    ? '賞味期限が切れました'
    : isSoldOut(pin)
      ? '先着の枠が埋まりました'
      : pin.status === 'voided'
        ? '出品者が取り下げました'
        : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <Pressable onPress={onClose} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={Colors.textSub} />
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
        <Pressable onPress={onReport} hitSlop={8}>
          <Text style={styles.reportText}>通報</Text>
        </Pressable>
      </View>

      <Text style={styles.headline}>{pin.headline}</Text>

      <View style={styles.placeRow}>
        <Ionicons name="location-outline" size={14} color={Colors.textFaint} />
        <Text style={styles.place}>{pin.placeLabel}</Text>
        {distance !== null ? <Text style={styles.distance}>{formatDistance(distance)}</Text> : null}
      </View>

      <View style={styles.badges}>
        <CountdownBadge expiresAt={pin.expiresAt} now={now} urgency={urgency} />
        <SlotBadge total={pin.slotTotal} taken={pin.slotTaken} />
        <Pill tone="neutral">{formatFreshness(now - pin.createdAt)}の情報</Pill>
      </View>

      <SellerLine
        emoji={pin.sellerEmoji}
        handle={pin.sellerHandle}
        score={pin.sellerScore}
        deals={pin.sellerDeals}
        onPress={onOpenSeller}
      />

      <View style={styles.divider} />

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
    </ScrollView>
  );
}

function LockedBody({ price }: { price: number }) {
  return (
    <View style={styles.locked}>
      <View style={styles.lockIcon}>
        <Ionicons name="lock-closed" size={18} color={Colors.textFaint} />
      </View>
      <Text style={styles.lockTitle}>買うと開くもの</Text>
      <View style={styles.lockList}>
        <LockItem text="現場の写真 1枚" />
        <LockItem text="今の状態（ある / 残りわずか / ない）と残数" />
        <LockItem text="どこの棚か、条件は何か、という出品者のメモ" />
      </View>
      <Text style={styles.lockNote}>
        写真と本文は、買った人にしか届きません。{formatYen(price)}を払う前に見られる情報はここまでです。
      </Text>
    </View>
  );
}

function LockItem({ text }: { text: string }) {
  return (
    <View style={styles.lockItem}>
      <Ionicons name="ellipse" size={5} color={Colors.textFaint} />
      <Text style={styles.lockItemText}>{text}</Text>
    </View>
  );
}

function RevealedBody({ pin, mine }: { pin: RevealedPin; mine: boolean }) {
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
          : '購入済み。当たり外れの申告は取引タブからできます'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.md, paddingBottom: 40 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
  reportText: { fontSize: 12, color: Colors.textFaint, fontFamily: Fonts.sans },

  headline: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 28,
    fontFamily: Fonts.sans,
  },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place: { flex: 1, fontSize: 13, color: Colors.textSub, fontFamily: Fonts.sans },
  distance: { fontSize: 13, fontWeight: '700', color: Colors.textFaint, fontFamily: Fonts.sans },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },

  locked: {
    backgroundColor: Colors.bgAlt,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  lockIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockTitle: { fontSize: 14, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  lockList: { gap: 6 },
  lockItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockItemText: { fontSize: 13, color: Colors.textSub, flex: 1, fontFamily: Fonts.sans },
  lockNote: {
    fontSize: 11,
    color: Colors.textFaint,
    lineHeight: 17,
    marginTop: 2,
    fontFamily: Fonts.sans,
  },

  revealed: { gap: Spacing.md },
  photo: { width: '100%', aspectRatio: 3 / 2, borderRadius: Radius.md, backgroundColor: Colors.bgAlt },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  quantity: { fontSize: 14, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  payload: { fontSize: 15, color: Colors.text, lineHeight: 24, fontFamily: Fonts.sans },
  revealedNote: { fontSize: 11, color: Colors.textFaint, fontFamily: Fonts.sans },

  buyBlock: { gap: Spacing.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  priceLabel: { fontSize: 13, color: Colors.textSub, fontFamily: Fonts.sans },
  priceValue: { fontSize: 24, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },

  notice: {
    backgroundColor: Colors.bgAlt,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  noticeText: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
  warnText: { fontSize: 12, color: Colors.warn, fontFamily: Fonts.sans },
  errorText: { fontSize: 12, color: Colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
});
