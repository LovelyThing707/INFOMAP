import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/AppTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: '#fff' } }}
      tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'さがす' }} />
      <Tabs.Screen name="requests" options={{ title: 'リクエスト' }} />
      <Tabs.Screen name="sell" options={{ title: '売る' }} />
      <Tabs.Screen name="deals" options={{ title: '取引' }} />
      <Tabs.Screen name="me" options={{ title: 'マイページ' }} />
    </Tabs>
  );
}
