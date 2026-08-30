import '@/global.css';

import { Platform } from 'react-native';

/**
 * 鮮度の色は青（余裕）→ 琥珀（急ぎ）→ 赤（もうすぐ消える）で一貫させる。
 * マーカー・バッジ・カウントダウンで同じ関数から引くこと。
 */
export const Colors = {
  brand: '#1D4ED8',
  brandDark: '#1E3A8A',
  brandSoft: '#EFF4FF',

  fresh: '#1D4ED8',
  warn: '#D97706',
  urgent: '#E11D48',
  dead: '#94A3B8',

  money: '#047857',
  moneySoft: '#ECFDF5',

  text: '#0F172A',
  textSub: '#64748B',
  textFaint: '#94A3B8',
  onBrand: '#FFFFFF',

  bg: '#FFFFFF',
  bgAlt: '#F1F5F9',
  bgSunken: '#E2E8F0',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  danger: '#E11D48',
  dangerSoft: '#FFF1F2',
  overlay: 'rgba(15, 23, 42, 0.45)',
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  web: { sans: 'var(--font-display)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
})!;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const TAB_BAR_HEIGHT = 64;
export const MAX_CONTENT_WIDTH = 720;
