import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Fonts, TAB_BAR_HEIGHT } from '@/constants/theme';

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

/**
 * 中央の「売る」だけ大きくする。現場に立っていられる時間は短いので、
 * 出品は常に1タップで届く位置に置く。
 */
export function AppTabBar({ state, navigation }: AppTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]}>
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

        if (route.name === 'sell') {
          return (
            <Pressable key={route.key} onPress={onPress} style={styles.sellSlot}>
              <View style={[styles.sellButton, focused && styles.sellButtonActive]}>
                <Ionicons name="add" size={26} color="#fff" />
              </View>
              <Text style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
            </Pressable>
          );
        }

        return (
          <Pressable key={route.key} onPress={onPress} style={styles.slot}>
            <Ionicons
              name={focused ? meta.on : meta.off}
              size={22}
              color={focused ? Colors.brand : Colors.textFaint}
            />
            <Text style={[styles.label, focused && styles.labelActive]}>{meta.label}</Text>
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
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
  },
  slot: { flex: 1, alignItems: 'center', gap: 3 },
  sellSlot: { flex: 1, alignItems: 'center', gap: 3, marginTop: -18 },
  sellButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.bg,
    shadowColor: Colors.brand,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sellButtonActive: { backgroundColor: Colors.brandDark },
  label: { fontSize: 10, fontWeight: '600', color: Colors.textFaint, fontFamily: Fonts.sans },
  labelActive: { color: Colors.brand, fontWeight: '800' },
});
