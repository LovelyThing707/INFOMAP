import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PinDetail } from '@/components/sheet/PinDetail';
import { Colors, Fonts } from '@/constants/theme';
import type { PurchaseFailure } from '@/data/repository';
import { useAsync } from '@/hooks/use-async';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { closeModal } from '@/lib/navigation';
import { repo, useSession } from '@/state/session';

const PURCHASE_ERROR: Record<PurchaseFailure, string> = {
  not_found: 'この情報は見つかりませんでした',
  voided: '出品者が取り下げました',
  expired: '賞味期限が切れました',
  sold_out: '一足違いで枠が埋まりました',
  own_pin: '自分の出品は買えません',
  already_bought: 'すでに購入済みです',
  insufficient_balance: '残高が足りません',
};

export default function PinModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useSession((s) => s.userId);
  const balance = useSession((s) => s.balance);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const location = useUserLocation();
  const now = useNow(1000);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { value: pin } = useAsync(
    () => (id ? repo.getPin(id, userId, nowMs()) : Promise.resolve(null)),
    [id, userId, revision],
    null
  );

  if (!pin) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>この情報は見つかりません</Text>
      </View>
    );
  }

  const buy = async () => {
    setBusy(true);
    setError(null);
    const result = await repo.purchase(pin.id, userId, nowMs());
    if (!result.ok) setError(PURCHASE_ERROR[result.reason]);
    await bump();
    setBusy(false);
  };

  const report = async () => {
    await repo.createReport(userId, 'pin', pin.id, '扱わない情報の疑い', nowMs());
    setError('通報を受け付けました');
  };

  return (
    <View style={styles.root}>
      <PinDetail
        pin={pin}
        now={now}
        origin={location.effective}
        available={balance.available}
        meId={userId}
        busy={busy}
        error={error}
        onBuy={buy}
        onClose={() => closeModal('/')}
        onReport={report}
        onOpenSeller={() => router.push({ pathname: '/user/[id]', params: { id: pin.sellerId } })}
        backLabel="閉じる"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 13, color: Colors.textSub, fontFamily: Fonts.sans },
});
