import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts, MAX_CONTENT_WIDTH, Spacing } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';
import { useSession } from '@/state/session';

import { Banner, Button, Field, Input, useTextStyles } from './ui';

const MIN_PASSWORD = 8;

type Mode = 'signIn' | 'signUp';

/**
 * Supabase を繋いだときだけ出る入口。
 *
 * メルカリと同じく、先に「何ができるか」と「無料ではじめられる」を出し、
 * 金銭の手続きを入口の一文にしない。
 */
export function SignIn({ initialMode = 'signUp' }: { initialMode?: Mode }) {
  const colors = useColors();
  const text = useTextStyles();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');

  const busy = useSession((s) => s.authBusy);
  const error = useSession((s) => s.authError);
  const awaitingConfirmation = useSession((s) => s.awaitingConfirmation);
  const signIn = useSession((s) => s.signIn);
  const signUp = useSession((s) => s.signUp);
  const clearAuthError = useSession((s) => s.clearAuthError);

  const isSignUp = mode === 'signUp';
  const canSubmit =
    email.includes('@') &&
    password.length >= MIN_PASSWORD &&
    (!isSignUp || handle.trim().length > 0) &&
    !busy;

  const submit = () => {
    if (!canSubmit) return;
    if (isSignUp) void signUp(email, password, handle);
    else void signIn(email, password);
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    clearAuthError();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={[styles.brand, { color: colors.text }]}>INFOMAP</Text>
            <Text style={[text.body, { color: colors.textSub, lineHeight: 22 }]}>
              近くの「今」を、必要なときだけ。新規登録は無料です。
            </Text>
          </View>

          <View style={styles.benefits}>
            <Benefit text="地図で、今この店にあるかをさがす" />
            <Benefit text="現場の写真は、買った人にだけ届く" />
            <Benefit text="見てほしいことがあれば、報酬を置いて頼める" />
          </View>

          {awaitingConfirmation ? (
            <Banner
              tone="brand"
              icon="mail-outline"
              title="確認メールを送りました"
              body="届いたリンクを開くとログインできます。迷惑メールに入ることがあります"
            />
          ) : null}

          {error ? <Banner tone="danger" icon="alert-circle" title={error} /> : null}

          <View style={styles.form}>
            {isSignUp ? (
              <Field label="表示名" hint="20文字まで。あとから変えられます">
                <Input
                  value={handle}
                  onChangeText={setHandle}
                  placeholder="例: かな"
                  maxLength={20}
                  autoCapitalize="none"
                />
              </Field>
            ) : null}

            <Field label="メールアドレス">
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder="メールアドレス"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </Field>

            <Field label="パスワード" hint={`${MIN_PASSWORD}文字以上`}>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="パスワード"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={isSignUp ? 'new-password' : 'password'}
                onSubmitEditing={submit}
              />
            </Field>
          </View>

          <Button
            label={busy ? '通信しています…' : isSignUp ? '無料ではじめる' : 'ログイン'}
            onPress={submit}
            disabled={!canSubmit}
          />

          <Button
            label={isSignUp ? 'アカウントをお持ちの方はこちら' : 'はじめての方は新規登録'}
            variant="ghost"
            onPress={() => changeMode(isSignUp ? 'signIn' : 'signUp')}
          />

          <Text style={[text.small, { color: colors.textFaint, lineHeight: 18 }]}>
            扱うのは店頭の在庫のような「場所の状態」だけです。
            特定の個人がどこにいるかは扱いません。位置は対象からの距離に変換して記録し、
            緯度経度そのものは保存しません
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Benefit({ text }: { text: string }) {
  const colors = useColors();
  const textStyles = useTextStyles();
  return (
    <View style={styles.benefit}>
      <View style={[styles.dot, { backgroundColor: colors.brand }]} />
      <Text style={[textStyles.body, { color: colors.text, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: Math.min(420, MAX_CONTENT_WIDTH),
    gap: Spacing.lg,
  },
  head: { gap: Spacing.sm },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: Fonts.sans,
  },
  benefits: { gap: 8 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  form: { gap: Spacing.lg },
});
