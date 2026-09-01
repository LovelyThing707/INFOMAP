import { type ReactNode, createElement } from 'react';
import { Platform, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Web の ScrollView は Responder と overflow スクロールが同時に動く。
 * 先頭の地図や Vaul と重なると、下スワイプの半分が「閉じる／滑る」になる。
 * Web ではブラウザ標準の overflow だけにする。
 */
export function PageScroll({
  children,
  style,
  contentContainerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS !== 'web') {
    return (
      <ScrollView
        style={style}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled>
        {children}
      </ScrollView>
    );
  }

  return createElement(
    'div',
    { className: 'im-page-scroll' },
    <View style={contentContainerStyle}>{children}</View>
  );
}
