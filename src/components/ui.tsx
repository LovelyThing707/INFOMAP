import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';

export type Tone = 'neutral' | 'brand' | 'warn' | 'urgent' | 'dead' | 'money' | 'danger';

function toneBg(colors: ThemeColors): Record<Tone, string> {
  return {
    neutral: colors.bgAlt,
    brand: colors.brandSoft,
    warn: colors.warnSoft,
    urgent: colors.urgentSoft,
    dead: colors.bgAlt,
    money: colors.moneySoft,
    danger: colors.dangerSoft,
  };
}

function toneFg(colors: ThemeColors): Record<Tone, string> {
  return {
    neutral: colors.textSub,
    brand: colors.brand,
    warn: colors.warn,
    urgent: colors.urgent,
    dead: colors.dead,
    money: colors.money,
    danger: colors.danger,
  };
}

export function Pill({
  children,
  tone = 'neutral',
  solid = false,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const bg = toneBg(colors);
  const fg = toneFg(colors);
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: solid ? fg[tone] : bg[tone] },
        style,
      ]}>
      <Text style={[styles.pillText, { color: solid ? colors.onBrand : fg[tone] }]}>
        {children}
      </Text>
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const colors = useColors();
  const base = [
    styles.card,
    { backgroundColor: colors.bg, borderColor: colors.border },
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && { backgroundColor: colors.bgAlt }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  hint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.brand, fg: colors.onBrand, border: colors.brand },
    secondary: { bg: colors.bg, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent' },
    danger: { bg: colors.bg, fg: colors.danger, border: colors.urgent },
  };
  const p = palette[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border },
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}>
      <Text style={[styles.buttonLabel, { color: p.fg }]}>{label}</Text>
      {hint ? <Text style={[styles.buttonHint, { color: p.fg }]}>{hint}</Text> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.bgAlt }, style]}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[styles.segment, active && { backgroundColor: colors.bg }]}>
            <Text
              style={[
                styles.segmentText,
                { color: colors.textSub },
                active && { color: colors.text, fontWeight: '800' },
              ]}>
              {opt.label}
              {opt.count !== undefined ? ` ${opt.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChoiceRow<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View style={[styles.choiceRow, style]}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={String(opt.id)}
            onPress={() => onChange(opt.id)}
            style={[
              styles.choice,
              {
                borderColor: active ? colors.brand : colors.border,
                backgroundColor: active ? colors.brandSoft : colors.bg,
              },
            ]}>
            <Text
              style={[
                styles.choiceText,
                { color: active ? colors.brand : colors.textSub },
                active && { fontWeight: '800' },
              ]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View style={[styles.field, style]}>
      <View style={styles.fieldHead}>
        <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[styles.fieldHint, { color: colors.textFaint }]}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Input({
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  maxLength,
  style,
  secureTextEntry = false,
  autoCapitalize,
  autoComplete,
  onSubmitEditing,
  editable = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  maxLength?: number;
  style?: StyleProp<TextStyle>;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  autoComplete?: 'email' | 'password' | 'new-password' | 'off';
  onSubmitEditing?: () => void;
  editable?: boolean;
}) {
  const colors = useColors();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      multiline={multiline}
      keyboardType={keyboardType}
      maxLength={maxLength}
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      onSubmitEditing={onSubmitEditing}
      editable={editable}
      style={[
        styles.input,
        {
          borderColor: colors.border,
          color: colors.text,
          backgroundColor: colors.bg,
        },
        multiline && styles.inputMultiline,
        style,
      ]}
    />
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  const colors = useColors();
  return (
    <Pressable onPress={onToggle} style={styles.checkboxRow}>
      <View
        style={[
          styles.checkbox,
          { borderColor: colors.borderStrong },
          checked && { backgroundColor: colors.brand, borderColor: colors.brand },
        ]}>
        {checked ? <Ionicons name="checkmark" size={13} color={colors.onBrand} /> : null}
      </View>
      <Text style={[styles.checkboxLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({
  tone = 'neutral',
  icon,
  title,
  body,
}: {
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  const colors = useColors();
  const bg = toneBg(colors);
  const fg = toneFg(colors);
  return (
    <View style={[styles.banner, { backgroundColor: bg[tone] }]}>
      {icon ? (
        <Ionicons name={icon} size={16} color={fg[tone]} style={{ marginTop: 1 }} />
      ) : null}
      <View style={styles.bannerText}>
        <Text style={[styles.bannerTitle, { color: fg[tone] }]}>{title}</Text>
        {body ? <Text style={[styles.bannerBody, { color: fg[tone] }]}>{body}</Text> : null}
      </View>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: colors.textSub }]}>{children}</Text>
      {right}
    </View>
  );
}

export function KeyValue({
  label,
  value,
  tone = 'neutral',
  strong = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  strong?: boolean;
}) {
  const colors = useColors();
  const fg = toneFg(colors);
  return (
    <View style={styles.kv}>
      <Text style={[styles.kvLabel, { color: colors.textSub }]}>{label}</Text>
      <Text
        style={[
          styles.kvValue,
          strong && styles.kvValueStrong,
          { color: fg[tone] },
        ]}>
        {value}
      </Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.textSub }]}>{title}</Text>
      {body ? (
        <Text style={[styles.emptyBody, { color: colors.textFaint }]}>{body}</Text>
      ) : null}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.border }, style]} />;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return <Text style={[styles.muted, { color: colors.textSub }, style]}>{children}</Text>;
}

/** テーマ連動の本文スタイル。静的な text の代わりに使う */
export function useTextStyles() {
  const colors = useColors();
  return useMemo(
    () =>
      StyleSheet.create({
        title: { fontSize: 20, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
        heading: { fontSize: 16, fontWeight: '700', color: colors.text, fontFamily: Fonts.sans },
        body: { fontSize: 14, color: colors.text, lineHeight: 21, fontFamily: Fonts.sans },
        small: { fontSize: 12, color: colors.textSub, fontFamily: Fonts.sans },
        price: { fontSize: 22, fontWeight: '800', color: colors.text, fontFamily: Fonts.sans },
      }),
    [colors]
  );
}

/** @deprecated useTextStyles() を使う。互換のためライト固定のまま残す */
export const text = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A', fontFamily: Fonts.sans },
  heading: { fontSize: 16, fontWeight: '700', color: '#0F172A', fontFamily: Fonts.sans },
  body: { fontSize: 14, color: '#0F172A', lineHeight: 21, fontFamily: Fonts.sans },
  small: { fontSize: 12, color: '#64748B', fontFamily: Fonts.sans },
  price: { fontSize: 22, fontWeight: '800', color: '#0F172A', fontFamily: Fonts.sans },
});

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 11, fontWeight: '700', fontFamily: Fonts.sans },

  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
  },

  button: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 15, fontWeight: '700', fontFamily: Fonts.sans },
  buttonHint: { fontSize: 11, fontWeight: '500', opacity: 0.85, marginTop: 2 },

  segmented: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  segmentText: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },

  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  choiceText: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },

  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: 16,
    fontFamily: Fonts.sans,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top', lineHeight: 21 },

  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.sans,
  },

  banner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 13, fontWeight: '800', fontFamily: Fonts.sans },
  bannerBody: { fontSize: 12, lineHeight: 18, opacity: 0.9, fontFamily: Fonts.sans },

  field: { gap: Spacing.sm },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '700', fontFamily: Fonts.sans },
  fieldHint: { fontSize: 11, fontFamily: Fonts.sans },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', fontFamily: Fonts.sans },

  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: Spacing.md },
  kvLabel: { fontSize: 13, fontFamily: Fonts.sans },
  kvValue: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },
  kvValueStrong: { fontSize: 15, fontWeight: '800' },

  empty: { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.xs },
  emptyTitle: { fontSize: 14, fontWeight: '700', fontFamily: Fonts.sans },
  emptyBody: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },

  divider: { height: 1 },
  muted: { fontSize: 12, lineHeight: 18, fontFamily: Fonts.sans },
});
