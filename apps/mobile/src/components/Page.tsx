import React from 'react';
import { KeyboardAvoidingView, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Text } from './ui';
import { colors } from '@/theme/tokens';

// The common frame for secondary screens: back button, big title, scrolling body on black.
export function Page({ title, subtitle, children, right, onBack, scroll = true, contentStyle }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode; onBack?: () => void; scroll?: boolean; contentStyle?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  const head = (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <IconButton icon="back" tone="ink" label="Go back" onPress={back} />
        {right}
      </View>
      <Text variant="title" style={{ marginTop: 14 }}>{title}</Text>
      {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
    </View>
  );
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.ink, padding: 20, paddingTop: insets.top + 12, gap: 18 }, contentStyle]}>{head}{children}</View>;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, gap: 22 }]}>
        {head}
        <View style={[{ gap: 22 }, contentStyle]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
