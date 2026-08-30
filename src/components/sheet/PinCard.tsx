import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  distanceM,
  formatDistance,
  formatFreshness,
  formatYen,
  isPurchasable,
  urgencyOf,
} from '@/domain/rules';
import type { LatLng, PublicPin } from '@/domain/types';

import { CountdownBadge, ScoreBadge, SlotBadge } from '../badges';

export function PinCard({
  pin,
  now,
  origin,
  selected,
  onPress,
}: {
  pin: PublicPin;
  now: number;
  origin: LatLng | null;
  selected?: boolean;
  onPress: () => void;
}) {
  const urgency = urgencyOf(pin, now);
  const open = isPurchasable(pin, now);
  const distance = origin ? distanceM(origin, { lat: pin.lat, lng: pin.lng }) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
        !open && styles.cardClosed,
      ]}>
      <View style={styles.head}>
        <Text style={styles.headline} numberOfLines={2}>
          {pin.headline}
        </Text>
        <Text style={styles.price}>{formatYen(pin.price)}</Text>
      </View>

      <View style={styles.placeRow}>
        <Ionicons name="location-outline" size={13} color={Colors.textFaint} />
        <Text style={styles.place} numberOfLines={1}>
          {pin.placeLabel}
        </Text>
        {distance !== null ? <Text style={styles.distance}>{formatDistance(distance)}</Text> : null}
      </View>

      <View style={styles.badges}>
        <CountdownBadge expiresAt={pin.expiresAt} now={now} urgency={urgency} />
        <SlotBadge total={pin.slotTotal} taken={pin.slotTaken} />
        <Text style={styles.fresh}>{formatFreshness(now - pin.createdAt)}の情報</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.seller}>
          {pin.sellerEmoji} {pin.sellerHandle}
        </Text>
        <ScoreBadge score={pin.sellerScore} deals={pin.sellerDeals} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cardSelected: { borderColor: Colors.brand, backgroundColor: Colors.brandSoft },
  cardPressed: { opacity: 0.75 },
  cardClosed: { opacity: 0.55 },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  headline: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 21,
    fontFamily: Fonts.sans,
  },
  price: { fontSize: 17, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  distance: { fontSize: 12, fontWeight: '700', color: Colors.textFaint, fontFamily: Fonts.sans },

  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  fresh: { fontSize: 11, color: Colors.textFaint, fontFamily: Fonts.sans },

  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  seller: { fontSize: 12, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
});
