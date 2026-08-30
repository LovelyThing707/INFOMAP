import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PriceNegotiation } from '@/components/PriceNegotiation';
import { Screen } from '@/components/Screen';
import { CountdownBadge, EscrowBadge, SlotBadge } from '@/components/badges';
import { Button, Card, EmptyState, Pill, Segmented } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { SellerPinView } from '@/data/repository';
import { stockLabel } from '@/domain/catalog';
import { formatRemaining, formatYen, isPurchasable, urgencyOf, verdictDeadline } from '@/domain/rules';
import type { RevealedPin } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

type Side = 'bought' | 'sold';

export default function DealsScreen() {
  const userId = useSession((s) => s.userId);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const now = useNow(1000);
  const [side, setSide] = useState<Side>('bought');

  const { value: bought } = useAsync<RevealedPin[]>(
    () => repo.listMyPurchases(userId, nowMs()),
    [userId, revision],
    []
  );
  const { value: sold } = useAsync<SellerPinView[]>(
    () => repo.listMyPins(userId, nowMs()),
    [userId, revision],
    []
  );

  const submitVerdict = async (purchaseId: string, verdict: 'hit' | 'miss') => {
    await repo.submitVerdict(purchaseId, verdict, nowMs());
    await bump();
  };

  const withdrawPin = async (pinId: string) => {
    await repo.voidPin(pinId, userId, nowMs());
    await bump();
  };

  return (
    <Screen
      title="取引"
      subtitle="地図からは消えても、買ったものと売ったものはここに残ります"
      scroll={false}>
      <Segmented<Side>
        options={[
          { id: 'bought', label: '買った', count: bought.length },
          { id: 'sold', label: '売った', count: sold.length },
        ]}
        value={side}
        onChange={setSide}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {side === 'bought' ? (
          bought.length === 0 ? (
            <EmptyState
              title="まだ何も買っていません"
              body="地図でピンを開いて買うと、写真と本文がここからいつでも見られます"
            />
          ) : (
            bought.map((pin) => (
              <BoughtCard key={pin.purchase.id} pin={pin} now={now} onVerdict={submitVerdict} />
            ))
          )
        ) : sold.length === 0 ? (
          <EmptyState
            title="まだ出品していません"
            body="現場にいるうちに「売る」タブから出すと、売れ行きがここに出ます"
          />
        ) : (
          sold.map((item) => (
            <SoldCard key={item.pin.id} item={item} now={now} onWithdraw={withdrawPin} />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function BoughtCard({
  pin,
  now,
  onVerdict,
}: {
  pin: RevealedPin;
  now: number;
  onVerdict: (purchaseId: string, verdict: 'hit' | 'miss') => void;
}) {
  const { purchase } = pin;
  const pending = purchase.escrow === 'held';
  const deadline = verdictDeadline(purchase);

  return (
    <Card style={styles.card}>
      <View style={styles.boughtHead}>
        {pin.photoUri ? (
          <Image source={{ uri: pin.photoUri }} style={styles.thumb} contentFit="cover" />
        ) : null}
        <View style={styles.boughtHeadText}>
          <Text style={styles.headline} numberOfLines={2}>
            {pin.headline}
          </Text>
          <Text style={styles.place} numberOfLines={1}>
            {pin.placeLabel}
          </Text>
          <View style={styles.badges}>
            <EscrowBadge escrow={purchase.escrow} />
            <Pill tone="neutral">{formatYen(purchase.price)}</Pill>
            {purchase.verdict === 'hit' ? <Pill tone="money">当たり</Pill> : null}
            {purchase.verdict === 'miss' ? <Pill tone="danger">外れ</Pill> : null}
          </View>
        </View>
      </View>

      <View style={styles.stateRow}>
        <Pill tone={pin.stockState === 'out' ? 'danger' : 'brand'} solid>
          {stockLabel(pin.stockState)}
        </Pill>
        {pin.quantityNote ? <Text style={styles.quantity}>{pin.quantityNote}</Text> : null}
      </View>

      <Text style={styles.payload}>{pin.payloadText}</Text>

      {pending ? (
        <View style={styles.verdictBlock}>
          <Text style={styles.verdictNote}>
            {deadline > now
              ? `あと${formatRemaining(deadline - now)}で自動確定します。外れなら申告すると返金されます`
              : 'まもなく自動確定します'}
          </Text>
          <View style={styles.verdictButtons}>
            <Button
              label="当たった"
              variant="secondary"
              style={styles.verdictButton}
              onPress={() => onVerdict(purchase.id, 'hit')}
            />
            <Button
              label="外れた"
              variant="danger"
              style={styles.verdictButton}
              onPress={() => onVerdict(purchase.id, 'miss')}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.verdictNote}>
          {purchase.escrow === 'refunded'
            ? `${formatYen(purchase.price)}を返金しました`
            : `${formatYen(purchase.price)}の支払いが確定しました`}
        </Text>
      )}
    </Card>
  );
}

function SoldCard({
  item,
  now,
  onWithdraw,
}: {
  item: SellerPinView;
  now: number;
  onWithdraw: (pinId: string) => void;
}) {
  const { pin, purchases } = item;
  const active = pin.status === 'active' && pin.expiresAt > now;
  const hits = purchases.filter((p) => p.verdict === 'hit').length;
  const misses = purchases.filter((p) => p.verdict === 'miss').length;

  return (
    <Card style={styles.card}>
      <View style={styles.soldHead}>
        <Text style={styles.headline} numberOfLines={2}>
          {pin.headline}
        </Text>
        <Text style={styles.price}>{formatYen(pin.price)}</Text>
      </View>
      <Text style={styles.place} numberOfLines={1}>
        {pin.placeLabel}
      </Text>

      <View style={styles.badges}>
        {pin.status === 'voided' ? (
          <Pill tone="dead">取り下げ済み</Pill>
        ) : (
          <CountdownBadge expiresAt={pin.expiresAt} now={now} urgency={urgencyOf(pin, now)} />
        )}
        <SlotBadge total={pin.slotTotal} taken={pin.slotTaken} />
        <Pill tone="neutral">{pin.slotTaken}件売れた</Pill>
      </View>

      <View style={styles.earnings}>
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>預かり中</Text>
          <Text style={styles.earningValue}>{formatYen(item.heldTotal)}</Text>
        </View>
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>確定</Text>
          <Text style={[styles.earningValue, { color: Colors.money }]}>
            {formatYen(item.releasedTotal)}
          </Text>
        </View>
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>判定</Text>
          <Text style={styles.earningValue}>
            当たり{hits} / 外れ{misses}
          </Text>
        </View>
      </View>

      <PriceNegotiation
        targetKind="pin"
        targetId={pin.id}
        amount={pin.price}
        ownerId={pin.sellerId}
        summary={item.asks}
        closed={!isPurchasable(pin, now)}
      />

      {active && isPurchasable(pin, now) ? (
        <Button
          label="取り下げる"
          variant="ghost"
          onPress={() => onWithdraw(pin.id)}
          hint="未確定の購入は買い手へ返金されます"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
  card: { gap: Spacing.md, padding: Spacing.md },

  boughtHead: { flexDirection: 'row', gap: Spacing.md },
  boughtHeadText: { flex: 1, gap: 4 },
  thumb: { width: 74, height: 74, borderRadius: Radius.sm, backgroundColor: Colors.bgAlt },
  soldHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },

  headline: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 21,
    fontFamily: Fonts.sans,
  },
  price: { fontSize: 16, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  place: { fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  quantity: { fontSize: 14, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  payload: { fontSize: 14, color: Colors.text, lineHeight: 22, fontFamily: Fonts.sans },

  verdictBlock: { gap: Spacing.sm },
  verdictNote: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
  verdictButtons: { flexDirection: 'row', gap: Spacing.sm },
  verdictButton: { flex: 1 },

  earnings: {
    flexDirection: 'row',
    backgroundColor: Colors.bgAlt,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  earningItem: { flex: 1, gap: 2 },
  earningLabel: { fontSize: 11, color: Colors.textSub, fontFamily: Fonts.sans },
  earningValue: { fontSize: 14, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
});
