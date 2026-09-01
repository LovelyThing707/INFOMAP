import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/badges';
import { Button, Input } from '@/components/ui';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { formatFreshness, isBountyOpen } from '@/domain/rules';
import type { BountyQuestion, BountyView } from '@/domain/types';
import { useColors } from '@/hooks/use-colors';

/**
 * メルカリの商品コメント欄に寄せた見た目。
 * 見出し＋件数、丸アイコンと名前、本文、相対時刻、下の「コメントする」。
 */
export function BountyQuestions({
  bounty,
  now,
  userId,
  isRequester,
  onAsk,
  onAnswer,
  limit,
  onSeeAll,
  showAsk = true,
}: {
  bounty: BountyView;
  now: number;
  userId: string;
  isRequester: boolean;
  onAsk: (body: string) => void;
  onAnswer: (questionId: string, text: string) => void;
  limit?: number;
  onSeeAll?: () => void;
  showAsk?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [composing, setComposing] = useState(!limit);
  const open = isBountyOpen(bounty, now);
  const waiting = bounty.questions.some((q) => q.askedBy === userId && q.answer === null);
  const canSend = showAsk && !isRequester && open && !waiting;

  const newest = [...bounty.questions].sort((a, b) => b.askedAt - a.askedAt);
  const visible = limit ? newest.slice(0, limit) : newest;
  const count = bounty.questions.length;

  const send = () => {
    const body = comment.trim();
    if (!body || !canSend) return;
    onAsk(body);
    setComment('');
    if (limit) setComposing(false);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onSeeAll}
        disabled={!onSeeAll}
        style={({ pressed }) => [styles.titleRow, pressed && onSeeAll ? styles.pressed : null]}>
        <Text style={styles.title}>コメント({count})</Text>
        {onSeeAll ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
      </Pressable>

      {visible.map((q) => (
        <CommentRow
          key={q.id}
          question={q}
          now={now}
          isRequester={isRequester}
          requesterEmoji={bounty.requesterEmoji}
          requesterHandle={bounty.requesterHandle}
          draft={drafts[q.id] ?? ''}
          onDraft={(text) => setDrafts((d) => ({ ...d, [q.id]: text }))}
          onAnswer={() => onAnswer(q.id, drafts[q.id] ?? '')}
        />
      ))}

      {count === 0 ? <Text style={styles.empty}>コメントはまだありません</Text> : null}

      {showAsk && !isRequester ? (
        composing ? (
          <View style={styles.composer}>
            <Input
              value={comment}
              onChangeText={setComment}
              placeholder={
                !open
                  ? 'この依頼は終了しています'
                  : waiting
                    ? '回答が来るまで次のコメントは送れません'
                    : 'コメントを入力'
              }
              editable={canSend}
              multiline
              onSubmitEditing={send}
              style={styles.composerInput}
            />
            <View style={styles.composerActions}>
              {limit ? (
                <Pressable onPress={() => setComposing(false)} hitSlop={8}>
                  <Text style={styles.cancel}>キャンセル</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable
                onPress={send}
                disabled={!canSend || !comment.trim()}
                style={({ pressed }) => [
                  styles.send,
                  (!canSend || !comment.trim()) && styles.sendDisabled,
                  pressed && canSend && comment.trim() ? styles.pressed : null,
                ]}>
                <Text style={styles.sendText}>送信</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              if (!open) return;
              setComposing(true);
            }}
            disabled={!open}
            style={({ pressed }) => [
              styles.commentButton,
              !open && styles.sendDisabled,
              pressed && open ? styles.pressed : null,
            ]}>
            <Ionicons
              name="chatbubble-outline"
              size={16}
              color={open ? colors.text : colors.textFaint}
            />
            <Text style={[styles.commentButtonText, !open && styles.commentButtonMuted]}>
              コメントする
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function CommentRow({
  question,
  now,
  isRequester,
  requesterEmoji,
  requesterHandle,
  draft,
  onDraft,
  onAnswer,
}: {
  question: BountyQuestion;
  now: number;
  isRequester: boolean;
  requesterEmoji: string;
  requesterHandle: string;
  draft: string;
  onDraft: (text: string) => void;
  onAnswer: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.thread}>
      <View style={styles.row}>
        <Avatar emoji={question.askedByEmoji} size={36} />
        <View style={styles.bubble}>
          <Text style={styles.name}>{question.askedByHandle}</Text>
          <Text style={styles.body}>{question.body}</Text>
          <Text style={styles.time}>{formatFreshness(Math.max(0, now - question.askedAt))}</Text>
        </View>
      </View>

      {question.answer && question.answeredAt ? (
        <View style={[styles.row, styles.reply]}>
          <Avatar emoji={requesterEmoji} size={36} />
          <View style={styles.bubble}>
            <Text style={styles.name}>{requesterHandle}</Text>
            <Text style={styles.body}>{question.answer}</Text>
            <Text style={styles.time}>
              {formatFreshness(Math.max(0, now - question.answeredAt))}
            </Text>
          </View>
        </View>
      ) : null}

      {!question.answer && isRequester ? (
        <View style={styles.replyForm}>
          <Input value={draft} onChangeText={onDraft} placeholder="返信する" multiline />
          <Button label="返信" onPress={onAnswer} disabled={!draft.trim()} />
        </View>
      ) : null}

      {!question.answer && !isRequester ? (
        <Text style={styles.waiting}>依頼者の返信待ち</Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: Spacing.md },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 2,
    },
    pressed: { opacity: 0.55 },
    title: { fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    empty: { fontSize: 13, color: colors.textFaint, fontFamily: Fonts.sans },

    thread: { gap: Spacing.md },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    reply: { paddingLeft: 20 },
    bubble: { flex: 1, gap: 4, paddingTop: 1 },
    name: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
    body: { fontSize: 14, color: colors.text, lineHeight: 21, fontFamily: Fonts.sans },
    time: { fontSize: 12, color: colors.textFaint, fontFamily: Fonts.sans },
    waiting: {
      marginLeft: 44,
      fontSize: 12,
      color: colors.textFaint,
      fontFamily: Fonts.sans,
    },
    replyForm: { marginLeft: 44, gap: Spacing.sm },

    commentButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: Radius.md,
      paddingVertical: 12,
      backgroundColor: colors.bg,
    },
    commentButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Fonts.sans,
    },
    commentButtonMuted: { color: colors.textFaint },

    composer: { gap: Spacing.sm },
    composerInput: { minHeight: 72, textAlignVertical: 'top' },
    composerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cancel: { fontSize: 13, color: colors.textSub, fontFamily: Fonts.sans },
    send: {
      backgroundColor: colors.brand,
      borderRadius: Radius.pill,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    sendDisabled: { backgroundColor: colors.bgSunken },
    sendText: { color: colors.onBrand, fontSize: 13, fontWeight: '800', fontFamily: Fonts.sans },
  });
}
