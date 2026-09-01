import '@/global.css';

import { Platform } from 'react-native';

/**
 * 鮮度の色は青（余裕）→ 琥珀（急ぎ）→ 赤（もうすぐ消える）で一貫させる。
 * マーカー・バッジ・カウントダウンで同じ関数から引くこと。
 */
export type ThemeColors = {
  brand: string;
  brandDark: string;
  brandSoft: string;

  fresh: string;
  warn: string;
  urgent: string;
  dead: string;

  money: string;
  moneySoft: string;

  text: string;
  textSub: string;
  textFaint: string;
  onBrand: string;

  bg: string;
  bgAlt: string;
  bgSunken: string;
  border: string;
  borderStrong: string;

  danger: string;
  dangerSoft: string;
  overlay: string;

  /** Pill / Banner 用のソフト背景 */
  warnSoft: string;
  urgentSoft: string;
};

export const lightColors: ThemeColors = {
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

  warnSoft: '#FEF3C7',
  urgentSoft: '#FFE4E6',
};

/** メルカリアプリのダークに寄せた面・文字（観測値ベースの近似） */
export const darkColors: ThemeColors = {
  brand: '#3B82F6',
  brandDark: '#60A5FA',
  brandSoft: '#2C2C2C',

  fresh: '#3B82F6',
  warn: '#FBBF24',
  urgent: '#FB7185',
  dead: '#888888',

  money: '#34D399',
  moneySoft: '#1E2E28',

  text: '#FFFFFF',
  textSub: '#CCCCCC',
  textFaint: '#999999',
  onBrand: '#FFFFFF',

  // メルカリダークのメイン面に近いチャコール
  bg: '#222222',
  bgAlt: '#2C2C2C',
  bgSunken: '#1A1A1A',
  border: '#3D3D3D',
  borderStrong: '#4A4A4A',

  danger: '#FB7185',
  dangerSoft: '#3A1A22',
  overlay: 'rgba(0, 0, 0, 0.55)',

  warnSoft: '#2A2410',
  urgentSoft: '#3A1A22',
};

/** @deprecated 静的参照用。画面は useColors() を使う */
export const Colors = lightColors;

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

export function paletteFor(scheme: ResolvedScheme): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors;
}

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

export const TAB_BAR_HEIGHT = 56;
export const MAX_CONTENT_WIDTH = 720;
