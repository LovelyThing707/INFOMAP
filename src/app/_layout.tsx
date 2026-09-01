import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PhoneStage } from '@/components/PhoneStage';
import { backend } from '@/data';
import { useColors } from '@/hooks/use-colors';
import { nowMs } from '@/lib/clock';
import { hasSeenWelcome, resetWelcomeSeen } from '@/lib/welcome';
import { installWebTouchGuard } from '@/lib/web-touch-guard';
import { repo, useSession } from '@/state/session';
import { bindSystemAppearance, useThemeStore } from '@/state/theme';

installWebTouchGuard();

SplashScreen.preventAutoHideAsync();

/**
 * モーダルのURLを直接開いても、下にタブが積まれた状態で始まるようにする。
 * これがないと閉じるときに戻り先がなく、GO_BACK が処理されない。
 */
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const ready = useSession((s) => s.ready);
  const init = useSession((s) => s.init);
  const bump = useSession((s) => s.bump);
  const themeReady = useThemeStore((s) => s.ready);
  const themeInit = useThemeStore((s) => s.init);
  const resolved = useThemeStore((s) => s.resolved);
  const colors = useColors();
  const pathname = usePathname();
  const [gateReady, setGateReady] = useState(false);

  useEffect(() => {
    void themeInit();
    return bindSystemAppearance();
  }, [themeInit]);

  useEffect(() => {
    init().finally(() => SplashScreen.hideAsync());
  }, [init]);

  // 確認用 ?welcome=1 と、ゲート判定の初期化
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('welcome') === '1') {
          await resetWelcomeSeen();
          await useSession.getState().signOut();
          params.delete('welcome');
          const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', next);
        }
      }
      if (!cancelled) setGateReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // 未読なら歓迎へ。スキップ後は AsyncStorage を見直すので戻らない。
  useEffect(() => {
    if (!ready || !gateReady) return;
    if (pathname === '/welcome') return;
    let cancelled = false;
    void hasSeenWelcome().then((seen) => {
      if (cancelled || seen) return;
      router.replace('/welcome');
    });
    return () => {
      cancelled = true;
    };
  }, [ready, gateReady, pathname]);

  // 時間が経つだけで確定・返還・自動採用が起きるサービスなので、
  // サーバ側でやるはずの処理を定期的に回して画面へ反映する。
  // Supabase を繋いだら pg_cron が run_tick() を回すので、ここは止める。
  useEffect(() => {
    if (!ready || backend !== 'local') return;
    const id = setInterval(() => {
      repo.tick(nowMs()).then((changed) => {
        if (changed) bump();
      });
    }, 20000);
    return () => clearInterval(id);
  }, [ready, bump]);

  const booting = !ready || !gateReady || !themeReady;

  return (
    <PhoneStage>
      <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
        <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
        {booting ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerTitleStyle: { color: colors.text },
              headerShadowVisible: false,
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="welcome"
              options={{
                headerShown: false,
                animation: 'fade',
                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="request-new"
              options={{ presentation: 'modal', headerShown: true, title: '依頼を出す' }}
            />
            <Stack.Screen
              name="request/[id]"
              options={{ headerShown: true, title: '依頼' }}
            />
            <Stack.Screen
              name="request-questions/[id]"
              options={{ presentation: 'modal', headerShown: true, title: 'コメント' }}
            />
            <Stack.Screen
              name="pin/[id]"
              options={{ presentation: 'modal', headerShown: true, title: '情報' }}
            />
            <Stack.Screen
              name="user/[id]"
              options={{ presentation: 'modal', headerShown: true, title: 'プロフィール' }}
            />
            <Stack.Screen
              name="notifications"
              options={{ presentation: 'modal', headerShown: true, title: '通知' }}
            />
            <Stack.Screen
              name="sign-in"
              options={{ presentation: 'modal', headerShown: true, title: 'ログイン' }}
            />
          </Stack>
        )}
      </GestureHandlerRootView>
    </PhoneStage>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
