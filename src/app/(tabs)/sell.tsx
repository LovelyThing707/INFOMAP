import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthGate } from '@/components/AuthGate';
import { Screen } from '@/components/Screen';
import MapCanvas from '@/components/map/MapCanvas';
import type { MapCameraTarget } from '@/components/map/types';
import {
  Banner,
  Button,
  Checkbox,
  ChoiceRow,
  Field,
  Input,
  KeyValue,
  Pill,
} from '@/components/ui';
import { AREA } from '@/config/area';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { DEFAULT_CATEGORY, FORBIDDEN_RULES, STOCK_STATES } from '@/domain/catalog';
import {
  EXPIRY_CHOICES_MIN,
  feeFor,
  formatRemaining,
  formatYen,
  isInsideArea,
  isRestricted,
  netFor,
  OPEN_ENDED_TTL,
  PRICE_CHOICES,
  proofLevelOfStored,
  SLOT_CHOICES,
  storedProofFor,
  type PinTtlChoice,
} from '@/domain/rules';
import type { LatLng, ProofLevel, StockState, StoredProof } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { captureEvidence, type Evidence } from '@/lib/photo';
import { useDraft } from '@/state/draft';
import { repo, useSession } from '@/state/session';

export default function SellScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = useSession((s) => s.userId);
  const signedIn = useSession((s) => s.signedIn);
  const me = useSession((s) => s.me);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const location = useUserLocation();
  const now = useNow(15000);

  // 位置は「現在地」を既定にし、ユーザーが動かしたときだけ上書きを持つ。
  // 副作用で初期値を流し込むと、描画のたびに state を書き戻すことになる
  const [override, setOverride] = useState<LatLng | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [placeLabel, setPlaceLabel] = useState('');
  const [headline, setHeadline] = useState('');
  const [stockState, setStockState] = useState<StockState>('in_stock');
  const [quantityNote, setQuantityNote] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  /**
   * 懸賞の報告から引き継いだ裏づけ。
   * あちらは依頼の中心からの距離として保存されているので、座標には戻せない。
   * 同じ地点にピンを立てる限りそのまま使える。撮り直したら捨てる。
   */
  const [carriedProof, setCarriedProof] = useState<StoredProof | null>(null);
  const [ttl, setTtl] = useState<PinTtlChoice>(30);
  const [slots, setSlots] = useState<number>(2);
  const [price, setPrice] = useState<number>(200);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ headline: string; expiresAt: number | null } | null>(
    null
  );

  const { value: lastPin } = useAsync(
    () => (signedIn ? repo.lastPinOf(userId) : Promise.resolve(null)),
    [userId, revision, signedIn],
    null
  );

  const sellDraft = useDraft((s) => s.sellDraft);
  const clearSellDraft = useDraft((s) => s.clearSellDraft);

  // 開いた時点で位置は現在地に決まっている。フォームを上から埋めさせている間に情報が腐る
  const point: LatLng | null = override ?? (location.resolved ? location.effective : null);
  const camera: MapCameraTarget | null = point
    ? { center: point, zoom: 17, nonce: recenter }
    : null;

  // 採用された懸賞の報告から流れてきた下書きを、外部ストアからフォームへ移す。
  // 外部の状態変化を React 側へ取り込む用途なので、ここは効果の中で state を書いてよい
  useEffect(() => {
    if (!sellDraft) return;
    if (sellDraft.lat !== undefined && sellDraft.lng !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverride({ lat: sellDraft.lat, lng: sellDraft.lng });
      setRecenter((n) => n + 1);
    }
    if (sellDraft.placeLabel) setPlaceLabel(sellDraft.placeLabel);
    if (sellDraft.headline) setHeadline(sellDraft.headline);
    if (sellDraft.stockState) setStockState(sellDraft.stockState);
    if (sellDraft.quantityNote) setQuantityNote(sellDraft.quantityNote);
    if (sellDraft.payloadText) setPayloadText(sellDraft.payloadText);
    // 懸賞の報告から持ち込むときは、報告時の撮影記録をそのまま引き継ぐ
    if (sellDraft.photoUri) {
      setEvidence({ uri: sellDraft.photoUri, proof: null });
      setCarriedProof(sellDraft.proof ?? null);
    }
    clearSellDraft();
  }, [sellDraft, clearSellDraft]);

  const restricted = me ? isRestricted(me, now) : false;
  const inArea = point ? isInsideArea(point) : true;
  const fee = feeFor(price);
  const net = netFor(price);

  /**
   * 保存する形の裏づけ。ここで座標を距離へ落として捨てる。
   * サーバーへ渡るのもこの形なので、緯度経度は端末の外に出ない。
   */
  const proof: StoredProof | null = point
    ? (storedProofFor(evidence?.proof ?? null, point) ?? carriedProof)
    : null;

  const proofLevel = proofLevelOfStored(proof, nowMs());

  const ready =
    !!point &&
    inArea &&
    !!evidence &&
    headline.trim().length > 0 &&
    payloadText.trim().length > 0 &&
    agreed &&
    !restricted;

  const applyLastPin = useCallback(() => {
    if (!lastPin) return;
    setOverride({ lat: lastPin.lat, lng: lastPin.lng });
    setRecenter((n) => n + 1);
    setPlaceLabel(lastPin.placeLabel);
    setHeadline(lastPin.headline);
    setStockState(lastPin.stockState);
    setQuantityNote(lastPin.quantityNote ?? '');
    setPayloadText(lastPin.payloadText);
    setPrice(lastPin.price);
    setSlots(lastPin.slotTotal);
    setPosted(null);
  }, [lastPin]);

  const reset = () => {
    setHeadline('');
    setPayloadText('');
    setQuantityNote('');
    setEvidence(null);
    setAgreed(false);
    setError(null);
  };

  const submit = async () => {
    if (!point || !evidence) return;
    setBusy(true);
    setError(null);

    // 保存に失敗したまま画面が進むと、リロードで出品が消える。
    // 握りつぶさずに、出し直せることを伝える
    const result = await repo
      .createPin(
        {
          sellerId: userId,
          category: DEFAULT_CATEGORY,
          lat: point.lat,
          lng: point.lng,
          placeLabel,
          headline,
          stockState,
          payloadText,
          quantityNote: quantityNote.trim() || null,
          photoUri: evidence.uri,
          proof,
          price,
          slotTotal: slots,
          ttlMinutes: ttl === OPEN_ENDED_TTL ? null : ttl,
        },
        nowMs()
      )
      .catch(() => 'save_failed' as const);
    setBusy(false);

    if (result === 'save_failed') {
      setError(
        '端末の保存領域がいっぱいで、出品を保存できませんでした。マイページで使用量を確認してください'
      );
      return;
    }

    if (!result.ok) {
      setError(
        result.reason === 'restricted'
          ? '情報が違っていたという申告が続いたため、いまは出品できません'
          : result.reason === 'outside_area'
            ? `${AREA.label}の範囲内でだけ出品できます`
            : '入力が足りません'
      );
      return;
    }

    setPosted({ headline: result.pin.headline, expiresAt: result.pin.expiresAt });
    reset();
    await bump();
  };

  const priceOptions = useMemo(
    () => PRICE_CHOICES.map((value) => ({ id: value, label: formatYen(value) })),
    []
  );

  if (!signedIn) {
    return (
      <AuthGate
        title="いまの状態を売る"
        body="現場の写真を出して売るには、ログインが必要です。地図を見るだけならログインは要りません"
      />
    );
  }

  return (
    <Screen
      title="いまの状態を売る"
      subtitle="現場にいるうちに出す。列は短く切る。掘り出しは無期限にして、無くなったら止める">
      {restricted && me?.restrictedUntil ? (
        <Banner
          tone="danger"
          icon="alert-circle"
          title="いまは出品できません"
          body={`情報が違っていたという申告が続いたため、${new Date(me.restrictedUntil).toLocaleString('ja-JP')}まで出品を止めています。理由と解除条件はマイページで確認できます`}
        />
      ) : null}

      {posted ? (
        <Banner
          tone="money"
          icon="checkmark-circle"
          title={`出しました：${posted.headline}`}
          body={
            posted.expiresAt === null
              ? '出品者が止めるまで地図に残ります。鮮度は撮影時刻で出します'
              : `${formatRemaining(posted.expiresAt - now)}後に地図から消えます`
          }
        />
      ) : null}

      {lastPin ? (
        <Pressable style={styles.repost} onPress={applyLastPin}>
          <Ionicons name="repeat" size={16} color={colors.brand} />
          <Text style={styles.repostText} numberOfLines={1}>
            もう一度出す：{lastPin.headline}
          </Text>
        </Pressable>
      ) : null}

      <Field label="場所" hint="地図をタップして微調整できます">
        <View style={styles.mapBox}>
          <MapCanvas
            initialCenter={AREA.center}
            initialZoom={17}
            markers={[]}
            rings={[{ center: AREA.center, radiusM: AREA.radiusM }]}
            draft={point}
            camera={camera}
            onMapPress={setOverride}
          />
        </View>
        {!inArea ? (
          <Text style={styles.errorText}>
            {AREA.label}の範囲外です。MVPはこのエリアだけを対象にしています
          </Text>
        ) : null}
        <Input value={placeLabel} onChangeText={setPlaceLabel} placeholder="例: ヨドバシAkiba 7F" />
      </Field>

      <Field label="何の情報か" hint="ここは買う前の人にも見えます">
        <View style={styles.categoryRow}>
          <Pill tone="brand">店頭の在庫</Pill>
          <Text style={styles.categoryNote}>MVPはこのカテゴリだけ</Text>
        </View>
        <Input
          value={headline}
          onChangeText={setHeadline}
          placeholder="例: Switch2 本体の在庫"
          maxLength={40}
        />
      </Field>

      <Field label="今の状態" hint="ここから先は買った人だけに届きます">
        <ChoiceRow
          options={STOCK_STATES.map((s) => ({ id: s.id, label: s.label }))}
          value={stockState}
          onChange={setStockState}
        />
        <Input
          value={quantityNote}
          onChangeText={setQuantityNote}
          placeholder="残数など（例: 残り3台）"
          maxLength={20}
        />
      </Field>

      <Field label="写真" hint="必須。その場で撮ったものだけ">
        {evidence ? (
          <View>
            <Image source={{ uri: evidence.uri }} style={styles.photo} contentFit="cover" />
            <Pressable
              style={styles.photoClear}
              onPress={() => {
                setEvidence(null);
                setCarriedProof(null);
              }}>
              <Ionicons name="close" size={15} color={colors.onBrand} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.photoEmpty}>
            <Ionicons name="camera-outline" size={26} color={colors.textFaint} />
            <Text style={styles.photoEmptyText}>棚や店頭がわかる1枚</Text>
          </View>
        )}

        {evidence ? (
          <ProofNote level={proofLevel} />
        ) : (
          <Text style={styles.photoHint}>
            アルバムからは選べません。撮った位置と時刻を一緒に記録して、買う人に見せます
          </Text>
        )}

        <Button
          label={evidence ? '撮り直す' : 'その場で撮る'}
          variant="secondary"
          onPress={async () => {
            const next = await captureEvidence();
            if (!next) return;
            // 撮り直したら、引き継いだ裏づけは自分のものではなくなる
            setEvidence(next);
            setCarriedProof(null);
          }}
        />
      </Field>

      <Field label="買った人に見せる内容" hint="どの棚か、条件は何か">
        <Input
          value={payloadText}
          onChangeText={setPayloadText}
          placeholder="例: 7F ゲームコーナーのレジ横、展示台の下に3箱。整理券なしで買えた"
          multiline
        />
      </Field>

      <Field
        label="掲載の長さ"
        hint="列やゲリラ入荷は短く。掘り出し・残サイズ・定価枠は無期限にして、無くなったら自分で止める">
        <ChoiceRow
          options={[
            ...EXPIRY_CHOICES_MIN.map((m) => ({ id: m as PinTtlChoice, label: `${m}分` })),
            { id: OPEN_ENDED_TTL, label: '無期限' },
          ]}
          value={ttl}
          onChange={setTtl}
        />
      </Field>

      <Field label="売れる人数" hint="先着。埋まったら終わり">
        <ChoiceRow
          options={SLOT_CHOICES.map((n) => ({ id: n, label: `${n}人` }))}
          value={slots}
          onChange={setSlots}
        />
      </Field>

      <Field label="価格">
        <ChoiceRow options={priceOptions} value={price} onChange={setPrice} />
        <Input
          value={String(price)}
          onChangeText={(v) => setPrice(Number(v.replace(/[^0-9]/g, '')) || 0)}
          keyboardType="number-pad"
          placeholder="自由入力"
        />
        <View style={styles.money}>
          <KeyValue label="情報料" value={formatYen(price)} />
          <KeyValue label="手数料 20%" value={`-${formatYen(fee)}`} />
          <KeyValue label="あなたの取り分" value={formatYen(net)} tone="money" strong />
          <Text style={styles.moneyNote}>
            全員に売れた場合は最大 {formatYen(net * slots)}。確定は買い手の判定か猶予経過のあとです
          </Text>
        </View>
      </Field>

      <Field label="扱わない情報">
        <View style={styles.rules}>
          {FORBIDDEN_RULES.map((rule) => (
            <View key={rule} style={styles.ruleItem}>
              <Ionicons name="close-circle" size={13} color={colors.textFaint} />
              <Text style={styles.ruleText}>{rule}</Text>
            </View>
          ))}
        </View>
        <Checkbox
          checked={agreed}
          onToggle={() => setAgreed((v) => !v)}
          label="上のどれにも当てはまらないことを確認しました"
        />
      </Field>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Button
        label={busy ? '出しています…' : '出す'}
        hint={
          ready
            ? `${ttl === OPEN_ENDED_TTL ? '無期限' : `${ttl}分間`}・先着${slots}人・${formatYen(price)}`
            : undefined
        }
        onPress={submit}
        disabled={!ready || busy}
      />

      {posted ? (
        <Button label="地図で確認する" variant="secondary" onPress={() => router.navigate('/')} />
      ) : null}
    </Screen>
  );
}

/** 出品する前に、自分の写真がどう見られるかを見せる */
function ProofNote({ level }: { level: ProofLevel }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (level === 'onsite') {
    return (
      <View style={styles.proofRow}>
        <Ionicons name="shield-checkmark" size={15} color={colors.money} />
        <Text style={[styles.proofText, { color: colors.money }]}>
          現場で撮影された記録が付きました。買う人にもこの表示が出ます
        </Text>
      </View>
    );
  }
  if (level === 'offsite') {
    return (
      <View style={styles.proofRow}>
        <Ionicons name="alert-circle" size={15} color={colors.warn} />
        <Text style={[styles.proofText, { color: colors.warn }]}>
          撮影地点がピンから離れています。このままでも出せますが、買う人には注意が出ます
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.proofRow}>
      <Ionicons name="help-circle" size={15} color={colors.danger} />
      <Text style={[styles.proofText, { color: colors.danger }]}>
        位置の記録が付いていません。「撮影の記録なし」として売られます
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    repost: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.brandSoft,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 11,
    },
    repostText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: colors.brand,
      fontFamily: Fonts.sans,
    },

    mapBox: {
      height: 200,
      borderRadius: Radius.md,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },

    categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    categoryNote: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },

    photo: { width: '100%', aspectRatio: 3 / 2, borderRadius: Radius.md, backgroundColor: colors.bgAlt },
    photoClear: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoEmpty: {
      width: '100%',
      aspectRatio: 3 / 2,
      borderRadius: Radius.md,
      backgroundColor: colors.bgAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    photoEmptyText: { fontSize: 12, color: colors.textFaint, fontFamily: Fonts.sans },
    photoHint: { fontSize: 11, color: colors.textFaint, lineHeight: 17, fontFamily: Fonts.sans },
    proofRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    proofText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 18, fontFamily: Fonts.sans },

    money: {
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.md,
      padding: Spacing.md,
    },
    moneyNote: {
      fontSize: 11,
      color: colors.textFaint,
      marginTop: 6,
      lineHeight: 16,
      fontFamily: Fonts.sans,
    },

    rules: { gap: 5 },
    ruleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ruleText: { flex: 1, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },

    errorText: { fontSize: 13, color: colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
  });
}
