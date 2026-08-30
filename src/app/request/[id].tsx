import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/badges';
import { Banner, Button, Card, Field, Input, Pill } from '@/components/ui';
import { Colors, Fonts, MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import {
  bountyRemainingSlots,
  canApply,
  formatRemaining,
  formatYen,
  isBountyOpen,
  netFor,
  reviewDeadline,
} from '@/domain/rules';
import type { BountyApplication, BountyView } from '@/domain/types';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { nowMs } from '@/lib/clock';
import { closeModal, dismissToTab } from '@/lib/navigation';
import { pickPhoto, placeholderPhoto, takePhoto } from '@/lib/photo';
import { draftFromReport, useDraft } from '@/state/draft';
import { repo, useSession } from '@/state/session';

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useSession((s) => s.userId);
  const users = useSession((s) => s.users);
  const revision = useSession((s) => s.revision);
  const bump = useSession((s) => s.bump);
  const setSellDraft = useDraft((s) => s.setSellDraft);
  const now = useNow(1000);

  const [reportText, setReportText] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { value: bounty } = useAsync<BountyView | null>(
    () => (id ? repo.getBounty(id, userId, nowMs()) : Promise.resolve(null)),
    [id, userId, revision],
    null
  );
  const { value: applications } = useAsync<BountyApplication[]>(
    () => (id ? repo.listApplications(id) : Promise.resolve([])),
    [id, revision],
    []
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
  const handleOf = (uid: string) => users.find((u) => u.id === uid);

  const apply = async () => {
    setBusy(true);
    await repo.applyToBounty(bounty.id, userId, nowMs());
    await bump();
    setBusy(false);
  };

  const sendReport = async () => {
    if (!mine || !photoUri) return;
    setBusy(true);
    setError(null);
    const result = await repo.reportToBounty(mine.id, { text: reportText, photoUri }, nowMs());
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
    setPhotoUri(null);
    await bump();
  };

  const decide = async (applicationId: string, accept: boolean) => {
    setBusy(true);
    await repo.decideApplication(applicationId, accept, nowMs());
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
        application.photoUri
      )
    );
    dismissToTab('/sell');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Text style={styles.target}>{bounty.targetText}</Text>
        <View style={styles.rewardBox}>
          <Text style={styles.reward}>{formatYen(bounty.reward)}</Text>
          {bounty.acceptCount > 1 ? (
            <Text style={styles.rewardSub}>×{bounty.acceptCount}人</Text>
          ) : null}
        </View>
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
        <Ionicons name="locate-outline" size={14} color={Colors.textFaint} />
        <Text style={styles.place}>
          {bounty.areaLabel}・半径{bounty.radiusM}m
        </Text>
      </View>

      <PersonRow
        emoji={bounty.requesterEmoji}
        name={bounty.requesterHandle}
        role="依頼者"
        userId={bounty.requesterId}
      />

      {bounty.headingCount >= 3 && !isRequester && !mine ? (
        <Banner
          tone="warn"
          icon="people"
          title={`すでに${bounty.headingCount}人が向かっています`}
          body={`採用枠は${bountyRemainingSlots(bounty)}人分です。間に合わない可能性があります`}
        />
      ) : null}

      {!isRequester && !mine && canApply(bounty, mine, userId, now) ? (
        <Button
          label="向かう"
          onPress={apply}
          disabled={busy}
          hint="応募すると、向かっている人数に加算されます"
        />
      ) : null}

      {!isRequester && mine?.status === 'heading' ? (
        <Card style={styles.reportCard}>
          <Text style={styles.cardTitle}>現地から報告する</Text>
          <Field label="写真" hint="必須。これが採用の条件です">
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <Ionicons name="camera-outline" size={24} color={Colors.textFaint} />
              </View>
            )}
            <View style={styles.photoButtons}>
              <Button
                label="撮る"
                variant="secondary"
                style={styles.flex}
                onPress={async () => setPhotoUri((await takePhoto()) ?? photoUri)}
              />
              <Button
                label="選ぶ"
                variant="secondary"
                style={styles.flex}
                onPress={async () => setPhotoUri((await pickPhoto()) ?? photoUri)}
              />
              <Button
                label="代用"
                variant="ghost"
                style={styles.flex}
                onPress={() => setPhotoUri(placeholderPhoto(bounty.areaLabel))}
              />
            </View>
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
            disabled={busy || !photoUri}
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
    </ScrollView>
  );
}

function PersonRow({
  emoji,
  name,
  role,
  userId,
}: {
  emoji: string;
  name: string;
  role?: string;
  userId: string;
}) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/user/[id]', params: { id: userId } })}
      style={({ pressed }) => [styles.personRow, pressed && styles.personRowPressed]}>
      <Avatar emoji={emoji} size={24} />
      <Text style={styles.personName}>{name}</Text>
      {role ? <Text style={styles.personRole}>{role}</Text> : null}
      <Ionicons name="chevron-forward" size={15} color={Colors.textFaint} />
    </Pressable>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.md,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  target: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 26,
    fontFamily: Fonts.sans,
  },
  rewardBox: { alignItems: 'flex-end' },
  reward: { fontSize: 22, fontWeight: '800', color: Colors.money, fontFamily: Fonts.sans },
  rewardSub: { fontSize: 11, color: Colors.textSub, fontFamily: Fonts.sans },

  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  place: { flex: 1, fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },

  reportCard: { gap: Spacing.md, padding: Spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  photo: { width: '100%', aspectRatio: 3 / 2, borderRadius: Radius.md, backgroundColor: Colors.bgAlt },
  photoEmpty: {
    width: '100%',
    aspectRatio: 3 / 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgAlt,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButtons: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },

  applications: { gap: Spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: Colors.textSub, fontFamily: Fonts.sans },
  appCard: { gap: Spacing.sm, padding: Spacing.md },
  appHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  personRowPressed: { opacity: 0.55 },
  personName: { fontSize: 14, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  personRole: { fontSize: 11, color: Colors.textFaint, fontFamily: Fonts.sans },

  reportText: { fontSize: 14, color: Colors.text, lineHeight: 21, fontFamily: Fonts.sans },
  decideRow: { flexDirection: 'row', gap: Spacing.sm },

  muted: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
  errorText: { fontSize: 13, color: Colors.danger, fontWeight: '600', fontFamily: Fonts.sans },
});
