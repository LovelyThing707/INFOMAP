import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SellerLine } from '@/components/badges';
import { PageScroll } from '@/components/PageScroll';
import { BountyQuestions } from '@/components/bounty/BountyQuestions';
import MapCanvas from '@/components/map/MapCanvas';
import { Banner, Button, Card, Field, Input, Pill } from '@/components/ui';
import { Fonts, MAX_CONTENT_WIDTH, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import {
  bountyRemainingSlots,
  canApply,
  claimDeadline,
  distanceM,
  formatDistance,
  formatFreshness,
  formatRemaining,
  formatRemainingShort,
  formatStamp,
  formatYen,
  isBountyOpen,
  MAX_ACTIVE_CLAIMS,
  netFor,
  PROOF_RADIUS_M,
  reviewDeadline,
  storedProofFor,
} from '@/domain/rules';
import type { BountyApplication, BountyView, UserProfileView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useColors } from '@/hooks/use-colors';
import { useUserLocation } from '@/hooks/use-location';
import { useNow } from '@/hooks/use-now';
import { requireSignedIn } from '@/lib/auth-gate';
import { nowMs } from '@/lib/clock';
import { closeModal, dismissToTab } from '@/lib/navigation';
import { captureEvidence, type Evidence } from '@/lib/photo';
import { draftFromReport, useDraft } from '@/state/draft';
import { repo, useSession } from '@/state/session';

export default function RequestDetailScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const userId = useSession((s) => s.userId);
  const users = useSession((s) => s.users);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const setSellDraft = useDraft((s) => s.setSellDraft);
  const location = useUserLocation();
  const now = useNow(1000);

  const [reportText, setReportText] = useState('');
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { value: bounty } = useAsync<BountyView | null>(
    () => (id ? repo.getBounty(id, userId, nowMs()) : Promise.resolve(null)),
    [id, userId, revision],
    null
  );
  const { value: applications } = useAsync<BountyApplication[]>(
    () => (id ? repo.listApplications(id, userId) : Promise.resolve([])),
    [id, userId, revision],
    []
  );
  const { value: requester } = useAsync<UserProfileView | null>(
    () =>
      bounty ? repo.getUserProfile(bounty.requesterId, nowMs(), userId) : Promise.resolve(null),
    [bounty?.requesterId, userId, revision],
    null
  );

  if (!bounty) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>依頼が見つかりません</Text>
      </View>
    );
  }

  const isRequester = bounty.requesterId === userId;
  const open = isBountyOpen(bounty, now);
  const mine = bounty.myApplication;
  const away = distanceM(location.effective, { lat: bounty.lat, lng: bounty.lng });
  const handleOf = (uid: string) => users.find((u) => u.id === uid);
  const applicable = !isRequester && !mine && canApply(bounty, mine, userId, now);

  const openQuestions = () => {
    router.push({ pathname: '/request-questions/[id]', params: { id: bounty.id } });
  };

  const apply = async () => {
    if (!requireSignedIn()) return;
    setBusy(true);
    setError(null);
    const result = await repo.applyToBounty(bounty.id, userId, away, nowMs());
    if (!result.ok) {
      setError(
        result.reason === 'too_many'
          ? `同時に応募できるのは${MAX_ACTIVE_CLAIMS}件までです`
          : result.reason === 'closed'
            ? 'もう締め切られています'
            : '応募できませんでした'
      );
    }
    await bump();
    setBusy(false);
  };

  const sendReport = async () => {
    if (!mine || !evidence) return;
    setBusy(true);
    setError(null);
    const result = await repo.reportToBounty(
      mine.id,
      userId,
      {
        text: reportText,
        photoUri: evidence.uri,
        proof: storedProofFor(evidence.proof, { lat: bounty.lat, lng: bounty.lng }),
      },
      nowMs()
    );
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === 'photo_required'
          ? '写真がないと報告できません'
          : result.reason === 'closed'
            ? 'この依頼はもう締め切られています'
            : '報告できませんでした'
      );
      return;
    }
    setReportText('');
    setEvidence(null);
    await bump();
  };

  const decide = async (applicationId: string, accept: boolean) => {
    setBusy(true);
    await repo.decideApplication(applicationId, userId, accept, nowMs());
    await bump();
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    await repo.cancelBounty(bounty.id, userId, nowMs());
    await bump();
    setBusy(false);
    closeModal('/requests');
  };

  const resell = (application: BountyApplication) => {
    setSellDraft(
      draftFromReport(
        { lat: bounty.lat, lng: bounty.lng },
        bounty.areaLabel,
        bounty.targetText,
        application.reportText ?? '',
        application.photoUri,
        application.proof
      )
    );
    dismissToTab('/sell');
  };

  return (
    <View style={styles.screen}>
      <PageScroll
        contentContainerStyle={[
          styles.content,
          { paddingBottom: applicable ? 28 + insets.bottom + 88 : 48 },
        ]}>
        <View style={styles.mapBox}>
          <MapCanvas
            initialCenter={{ lat: bounty.lat, lng: bounty.lng }}
            initialZoom={14}
            markers={[
              {
                id: bounty.id,
                kind: 'bounty',
                lat: bounty.lat,
                lng: bounty.lng,
                price: formatYen(bounty.reward),
                time: open ? formatRemainingShort(Math.max(0, bounty.expiresAt - now)) : null,
                badge: bounty.headingCount > 0 ? `${bounty.headingCount}人` : null,
                tone: open ? 'fresh' : 'dead',
                selected: true,
              },
            ]}
            rings={[{ center: { lat: bounty.lat, lng: bounty.lng }, radiusM: bounty.radiusM, tone: 'bounty' }]}
            attributionInset={6}
            interactive={false}
          />
          <View style={styles.mapShield} />
        </View>

        <SellerLine
          emoji={bounty.requesterEmoji}
          handle={bounty.requesterHandle}
          score={requester?.score ?? null}
          deals={(requester?.hitCount ?? 0) + (requester?.missCount ?? 0)}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: bounty.requesterId } })}
        />
        {requester && requester.acceptedReportCount > 0 ? (
          <Text style={styles.requesterNote}>
            依頼の報告が {requester.acceptedReportCount}件 採用されています
          </Text>
        ) : null}

        <Text style={styles.target}>{bounty.targetText}</Text>

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {formatFreshness(Math.max(0, now - bounty.createdAt))}の依頼
            {'  '}
            {formatStamp(bounty.createdAt, now)}
          </Text>
        </View>

        <View style={styles.badges}>
          {open ? (
            <Pill tone="brand">残り{formatRemaining(bounty.expiresAt - now)}</Pill>
          ) : (
            <Pill tone="dead">
              {bounty.status === 'filled'
                ? '成立済み'
                : bounty.status === 'cancelled'
                  ? '取り下げ'
                  : '期限切れ'}
            </Pill>
          )}
          <Pill tone={bounty.headingCount >= 3 ? 'warn' : 'neutral'}>
            向かっている {bounty.headingCount}人
          </Pill>
          <Pill tone="neutral">採用枠 {bountyRemainingSlots(bounty)}</Pill>
        </View>

        <View style={styles.placeRow}>
          <Ionicons name="locate-outline" size={14} color={colors.textFaint} />
          <Text style={styles.place}>
            {bounty.areaLabel}・半径{bounty.radiusM}m
          </Text>
        </View>

        <View style={styles.terms}>
          <Term label="報告の締め切り" value={`${formatStamp(bounty.expiresAt, now)} まで`} />
          {bounty.placeHint ? <Term label="対象の場所" value={bounty.placeHint} /> : null}
          {bounty.photoWanted ? <Term label="欲しい写真" value={bounty.photoWanted} /> : null}
          <Term
            label="無かった場合"
            value={bounty.payIfAbsent ? '報酬を出す' : '有った場合のみ'}
            tone={bounty.payIfAbsent ? colors.money : colors.warn}
          />
        </View>

        {bounty.headingCount >= 3 && !isRequester && !mine ? (
          <Banner
            tone="warn"
            icon="people"
            title={`すでに${bounty.headingCount}人が向かっています`}
            body={`採用枠は${bountyRemainingSlots(bounty)}人分です。間に合わない可能性があります`}
          />
        ) : null}

        {error && !mine ? <Text style={styles.errorText}>{error}</Text> : null}

        {!isRequester && mine?.status === 'heading' ? (
          <Text style={styles.muted}>
            報告がないまま{formatRemaining(Math.max(0, claimDeadline(mine) - now))}経つと、
            この応募は自動的に取り下げられます
          </Text>
        ) : null}

        {!isRequester && mine?.status === 'heading' ? (
          <Card style={styles.reportCard}>
            <Text style={styles.cardTitle}>現地から報告する</Text>
            <Field label="写真" hint="必須。依頼の範囲内で撮ると自動で採用されます">
              {evidence ? (
                <Image source={{ uri: evidence.uri }} style={styles.photo} contentFit="cover" />
              ) : (
                <View style={styles.photoEmpty}>
                  <Ionicons name="camera-outline" size={24} color={colors.textFaint} />
                </View>
              )}
              <Text style={styles.muted}>
                アルバムからは選べません。範囲の外で撮ったものは自動採用の対象外になり、依頼者の判断待ちになります
              </Text>
              <Button
                label={evidence ? '撮り直す' : 'その場で撮る'}
                variant="secondary"
                onPress={async () => setEvidence((await captureEvidence()) ?? evidence)}
              />
            </Field>
            <Field label="見てきた内容">
              <Input
                value={reportText}
                onChangeText={setReportText}
                placeholder="例: 3Fの該当ブース、再入荷して棚に並んでいました。残り4点です"
                multiline
              />
            </Field>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Button
              label={busy ? '送っています…' : '報告する'}
              onPress={sendReport}
              disabled={busy || !evidence}
            />
          </Card>
        ) : null}

        {!isRequester && mine?.status === 'reported' ? (
          <Banner
            tone="brand"
            icon="hourglass"
            title="報告を送りました"
            body={
              reviewDeadline(mine)
                ? `依頼者の確認待ちです。${formatRemaining(Math.max(0, reviewDeadline(mine)! - now))}で自動的に採用されます`
                : '依頼者の確認待ちです'
            }
          />
        ) : null}

        {!isRequester && mine?.status === 'accepted' ? (
          <>
            <Banner
              tone="money"
              icon="checkmark-circle"
              title={`採用されました（${formatYen(netFor(bounty.reward))}）`}
              body="手数料20%を引いた額が残高に入っています"
            />
            <Button
              label="この情報を売りに出す"
              variant="secondary"
              onPress={() => resell(mine)}
              hint="報告した内容を出品フォームに引き継ぎます"
            />
          </>
        ) : null}

        <BountyQuestions
          bounty={bounty}
          now={now}
          userId={userId}
          isRequester={isRequester}
          limit={3}
          onSeeAll={openQuestions}
          onAsk={async (body) => {
            if (!requireSignedIn()) return;
            await repo.askQuestion(bounty.id, body, userId, nowMs());
            await bump();
          }}
          onAnswer={async (questionId, text) => {
            await repo.answerQuestion(questionId, userId, text, nowMs());
            await bump();
          }}
        />

        {isRequester ? (
          <View style={styles.applications}>
            <Text style={styles.sectionTitle}>応募と報告（{applications.length}）</Text>
            {applications.length === 0 ? (
              <Text style={styles.muted}>まだ誰も向かっていません</Text>
            ) : (
              applications.map((app) => {
                const user = handleOf(app.applicantId);
                const deadline = reviewDeadline(app);
                return (
                  <Card key={app.id} style={styles.appCard}>
                    <View style={styles.appHead}>
                      <PersonRow
                        emoji={user?.emoji ?? '❔'}
                        name={user?.handle ?? '不明'}
                        userId={app.applicantId}
                      />
                      <StatusPill status={app.status} />
                    </View>

                    {app.status === 'reported' || app.status === 'accepted' ? (
                      <>
                        {app.photoUri ? (
                          <Image
                            source={{ uri: app.photoUri }}
                            style={styles.photo}
                            contentFit="cover"
                          />
                        ) : null}
                        <CaptureLine app={app} bounty={bounty} />
                        {app.reportText ? (
                          <Text style={styles.reportText}>{app.reportText}</Text>
                        ) : null}
                      </>
                    ) : null}

                    {app.status === 'reported' ? (
                      <>
                        <Text style={styles.muted}>
                          {deadline && deadline > now
                            ? `${formatRemaining(deadline - now)}で自動採用されます`
                            : 'まもなく自動採用されます'}
                        </Text>
                        <View style={styles.decideRow}>
                          <Button
                            label={`採用（${formatYen(bounty.reward)}）`}
                            style={styles.flex}
                            onPress={() => decide(app.id, true)}
                            disabled={busy}
                          />
                          <Button
                            label="不採用"
                            variant="danger"
                            style={styles.flex}
                            onPress={() => decide(app.id, false)}
                            disabled={busy}
                          />
                        </View>
                      </>
                    ) : null}
                  </Card>
                );
              })
            )}

            {open && bounty.acceptedCount === 0 ? (
              <Button
                label="依頼を取り下げる"
                variant="ghost"
                onPress={cancel}
                disabled={busy}
                hint={`預けた ${formatYen(bounty.reward * bounty.acceptCount)} が戻ります`}
              />
            ) : null}
          </View>
        ) : null}

        <Button label="閉じる" variant="ghost" onPress={() => closeModal('/requests')} />
      </PageScroll>

      {applicable ? (
        <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.stickyPriceBox}>
            <Text style={styles.stickyPrice}>{formatYen(bounty.reward)}</Text>
            <Text style={styles.stickyHint}>
              {bounty.acceptCount > 1 ? `×${bounty.acceptCount}人  ` : ''}
              いまいる場所（{formatDistance(away)}）が記録されます
            </Text>
          </View>
          <Pressable
            onPress={apply}
            disabled={busy}
            style={({ pressed }) => [
              styles.stickyCta,
              pressed && styles.stickyCtaPressed,
              busy && styles.stickyCtaDisabled,
            ]}>
            <Text style={styles.stickyCtaText}>{busy ? '…' : '向かう'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Term({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{label}</Text>
      <Text style={[styles.termValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function PersonRow({ emoji, name, userId }: { emoji: string; name: string; userId: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })}
      style={({ pressed }) => [styles.personRow, pressed && styles.personRowPressed]}>
      <Text style={styles.personName}>
        {emoji} {name}
      </Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

function CaptureLine({ app, bounty }: { app: BountyApplication; bounty: BountyView }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!app.proof) {
    return (
      <View style={styles.captureRow}>
        <Ionicons name="help-circle" size={14} color={colors.danger} />
        <Text style={[styles.captureText, { color: colors.danger }]}>
          撮影の記録なし。自動採用の対象外です
        </Text>
      </View>
    );
  }
  if (app.proof.mocked) {
    return (
      <View style={styles.captureRow}>
        <Ionicons name="warning" size={14} color={colors.danger} />
        <Text style={[styles.captureText, { color: colors.danger }]}>
          端末が位置の偽装を申告しています。自動採用の対象外です
        </Text>
      </View>
    );
  }
  const away = app.proof.distanceM;
  const inside = away <= bounty.radiusM + PROOF_RADIUS_M;
  return (
    <View style={styles.captureRow}>
      <Ionicons
        name={inside ? 'shield-checkmark' : 'alert-circle'}
        size={14}
        color={inside ? colors.money : colors.warn}
      />
      <Text style={[styles.captureText, { color: inside ? colors.money : colors.warn }]}>
        {inside
          ? `依頼した範囲の中で撮影・中心から${formatDistance(away)}`
          : `範囲の外で撮影・中心から${formatDistance(away)}`}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { status: BountyApplication['status'] }) {
  switch (status) {
    case 'heading':
      return <Pill tone="brand">向かっている</Pill>;
    case 'reported':
      return <Pill tone="warn">報告あり</Pill>;
    case 'accepted':
      return <Pill tone="money">採用</Pill>;
    case 'rejected':
      return <Pill tone="danger">不採用</Pill>;
    default:
      return <Pill tone="dead">期限切れ</Pill>;
  }
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, minHeight: 0, backgroundColor: colors.bg },
    mapShield: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 2,
    },
    content: {
      padding: Spacing.lg,
      gap: Spacing.md,
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    mapBox: {
      position: 'relative',
      height: 200,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },

    target: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 28,
      fontFamily: Fonts.sans,
    },
    requesterNote: { fontSize: 12, color: colors.textSub, marginTop: -6, fontFamily: Fonts.sans },
    meta: { marginTop: -4 },
    metaText: { fontSize: 12, color: colors.textFaint, fontFamily: Fonts.sans },

    badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    place: { flex: 1, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },

    reportCard: { gap: Spacing.md, padding: Spacing.md },
    cardTitle: { fontSize: 15, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
    photo: { width: '100%', aspectRatio: 3 / 2, borderRadius: Radius.md, backgroundColor: colors.bgAlt },
    photoEmpty: {
      width: '100%',
      aspectRatio: 3 / 2,
      borderRadius: Radius.md,
      backgroundColor: colors.bgAlt,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flex: { flex: 1 },

    applications: { gap: Spacing.sm },
    sectionTitle: { fontSize: 13, fontWeight: '800', color: colors.textSub, fontFamily: Fonts.sans },
    appCard: { gap: Spacing.sm, padding: Spacing.md },
    appHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

    personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
    personRowPressed: { opacity: 0.55 },
    personName: { fontSize: 14, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },

    terms: {
      backgroundColor: colors.bgAlt,
      borderRadius: Radius.md,
      padding: Spacing.md,
      gap: 4,
    },
    termRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
    termLabel: { width: 92, fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
    termValue: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 19,
      fontFamily: Fonts.sans,
    },

    reportText: { fontSize: 14, color: colors.text, lineHeight: 21, fontFamily: Fonts.sans },
    captureRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    captureText: { flex: 1, fontSize: 11, fontWeight: '700', fontFamily: Fonts.sans },
    decideRow: { flexDirection: 'row', gap: Spacing.sm },

    muted: { fontSize: 12, color: colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
    errorText: { fontSize: 13, color: colors.danger, fontWeight: '600', fontFamily: Fonts.sans },

    sticky: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingTop: 12,
      backgroundColor: colors.bg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    stickyPriceBox: { flex: 1, gap: 2 },
    stickyPrice: { fontSize: 22, fontWeight: '800', color: colors.money, fontFamily: Fonts.sans },
    stickyHint: { fontSize: 11, color: colors.textFaint, fontFamily: Fonts.sans },
    stickyCta: {
      backgroundColor: colors.brand,
      borderRadius: Radius.pill,
      paddingHorizontal: 22,
      paddingVertical: 12,
      minWidth: 108,
      alignItems: 'center',
    },
    stickyCtaPressed: { opacity: 0.85 },
    stickyCtaDisabled: { opacity: 0.5 },
    stickyCtaText: { color: colors.onBrand, fontSize: 16, fontWeight: '800', fontFamily: Fonts.sans },
  });
}
