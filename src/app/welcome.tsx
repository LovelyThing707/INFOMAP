import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { Fonts, Spacing } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';
import { markWelcomeSeen } from '@/lib/welcome';

/**
 * メルカリの初回起動に倣った入口。
 * 強制登録ではなく、右上のスキップで中身（地図）へ進める。
 */
export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const skip = async () => {
    await markWelcomeSeen();
    router.replace('/');
  };

  const toSignUp = async () => {
    await markWelcomeSeen();
    router.replace('/sign-in');
  };

  const toSignIn = async () => {
    await markWelcomeSeen();
    router.replace({ pathname: '/sign-in', params: { mode: 'signIn' } });
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          backgroundColor: colors.bg,
        },
      ]}>
      <View style={styles.topBar}>
        <View style={styles.topSpacer} />
        <Pressable onPress={skip} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={[styles.skip, { color: colors.textSub }]}>スキップ</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={[styles.logo, { color: colors.brand }]}>INFOMAP</Text>
        <Text style={[styles.welcome, { color: colors.text }]}>ようこそ、INFOMAPへ</Text>
        <Text style={[styles.lede, { color: colors.textSub }]}>
          近くの「今」を、必要なときだけ。
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="無料ではじめる" onPress={toSignUp} />
        <Button label="ログイン" variant="secondary" onPress={toSignIn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 44,
  },
  topSpacer: { flex: 1 },
  skip: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Fonts.sans,
  },
  pressed: { opacity: 0.55 },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingBottom: 40,
  },
  logo: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: Fonts.sans,
    marginBottom: Spacing.sm,
  },
  welcome: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  lede: {
    fontSize: 15,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
});
