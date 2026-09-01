import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, TAB_BAR_HEIGHT } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';

// expo-router は @react-navigation/bottom-tabs とは別の型を持っているので、
// パッケージから直接引かず Tabs の props から推論する
type AppTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

type IoniconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, { on: IoniconName; off: IoniconName; label: string }> = {
  index: { on: 'map', off: 'map-outline', label: 'さがす' },
  requests: { on: 'megaphone', off: 'megaphone-outline', label: 'リクエスト' },
  sell: { on: 'add', off: 'add', label: '売る' },
  deals: { on: 'receipt', off: 'receipt-outline', label: '取引' },
  me: { on: 'person-circle', off: 'person-circle-outline', label: 'マイページ' },
};

export function AppTabBar({ state, navigation }: AppTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  // ホームインジケータ余白は少しだけ削って下へ寄せる
  const bottomPad = Math.max(0, insets.bottom - 4);

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: bottomPad,
          height: TAB_BAR_HEIGHT + bottomPad,
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
      ]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const meta = ICONS[route.name];
        if (!meta) return null;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable key={route.key} onPress={onPress} style={styles.slot}>
            <Ionicons
              name={focused ? meta.on : meta.off}
              size={20}
              color={focused ? colors.brand : colors.textFaint}
            />
            <Text
              style={[
                styles.label,
                { color: focused ? colors.brand : colors.textFaint },
                focused && styles.labelActive,
              ]}>
              {meta.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: 1,
    paddingTop: 4,
  },
  slot: { flex: 1, alignItems: 'center', gap: 2 },
  label: { fontSize: 10, fontWeight: '600', fontFamily: Fonts.sans },
  labelActive: { fontWeight: '800' },
});
