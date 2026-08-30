import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
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

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export type Tone = 'neutral' | 'brand' | 'warn' | 'urgent' | 'dead' | 'money' | 'danger';

const TONE_BG: Record<Tone, string> = {
  neutral: Colors.bgAlt,
  brand: Colors.brandSoft,
  warn: '#FEF3C7',
  urgent: '#FFE4E6',
  dead: Colors.bgAlt,
  money: Colors.moneySoft,
  danger: Colors.dangerSoft,
};

const TONE_FG: Record<Tone, string> = {
  neutral: Colors.textSub,
  brand: Colors.brand,
  warn: Colors.warn,
  urgent: Colors.urgent,
  dead: Colors.dead,
  money: Colors.money,
  danger: Colors.danger,
};

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
  return (
    <View
      style={[styles.pill, { backgroundColor: solid ? TONE_FG[tone] : TONE_BG[tone] }, style]}>
      <Text style={[styles.pillText, { color: solid ? '#fff' : TONE_FG[tone] }]}>{children}</Text>
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
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
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
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: Colors.brand, fg: '#fff', border: Colors.brand },
    secondary: { bg: Colors.bg, fg: Colors.text, border: Colors.borderStrong },
    ghost: { bg: 'transparent', fg: Colors.brand, border: 'transparent' },
    danger: { bg: Colors.bg, fg: Colors.danger, border: '#FDA4AF' },
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
  return (
    <View style={[styles.segmented, style]}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[styles.segment, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
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
  return (
    <View style={[styles.choiceRow, style]}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={String(opt.id)}
            onPress={() => onChange(opt.id)}
            style={[styles.choice, active && styles.choiceActive]}>
            <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{opt.label}</Text>
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
  return (
    <View style={[styles.field, style]}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
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
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={Colors.textFaint}
      multiline={multiline}
      keyboardType={keyboardType}
      maxLength={maxLength}
      style={[styles.input, multiline && styles.inputMultiline, style]}
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
  return (
    <Pressable onPress={onToggle} style={styles.checkboxRow}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
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
  return (
    <View style={[styles.banner, { backgroundColor: TONE_BG[tone] }]}>
      {icon ? (
        <Ionicons name={icon} size={16} color={TONE_FG[tone]} style={{ marginTop: 1 }} />
      ) : null}
      <View style={styles.bannerText}>
        <Text style={[styles.bannerTitle, { color: TONE_FG[tone] }]}>{title}</Text>
        {body ? <Text style={[styles.bannerBody, { color: TONE_FG[tone] }]}>{body}</Text> : null}
      </View>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
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
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, strong && styles.kvValueStrong, { color: TONE_FG[tone] }]}>
        {value}
      </Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export const text = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  heading: { fontSize: 16, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  body: { fontSize: 14, color: Colors.text, lineHeight: 21, fontFamily: Fonts.sans },
  small: { fontSize: 12, color: Colors.textSub, fontFamily: Fonts.sans },
  price: { fontSize: 22, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
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
    backgroundColor: Colors.bg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  cardPressed: { backgroundColor: Colors.bgAlt },

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
    backgroundColor: Colors.bgAlt,
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
  segmentActive: { backgroundColor: Colors.bg },
  segmentText: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
  segmentTextActive: { color: Colors.text, fontWeight: '800' },

  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  choiceActive: { borderColor: Colors.brand, backgroundColor: Colors.brandSoft },
  choiceText: { fontSize: 13, fontWeight: '600', color: Colors.textSub, fontFamily: Fonts.sans },
  choiceTextActive: { color: Colors.brand, fontWeight: '800' },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.bg,
    fontFamily: Fonts.sans,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top', lineHeight: 21 },

  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
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
  fieldLabel: { fontSize: 13, fontWeight: '700', color: Colors.text, fontFamily: Fonts.sans },
  fieldHint: { fontSize: 11, color: Colors.textFaint, fontFamily: Fonts.sans },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: Colors.textSub, fontFamily: Fonts.sans },

  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: Spacing.md },
  kvLabel: { fontSize: 13, color: Colors.textSub, fontFamily: Fonts.sans },
  kvValue: { fontSize: 13, fontWeight: '600', fontFamily: Fonts.sans },
  kvValueStrong: { fontSize: 15, fontWeight: '800' },

  empty: { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.xs },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: Colors.textSub, fontFamily: Fonts.sans },
  emptyBody: {
    fontSize: 12,
    color: Colors.textFaint,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
    fontFamily: Fonts.sans,
  },

  divider: { height: 1, backgroundColor: Colors.border },
  muted: { fontSize: 12, color: Colors.textSub, lineHeight: 18, fontFamily: Fonts.sans },
});
