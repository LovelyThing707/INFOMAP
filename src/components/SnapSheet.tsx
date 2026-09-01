import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useColors } from '@/hooks/use-colors';

/**
 * @gorhom/bottom-sheet は Reanimated 4 との組み合わせで SDK 54 以降に不具合が続いているため
 * （開かない・スクロールでクラッシュ）、Expo SDK に同梱されてバージョンが揃っている
 * gesture-handler と reanimated だけで組む。
 *
 * ドラッグはヘッダー部分だけで受ける。中身のスクロールとジェスチャーを競合させないための割り切りで、
 * この方が挙動が読みやすい。背面の地図はシートが覆っていない領域でそのまま操作できる。
 */
export interface SnapSheetProps {
  /** 低い順の高さ（px）。[peek, mid, full] */
  snapPoints: number[];
  index: number;
  onIndexChange: (index: number) => void;
  header: ReactNode;
  children: ReactNode;
}

const SPRING = { damping: 22, stiffness: 220, mass: 0.6 } as const;

// ジェスチャーのハンドラはレンダー中には走らないが、コンポーネント本体に書くと
// React Compiler からは描画中の変更に見えてしまう。モジュール側に出して切り離す。
function nearestIndex(offsets: number[], value: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  offsets.forEach((offset, i) => {
    const distance = Math.abs(offset - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

function beginDrag(translateY: SharedValue<number>, dragStart: SharedValue<number>): void {
  dragStart.value = translateY.value;
}

function moveDrag(
  translateY: SharedValue<number>,
  dragStart: SharedValue<number>,
  offsets: number[],
  translation: number
): void {
  const min = offsets[offsets.length - 1];
  const max = offsets[0];
  translateY.value = Math.min(max, Math.max(min, dragStart.value + translation));
}

function endDrag(
  translateY: SharedValue<number>,
  offsets: number[],
  velocity: number,
  index: number,
  onIndexChange: (index: number) => void
): void {
  const next = nearestIndex(offsets, translateY.value + velocity * 0.12);
  translateY.value = withSpring(offsets[next], SPRING);
  if (next !== index) onIndexChange(next);
}

export function SnapSheet({ snapPoints, index, onIndexChange, header, children }: SnapSheetProps) {
  const colors = useColors();
  const maxHeight = snapPoints[snapPoints.length - 1];
  const offsets = useMemo(() => snapPoints.map((h) => maxHeight - h), [snapPoints, maxHeight]);
  const clamped = Math.max(0, Math.min(index, snapPoints.length - 1));

  const translateY = useSharedValue(offsets[Math.min(index, offsets.length - 1)]);
  const dragStart = useSharedValue(0);
  const [headerHeight, setHeaderHeight] = useState(0);

  /**
   * シート本体は常に最大の高さで、下へずらして見える量を変えている。
   * 中身まで最大の高さにすると、リストの表示領域が画面外まで伸びて
   * スクロールしても見えている範囲が動かない。いま見えているぶんだけを中身の高さにする。
   */
  const bodyHeight = Math.max(0, snapPoints[clamped] - headerHeight);

  useEffect(() => {
    const target = offsets[Math.max(0, Math.min(index, offsets.length - 1))];
    translateY.value = withSpring(target, SPRING);
  }, [index, offsets, translateY]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // JSスレッドで完結させる。シートのドラッグ程度なら十分で、worklet 境界の事故を避けられる
        .runOnJS(true)
        .onStart(() => beginDrag(translateY, dragStart))
        .onUpdate((event) => moveDrag(translateY, dragStart, offsets, event.translationY))
        .onEnd((event) => endDrag(translateY, offsets, event.velocityY, index, onIndexChange)),
    [offsets, index, onIndexChange, translateY, dragStart]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          height: maxHeight,
          backgroundColor: colors.bg,
          borderColor: colors.border,
        },
        animatedStyle,
      ]}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.header}
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
          <View style={[styles.grabber, { backgroundColor: colors.bgSunken }]} />
          {header}
        </View>
      </GestureDetector>
      <View style={[styles.body, { height: bodyHeight }]}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.lg + 6,
    borderTopRightRadius: Radius.lg + 6,
    borderTopWidth: 1,
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
    overflow: 'hidden',
  },
  header: { paddingTop: 8, paddingBottom: 4 },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  body: { overflow: 'hidden' },
});
