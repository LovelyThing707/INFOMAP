import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';

export type FilterValue = string | number | boolean | null;
export type FilterValues = Record<string, FilterValue | undefined>;

export interface FilterChoiceOption {
  value: string | number;
  label: string;
}

/**
 * 絞り込みの1項目。
 *
 * toggle は入り切りだけ。choice は押すと候補が下に開いて、段階を選び直せる。
 * 「300円以上」を固定で並べると、それより上を見たい人が絞れないので、
 * 金額や時間のように連続した量は choice にする。
 */
export type FilterDef =
  | { kind: 'toggle'; id: string; label: string }
  | {
      kind: 'choice';
      id: string;
      /** 未選択のときに出す文言 */
      label: string;
      options: FilterChoiceOption[];
      /** 既定では「指定なし」に戻せる。並び替えのように常に値が要るものは false */
      clearable?: boolean;
    };

export function numberFilter(values: FilterValues, id: string): number | null {
  const value = values[id];
  return typeof value === 'number' ? value : null;
}

export function boolFilter(values: FilterValues, id: string): boolean {
  return values[id] === true;
}

export function stringFilter<T extends string>(
  values: FilterValues,
  id: string,
  fallback: T
): T {
  const value = values[id];
  return typeof value === 'string' ? (value as T) : fallback;
}

export function FilterBar({
  filters,
  values,
  onChange,
  elevated = false,
  style,
}: {
  filters: FilterDef[];
  values: FilterValues;
  onChange: (id: string, value: FilterValue) => void;
  /** 地図の上に重ねるとき。背景から浮かせる */
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const openChoice = filters.find(
    (f): f is Extract<FilterDef, { kind: 'choice' }> => f.kind === 'choice' && f.id === openId
  );

  const select = (id: string, value: FilterValue) => {
    onChange(id, value);
    setOpenId(null);
  };

  return (
    <View style={style}>
      <View style={styles.row}>
        {filters.map((filter) => {
          if (filter.kind === 'toggle') {
            const active = values[filter.id] === true;
            return (
              <Pressable
                key={filter.id}
                onPress={() => onChange(filter.id, !active)}
                style={[
                  styles.chip,
                  elevated && styles.chipElevated,
                  {
                    backgroundColor: active ? colors.brand : colors.bg,
                    borderColor: active ? colors.brand : colors.border,
                  },
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? colors.onBrand : colors.textSub },
                  ]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          }

          const current = filter.options.find((o) => o.value === values[filter.id]);
          const active = current !== undefined;
          const open = openId === filter.id;
          return (
            <Pressable
              key={filter.id}
              onPress={() => setOpenId(open ? null : filter.id)}
              style={[
                styles.chip,
                styles.chipChoice,
                elevated && styles.chipElevated,
                {
                  backgroundColor: active ? colors.brand : colors.bg,
                  borderColor: active ? colors.brand : colors.border,
                },
              ]}>
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.onBrand : colors.textSub },
                ]}>
                {current?.label ?? filter.label}
              </Text>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={12}
                color={active ? colors.onBrand : colors.textFaint}
              />
            </Pressable>
          );
        })}
      </View>

      {openChoice ? (
        <View
          style={[
            styles.panel,
            elevated && styles.panelElevated,
            { backgroundColor: colors.bg, borderColor: colors.border },
          ]}>
          <Text style={[styles.panelTitle, { color: colors.textFaint }]}>{openChoice.label}</Text>
          <View style={styles.row}>
            {openChoice.options.map((option) => {
              const selected = values[openChoice.id] === option.value;
              return (
                <Pressable
                  key={String(option.value)}
                  onPress={() => select(openChoice.id, option.value)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: selected ? colors.text : colors.bgAlt,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: selected ? colors.bg : colors.text,
                        fontWeight: selected ? '800' : '600',
                      },
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
            {openChoice.clearable === false ? null : (
              <Pressable
                onPress={() => select(openChoice.id, null)}
                style={[styles.option, { backgroundColor: colors.bgAlt }]}>
                <Text style={[styles.optionText, { color: colors.text }]}>指定なし</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 金額の候補。上限を切りたい側（価格）と下限を切りたい側（報酬）で文言を変える */
export function amountOptions(
  amounts: number[],
  direction: 'min' | 'max'
): FilterChoiceOption[] {
  return amounts.map((value) => ({
    value,
    label: `¥${value.toLocaleString('ja-JP')}${direction === 'min' ? '以上' : '以下'}`,
  }));
}

export function minuteOptions(minutes: number[]): FilterChoiceOption[] {
  return minutes.map((value) => ({
    value,
    label: value >= 60 ? `${value / 60}時間以内` : `${value}分以内`,
  }));
}

export function distanceOptions(meters: number[]): FilterChoiceOption[] {
  return meters.map((value) => ({
    value,
    label: value >= 1000 ? `${value / 1000}km以内` : `${value}m以内`,
  }));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },

  chip: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  chipChoice: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 9 },
  chipElevated: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  chipText: { fontSize: 12, fontWeight: '700', fontFamily: Fonts.sans },

  panel: {
    marginTop: 6,
    padding: Spacing.sm,
    gap: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  panelElevated: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  panelTitle: { fontSize: 11, fontWeight: '700', fontFamily: Fonts.sans },

  option: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radius.sm,
  },
  optionText: { fontSize: 12, fontFamily: Fonts.sans },
});
