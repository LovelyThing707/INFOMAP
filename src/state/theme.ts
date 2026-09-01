import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform } from 'react-native';
import { create } from 'zustand';

import {
  paletteFor,
  type ResolvedScheme,
  type ThemeColors,
  type ThemePreference,
} from '@/constants/theme';

const STORAGE_KEY = 'infomap.theme.preference.v1';

function readSystemScheme(): ResolvedScheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

function resolve(preference: ThemePreference, system: ResolvedScheme): ResolvedScheme {
  if (preference === 'system') return system;
  return preference;
}

function applyDomTheme(scheme: ResolvedScheme): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.documentElement.dataset.theme = scheme;
  document.documentElement.style.colorScheme = scheme;
}

interface ThemeState {
  ready: boolean;
  preference: ThemePreference;
  system: ResolvedScheme;
  resolved: ResolvedScheme;
  colors: ThemeColors;
  init: () => Promise<void>;
  setPreference: (preference: ThemePreference) => Promise<void>;
  setSystem: (system: ResolvedScheme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ready: false,
  preference: 'system',
  system: readSystemScheme(),
  resolved: readSystemScheme(),
  colors: paletteFor(readSystemScheme()),

  async init() {
    if (get().ready) return;
    let preference: ThemePreference = 'system';
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw === 'system' || raw === 'light' || raw === 'dark') preference = raw;
    } catch {
      // ignore
    }
    const system = readSystemScheme();
    const resolved = resolve(preference, system);
    applyDomTheme(resolved);
    set({
      ready: true,
      preference,
      system,
      resolved,
      colors: paletteFor(resolved),
    });
  },

  async setPreference(preference) {
    const resolved = resolve(preference, get().system);
    applyDomTheme(resolved);
    set({ preference, resolved, colors: paletteFor(resolved) });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore
    }
  },

  setSystem(system) {
    const resolved = resolve(get().preference, system);
    applyDomTheme(resolved);
    set({ system, resolved, colors: paletteFor(resolved) });
  },
}));

/** Appearance の変化を store に流す。_layout から一度だけ呼ぶ */
export function bindSystemAppearance(): () => void {
  const sub = Appearance.addChangeListener(({ colorScheme }) => {
    useThemeStore.getState().setSystem(colorScheme === 'dark' ? 'dark' : 'light');
  });
  return () => sub.remove();
}
