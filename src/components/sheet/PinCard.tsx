import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing, type ThemeColors } from '@/constants/theme';
import {
  distanceM,
  formatDistance,
  formatYen,
  isPurchasable,
  remainingSlots,
} from '@/domain/rules';
import type { LatLng, PublicPin } from '@/domain/types';
import { useColors } from '@/hooks/use-colors';

import { Card, Pill } from '../ui';
import { PinLifeBadge } from '../badges';

/**
 * 募集の BountyCard と同じ型のカード。
 * 一覧では最低限、シートプレビューでは詳細画面へ送る（買う操作は出さない）。
 */
export function PinCard({
  pin,
  now,
  origin,
  onOpen,
  /**
   * false（既定）= 一覧。true = シート上のプレビューで「タップして詳細を見る」だけ出す。
   */
  preview = false,
}: {
  pin: PublicPin;
  now: number;
  origin: LatLng | null;
  onOpen: () => void;
  preview?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const open = isPurchasable(pin, now);
  const distance = origin ? distanceM(origin, { lat: pin.lat, lng: pin.lng }) : null;
  const slots = remainingSlots(pin);

  return (
    <Card style={[styles.card, !open && styles.cardClosed]} onPress={onOpen}>
      <View style={styles.head}>
        <Text style={styles.headline} numberOfLines={3}>
          {pin.headline}
        </Text>
        <View style={styles.priceBox}>
          <Text style={styles.price}>{formatYen(pin.price)}</Text>
        </View>
      </View>

      <View style={styles.placeRow}>
        <Ionicons name="locate-outline" size={13} color={colors.textFaint} />
        <Text style={styles.place} numberOfLines={1}>
          {pin.placeLabel}
        </Text>
        {distance !== null ? <Text style={styles.distance}>{formatDistance(distance)}</Text> : null}
      </View>

      <View style={styles.badges}>
        <PinLifeBadge pin={pin} now={now} />
        {open ? (
          <Pill tone="neutral">先着枠 {slots}</Pill>
        ) : (
          <Pill tone="dead">販売終了</Pill>
        )}
      </View>

      {preview ? <Text style={styles.note}>タップして詳細を見る</Text> : null}
    </Card>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { gap: Spacing.sm, padding: Spacing.md },
    cardClosed: { opacity: 0.6 },

    head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    headline: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      lineHeight: 22,
      fontFamily: Fonts.sans,
    },
    priceBox: { alignItems: 'flex-end' },
    price: { fontSize: 20, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    place: { flex: 1, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
    distance: { fontSize: 12, fontWeight: '700', color: colors.textFaint, fontFamily: Fonts.sans },

    badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    note: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
  });
}
