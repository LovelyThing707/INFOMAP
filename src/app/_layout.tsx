import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { nowMs } from '@/lib/clock';
import { repo, useSession } from '@/state/session';

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

  useEffect(() => {
    init().finally(() => SplashScreen.hideAsync());
  }, [init]);

  // 時間が経つだけで確定・返還・自動採用が起きるサービスなので、
  // サーバ側でやるはずの処理を定期的に回して画面へ反映する。
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      repo.tick(nowMs()).then((changed) => {
        if (changed) bump();
      });
    }, 20000);
    return () => clearInterval(id);
  }, [ready, bump]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {ready ? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="request-new"
              options={{ presentation: 'modal', headerShown: true, title: '依頼を出す' }}
            />
            <Stack.Screen
              name="request/[id]"
              options={{ presentation: 'modal', headerShown: true, title: '依頼' }}
            />
            <Stack.Screen
              name="pin/[id]"
              options={{ presentation: 'modal', headerShown: true, title: '情報' }}
            />
            <Stack.Screen
              name="user/[id]"
              options={{ presentation: 'modal', headerShown: true, title: 'プロフィール' }}
            />
          </Stack>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.brand} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
