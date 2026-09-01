import { type ReactNode, createElement, useMemo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  type Metrics,
} from 'react-native-safe-area-context';

/** iPhone 17 Pro。論理ピクセル 402×874、Dynamic Island 込みのセーフエリア */
export const IPHONE_17_PRO = {
  width: 402,
  height: 874,
  // Island 下端（約 48px）のすぐ下。実機 59 より少し詰める
  // bottom はホームインジケータ相当。実機 34 より少し詰める
  insets: { top: 52, left: 0, right: 0, bottom: 28 },
} as const;

const FRAME_QUERY = 'frame';
const FRAME_VALUE = '17pro';

const INNER_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: IPHONE_17_PRO.width, height: IPHONE_17_PRO.height },
  insets: IPHONE_17_PRO.insets,
};

/**
 * iframe 内では CSS の safe-area-inset-* が常に 0 なので、
 * NativeSafeAreaProvider の計測で inset が潰れる。
 * 計測を使わず、実機相当の inset だけを Context で渡す。
 */
function LockedPhoneSafeArea({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={INNER_METRICS}>
      <SafeAreaInsetsContext.Provider value={IPHONE_17_PRO.insets}>
        <SafeAreaFrameContext.Provider value={INNER_METRICS.frame}>
          {children}
        </SafeAreaFrameContext.Provider>
      </SafeAreaInsetsContext.Provider>
    </SafeAreaProvider>
  );
}

function isInnerFrame(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(FRAME_QUERY) === FRAME_VALUE;
}

function innerSrc(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(FRAME_QUERY, FRAME_VALUE);
  return url.pathname + url.search + url.hash;
}

/**
 * デスクトップの Web では、中身を iPhone 17 Pro の窓として開く。
 * iframe にしないと Dimensions がブラウザ全体の幅のままになり、縮尺が合わない。
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function PhoneStage({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== 'web') {
    return <SafeAreaProvider>{children}</SafeAreaProvider>;
  }

  if (isInnerFrame()) {
    return <LockedPhoneSafeArea>{children}</LockedPhoneSafeArea>;
  }

  // 実機・狭い窓では枠を出さない。幅だけで見ると横向きのスマホがデスクトップ扱いになり、
  // 402×874 の iframe が画面からはみ出して拡大されたように操作不能になる。
  const roomy =
    width >= IPHONE_17_PRO.width + 64 && height >= IPHONE_17_PRO.height + 48 && !isTouchDevice();
  if (!roomy) {
    return <SafeAreaProvider>{children}</SafeAreaProvider>;
  }

  return <DesktopPhoneFrame />;
}

function DesktopPhoneFrame() {
  const src = useMemo(() => innerSrc(), []);

  return (
    <View style={styles.stage}>
      <Text style={styles.caption}>iPhone 17 Pro · 402 × 874</Text>
      <View style={styles.bezel}>
        <View style={styles.island} />
        {createElement('iframe', {
          src,
          title: 'iPhone 17 Pro',
          allow: 'geolocation',
          style: {
            width: IPHONE_17_PRO.width,
            height: IPHONE_17_PRO.height,
            border: 'none',
            borderRadius: 44,
            background: '#fff',
            display: 'block',
          },
        })}
        <View style={styles.home} pointerEvents="none" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
    gap: 14,
  },
  caption: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  bezel: {
    position: 'relative',
    width: IPHONE_17_PRO.width + 16,
    height: IPHONE_17_PRO.height + 16,
    borderRadius: 52,
    backgroundColor: '#1A1A1C',
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
  },
  island: {
    position: 'absolute',
    // ベゼル padding 8 + 画面上 11 ≈ 実機の Island 位置
    top: 19,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -63,
    width: 126,
    height: 37,
    borderRadius: 20,
    backgroundColor: '#000',
    zIndex: 2,
    pointerEvents: 'none',
  },
  home: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -60,
    width: 120,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
    zIndex: 2,
  },
});
