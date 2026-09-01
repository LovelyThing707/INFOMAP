import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemePreference } from '@/constants/theme';
import { useTheme } from '@/hooks/use-colors';

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'システム' },
  { id: 'light', label: 'ライト' },
  { id: 'dark', label: 'ダーク' },
];

/** 表示モード切替。マイページと未ログインの AuthGate から使う */
export function ThemePreferencePicker() {
  const { colors, preference, setPreference } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSub }]}>表示</Text>
      <View style={[styles.row, { backgroundColor: colors.bgAlt }]}>
        {OPTIONS.map((opt) => {
          const active = opt.id === preference;
          return (
            <Pressable
              key={opt.id}
              onPress={() => void setPreference(opt.id)}
              style={[
                styles.chip,
                active && { backgroundColor: colors.bg, borderColor: colors.borderStrong },
              ]}>
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.text : colors.textSub },
                  active && styles.chipTextActive,
                ]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  label: { fontSize: 13, fontWeight: '800', fontFamily: Fonts.sans },
  row: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  chip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: Radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },
  chipTextActive: { fontWeight: '800' },
});
