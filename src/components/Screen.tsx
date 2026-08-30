import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, MAX_CONTENT_WIDTH, Spacing } from '@/constants/theme';

export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.inner}>
            {header}
            {children}
          </View>
        </ScrollView>
      ) : (
        <View style={[styles.inner, styles.flexInner]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scrollContent: { paddingBottom: 48 },
  inner: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  flexInner: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text, fontFamily: Fonts.sans },
  subtitle: { fontSize: 13, color: Colors.textSub, lineHeight: 19, fontFamily: Fonts.sans },
});
