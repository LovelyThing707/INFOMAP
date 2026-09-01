import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/AppTabBar';
import { useColors } from '@/hooks/use-colors';

export default function TabsLayout() {
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'さがす' }} />
      <Tabs.Screen name="sell" options={{ title: '売る' }} />
      <Tabs.Screen name="requests" options={{ title: 'リクエスト' }} />
      <Tabs.Screen name="deals" options={{ title: '取引' }} />
      <Tabs.Screen name="me" options={{ title: 'マイページ' }} />
    </Tabs>
  );
}
