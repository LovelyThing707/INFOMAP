import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import MapCanvas from '@/components/map/MapCanvas';
import type { MapCameraTarget } from '@/components/map/types';
import { Banner, Button, Checkbox, ChoiceRow, Field, Input, KeyValue } from '@/components/ui';
import { AREA } from '@/config/area';
import { Colors, Fonts, MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import { DEFAULT_CATEGORY, FORBIDDEN_RULES } from '@/domain/catalog';
import {
  BOUNTY_EXPIRY_CHOICES_MIN,
  BOUNTY_RADIUS_CHOICES_M,
  feeFor,
  formatYen,
  isInsideArea,
  netFor,
  REWARD_CHOICES,
} from '@/domain/rules';
import type { LatLng } from '@/domain/types';
import { useUserLocation } from '@/hooks/use-location';
import { nowMs } from '@/lib/clock';
import { closeModal } from '@/lib/navigation';
import { repo, useSession } from '@/state/session';

export default function NewRequestScreen() {
  const userId = useSession((s) => s.userId);
  const balance = useSession((s) => s.balance);
  const bump = useSession((s) => s.bump);
  const location = useUserLocation();

  const [override, setOverride] = useState<LatLng | null>(null);
  const [radiusM, setRadiusM] = useState<number>(600);
  const [areaLabel, setAreaLabel] = useState('');
  const [targetText, setTargetText] = useState('');
  const [reward, setReward] = useState<number>(200);
  const [acceptCount, setAcceptCount] = useState<number>(1);
  const [ttl, setTtl] = useState<number>(60);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const point: LatLng | null = override ?? (location.resolved ? location.effective : null);
  const camera: MapCameraTarget | null = point ? { center: point, zoom: 15, nonce: 0 } : null;

  const total = reward * acceptCount;
  const inArea = point ? isInsideArea(point) : true;
  const enough = balance.available >= total;
  const ready = !!point && inArea && targetText.trim().length > 0 && agreed && enough;

  const submit = async () => {
    if (!point) return;
    setBusy(true);
    setError(null);
    const result = await repo.createBounty(
      {
        requesterId: userId,
        category: DEFAULT_CATEGORY,
        lat: point.lat,
        lng: point.lng,
        radiusM,
        areaLabel,
        targetText,
        reward,
        acceptCount,
        ttlMinutes: ttl,
      },
      nowMs()
    );
    setBusy(false);

    if (!result.ok) {
      setError(
        result.reason === 'insufficient_balance'
          ? '残高が足りません'
          : result.reason === 'outside_area'
            ? `${AREA.label}の範囲内でだけ依頼できます`
            : '入力が足りません'
      );
      return;
    }

    await bump();
    closeModal('/requests');
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Banner
        tone="brand"
        icon="information-circle"
        title="報酬は先に預かります"
        body="採用されたら報告者へ、採用されなかった分と期限切れ分はあなたへ戻ります"
      />

      <Field label="範囲" hint="地図をタップして中心を動かせます">
        <View style={styles.mapBox}>
          <MapCanvas
            initialCenter={AREA.center}
            initialZoom={15}
            markers={[]}
            rings={[
              { center: AREA.center, radiusM: AREA.radiusM },
              ...(point ? [{ center: point, radiusM, tone: 'bounty' as const }] : []),
            ]}
            draft={point}
            camera={camera}
            onMapPress={setOverride}
          />
        </View>
        <ChoiceRow
          options={BOUNTY_RADIUS_CHOICES_M.map((m) => ({ id: m, label: `${m}m` }))}
          value={radiusM}
          onChange={setRadiusM}
        />
        {!inArea ? <Text style={styles.errorText}>{AREA.label}の範囲外です</Text> : null}
        <Input value={areaLabel} onChangeText={setAreaLabel} placeholder="例: ラジオ会館まわり" />
      </Field>

      <Field label="確認してほしいこと" hint="写真で確かめられる形にすると成立しやすい">
        <Input
          value={targetText}
          onChangeText={setTargetText}
          placeholder="例: この辺の家電量販店に Switch2 の在庫があるか"
          multiline
        />
      </Field>

      <Field label="報酬">
        <ChoiceRow
          options={REWARD_CHOICES.map((v) => ({ id: v, label: formatYen(v) }))}
          value={reward}
          onChange={setReward}
        />
        <Input
          value={String(reward)}
          onChangeText={(v) => setReward(Number(v.replace(/[^0-9]/g, '')) || 0)}
          keyboardType="number-pad"
        />
      </Field>

      <Field label="採用する人数">
        <ChoiceRow
          options={[1, 2, 3].map((n) => ({ id: n, label: `${n}人` }))}
          value={acceptCount}
          onChange={setAcceptCount}
        />
      </Field>

      <Field label="期限">
        <ChoiceRow
          options={BOUNTY_EXPIRY_CHOICES_MIN.map((m) => ({ id: m, label: `${m}分` }))}
          value={ttl}
          onChange={setTtl}
        />
      </Field>

      <View style={styles.money}>
        <KeyValue label="いま預ける額" value={formatYen(total)} strong />
        <KeyValue label="採用時に報告者が受け取る額" value={formatYen(netFor(reward))} tone="money" />
        <KeyValue label="手数料 20%" value={`-${formatYen(feeFor(reward))}`} />
        <Text style={styles.moneyNote}>
          出金可能な残高 {formatYen(balance.available)}
          {!enough ? '（足りません）' : ''}
        </Text>
      </View>

      <Field label="扱わない情報">
        <View style={styles.rules}>
          {FORBIDDEN_RULES.map((rule) => (
            <View key={rule} style={styles.ruleItem}>
              <Ionicons name="close-circle" size={13} color={Colors.textFaint} />
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
        </View>
        <Checkbox
          checked={agreed}
          onToggle={() => setAgreed((v) => !v)}
          label="上のどれにも当てはまらない依頼です"
        />
      </Field>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Button
        label={busy ? '預けています…' : `${formatYen(total)}を預けて依頼する`}
        onPress={submit}
        disabled={!ready || busy}
      />
      <Button label="やめる" variant="ghost" onPress={() => closeModal('/requests')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.lg,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  mapBox: {
    height: 210,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  money: { backgroundColor: Colors.bgAlt, borderRadius: Radius.md, padding: Spacing.md },
  moneyNote: { fontSize: 11, color: Colors.textFaint, marginTop: 6, fontFamily: Fonts.sans },
  rules: { gap: 5 },
  ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ruleText: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  errorText: { fontSize: 13, color: Colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
});
