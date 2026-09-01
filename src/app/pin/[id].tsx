import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PinDetail } from '@/components/sheet/PinDetail';
import { Fonts, type ThemeColors } from '@/constants/theme';
import type { PurchaseFailure, ReportResultKind } from '@/data/repository';
import type { ReportReason } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { requireSignedIn } from '@/lib/auth-gate';
import { closeModal } from '@/lib/navigation';
import { repo, useSession } from '@/state/session';

const REPORT_MESSAGE: Record<ReportResultKind, string> = {
  recorded: '通報を受け付けました',
  already: 'この出品はすでに通報済みです',
  voided: '通報が規定数に達したため、この出品を取り下げました',
};

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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
    if (!requireSignedIn()) return;
    setBusy(true);
    setError(null);
    const result = await repo.purchase(pin.id, userId, nowMs());
    if (!result.ok) setError(PURCHASE_ERROR[result.reason]);
    await bump();
    setBusy(false);
  };

  const report = async (reason: ReportReason) => {
    if (!requireSignedIn()) return;
    const result = await repo.createReport(userId, 'pin', pin.id, reason, nowMs());
    await bump();
    setError(REPORT_MESSAGE[result]);
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { fontSize: 13, color: colors.textSub, fontFamily: Fonts.sans },
  });
}
