import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from '@/components/AuthGate';
import { PriceNegotiation } from '@/components/PriceNegotiation';
import { Screen } from '@/components/Screen';
import { EscrowBadge, PinLifeBadge, SlotBadge } from '@/components/badges';
import { Button, Card, EmptyState, Pill, Segmented } from '@/components/ui';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import type { SellerPinView } from '@/data/repository';
import { stockLabel } from '@/domain/catalog';
import {
  confirmedAtOf,
  formatRemaining,
  formatStamp,
  formatYen,
  isOpenEnded,
  isPurchasable,
  MISS_REASON_LABEL,
  verdictDeadline,
} from '@/domain/rules';
import type { MissReason, RevealedPin } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

type Side = 'bought' | 'sold';

export default function DealsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = useSession((s) => s.userId);
  const signedIn = useSession((s) => s.signedIn);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const now = useNow(1000);
  const [side, setSide] = useState<Side>('bought');

  const { value: bought } = useAsync<RevealedPin[]>(
    () => (signedIn ? repo.listMyPurchases(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const { value: sold } = useAsync<SellerPinView[]>(
    () => (signedIn ? repo.listMyPins(userId, nowMs()) : Promise.resolve([])),
    [userId, revision, signedIn],
    []
  );
  const submitVerdict = async (
    purchaseId: string,
    verdict: 'hit' | 'miss',
    reason: MissReason | null
  ) => {
    await repo.submitVerdict(purchaseId, userId, verdict, reason, nowMs());
    await bump();
  };

  const withdrawPin = async (pinId: string) => {
    await repo.voidPin(pinId, userId, nowMs());
    await bump();
  };

  if (!signedIn) {
    return (
      <AuthGate
        title="取引"
        body="買ったものと売ったものの記録を見るには、ログインが必要です"
      />
    );
  }

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
  onVerdict: (purchaseId: string, verdict: 'hit' | 'miss', reason: MissReason | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { purchase } = pin;
  const pending = purchase.escrow === 'held';
  const deadline = verdictDeadline(purchase);
  const [pickingReason, setPickingReason] = useState(false);

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
            {purchase.verdict === 'hit' ? <Pill tone="money">合っていた</Pill> : null}
            {purchase.verdict === 'miss' && purchase.missReason ? (
              <Pill tone={purchase.missReason === 'gone' ? 'warn' : 'danger'}>
                {MISS_REASON_LABEL[purchase.missReason]}
              </Pill>
            ) : null}
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

      {/* 期限で地図から消えたあとに読み返す場所なので、いつの情報をいつ買ったのかを残す */}
      <Stamps
        rows={[
          ['情報が出た', formatStamp(pin.createdAt, now)],
          ['買った', formatStamp(purchase.createdAt, now)],
          purchase.verdictAt === null
            ? ['確定の予定', formatStamp(deadline, now)]
            : [
                purchase.escrow === 'refunded' ? '返金した' : '確定した',
                formatStamp(purchase.verdictAt, now),
              ],
        ]}
      />

      {pending ? (
        <View style={styles.verdictBlock}>
          <Text style={styles.verdictNote}>
            現地はこの情報のとおりでしたか。
            {deadline > now
              ? `申告がなければ、あと${formatRemaining(deadline - now)}で支払いが確定します`
              : 'まもなく支払いが確定します'}
          </Text>

          {pickingReason ? (
            <View style={styles.reasonBlock}>
              <Text style={styles.reasonPrompt}>どう違いましたか</Text>
              {/* 売り切れと嘘を同じ扱いにすると、正直な出品者の記録まで汚れる。
                  どれを選んでも返金額は同じなので、買い手は正直に選んで損をしない */}
              <Button
                label={MISS_REASON_LABEL.gone}
                variant="secondary"
                hint="出品は地図から消えます。出品者の記録には残しません"
                onPress={() => onVerdict(purchase.id, 'miss', 'gone')}
              />
              <Button
                label={MISS_REASON_LABEL.wrong_place}
                variant="danger"
                onPress={() => onVerdict(purchase.id, 'miss', 'wrong_place')}
              />
              <Button
                label={MISS_REASON_LABEL.too_thin}
                variant="danger"
                onPress={() => onVerdict(purchase.id, 'miss', 'too_thin')}
              />
              <Button
                label="やめる"
                variant="ghost"
                onPress={() => setPickingReason(false)}
              />
            </View>
          ) : (
            <View style={styles.verdictButtons}>
              <Button
                label="情報どおりだった"
                variant="secondary"
                style={styles.verdictButton}
                onPress={() => onVerdict(purchase.id, 'hit', null)}
              />
              <Button
                label="違っていた"
                variant="danger"
                style={styles.verdictButton}
                hint="返金されます"
                onPress={() => setPickingReason(true)}
              />
            </View>
          )}
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { pin, purchases } = item;
  const active = pin.status === 'active' && (pin.expiresAt === null || pin.expiresAt > now);
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
          <PinLifeBadge pin={pin} now={now} />
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
          <Text style={[styles.earningValue, { color: colors.money }]}>
            {formatYen(item.releasedTotal)}
          </Text>
        </View>
        <View style={styles.earningItem}>
          <Text style={styles.earningLabel}>買い手の申告</Text>
          <Text style={styles.earningValue}>
            合 {hits} / 違 {misses}
          </Text>
        </View>
      </View>

      <Stamps
        rows={[
          ['出した', formatStamp(pin.createdAt, now)],
          ['確認', formatStamp(confirmedAtOf(pin), now)],
          isOpenEnded(pin)
            ? ['掲載', '止めるまで残ります']
            : [pin.expiresAt !== null && pin.expiresAt > now ? '期限' : '期限切れ', formatStamp(pin.expiresAt ?? pin.createdAt, now)],
        ]}
      />

      {purchases.length ? (
        <View style={styles.sales}>
          <Text style={styles.salesTitle}>売れた記録</Text>
          {purchases
            .slice()
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((sale) => (
              <View key={sale.id} style={styles.saleRow}>
                <Text style={styles.saleTime}>{formatStamp(sale.createdAt, now)}</Text>
                <Text style={styles.saleAmount}>{formatYen(sale.price - sale.fee)}</Text>
                <View style={styles.saleStatus}>
                  <EscrowBadge escrow={sale.escrow} />
                </View>
                {sale.missReason ? (
                  <Text style={styles.saleReason}>{MISS_REASON_LABEL[sale.missReason]}</Text>
                ) : null}
              </View>
            ))}
        </View>
      ) : null}

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
          label="掲載を止める"
          variant="ghost"
          onPress={() => onWithdraw(pin.id)}
          hint="止めないと「ある」表示が残ります。未確定の購入は返金されます"
        />
      ) : null}
    </Card>
  );
}

/** 取引の時系列。左に出来事、右に時刻を並べるだけ */
function Stamps({ rows }: { rows: [string, string][] }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stamps}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.stampRow}>
          <Text style={styles.stampLabel}>{label}</Text>
          <Text style={styles.stampValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    list: { flex: 1 },
    listContent: { gap: Spacing.md, paddingBottom: Spacing.xl },
    card: { gap: Spacing.md, padding: Spacing.md },

    boughtHead: { flexDirection: 'row', gap: Spacing.md },
    boughtHeadText: { flex: 1, gap: 4 },
    thumb: { width: 74, height: 74, borderRadius: Radius.sm, backgroundColor: colors.bgAlt },
    soldHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },

    headline: {
      flex: 1,
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 21,
      fontFamily: Fonts.sans,
    },
    price: { fontSize: 16, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    place: { fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
    badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

    stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    quantity: { fontSize: 14, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    payload: { fontSize: 14, color: colors.text, lineHeight: 22, fontFamily: Fonts.sans },

    verdictBlock: { gap: Spacing.sm },
    verdictNote: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
    verdictButtons: { flexDirection: 'row', gap: Spacing.sm },
    verdictButton: { flex: 1 },
    reasonBlock: { gap: Spacing.sm },
    reasonPrompt: { fontSize: 13, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    earnings: {
      flexDirection: 'row',
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.md,
      padding: Spacing.md,
    },
    earningItem: { flex: 1, gap: 2 },
    earningLabel: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
    earningValue: { fontSize: 14, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },

    stamps: { gap: 2 },
    stampRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    stampLabel: { fontSize: 11, color: colors.textSub, fontFamily: Fonts.sans },
    stampValue: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      fontVariant: ['tabular-nums'],
      fontFamily: Fonts.sans,
    },

    sales: { gap: 5, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: Spacing.sm },
    salesTitle: { fontSize: 11, fontWeight: '800', color: colors.textSub, fontFamily: Fonts.sans },
    saleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    saleTime: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      fontVariant: ['tabular-nums'],
      fontFamily: Fonts.sans,
    },
    saleAmount: { fontSize: 12, color: colors.money, fontWeight: '700', fontFamily: Fonts.sans },
    saleStatus: { marginLeft: 'auto' },
    saleReason: { fontSize: 10, color: colors.textFaint, fontFamily: Fonts.sans },
  });
}
