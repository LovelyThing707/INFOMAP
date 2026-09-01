import type { ThemeColors, ThemePreference, ResolvedScheme } from '@/constants/theme';
import { useThemeStore } from '@/state/theme';

export function useColors(): ThemeColors {
  return useThemeStore((s) => s.colors);
}

export function useTheme(): {
  colors: ThemeColors;
  preference: ThemePreference;
  resolved: ResolvedScheme;
  setPreference: (preference: ThemePreference) => Promise<void>;
} {
  const colors = useThemeStore((s) => s.colors);
  const preference = useThemeStore((s) => s.preference);
  const resolved = useThemeStore((s) => s.resolved);
  const setPreference = useThemeStore((s) => s.setPreference);
  return { colors, preference, resolved, setPreference };
}
