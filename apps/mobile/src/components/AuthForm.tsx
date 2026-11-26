import React from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Text } from './ui';
import { colors } from '@/theme/tokens';

export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, gap: 24 }}>
        <View style={{ alignSelf: 'flex-start' }}><IconButton icon="back" tone="ink" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} /></View>
        <View style={{ gap: 8 }}>
          <Text variant="title">{title}</Text>
          <Text tone="muted">{subtitle}</Text>
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
