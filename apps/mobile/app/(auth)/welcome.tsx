import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BMark } from '@/components/BMark';
import { Button, Text } from '@/components/ui';
import { colors } from '@/theme/tokens';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingHorizontal: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <Animated.View entering={FadeInDown.duration(500)}><BMark size={72} /></Animated.View>
        <Animated.View entering={FadeInDown.delay(120).duration(500)} style={{ gap: 14 }}>
          <Text variant="display">Watch it.{'\n'}Love it.{'\n'}Get it.</Text>
          <Text variant="body" tone="muted" style={{ maxWidth: 300 }}>Videos and photos you can shop, join and book without ever leaving the app.</Text>
        </Animated.View>
      </View>
      <Animated.View entering={FadeInDown.delay(260).duration(500)} style={{ gap: 12 }}>
        <Button title="Create account" major onPress={() => router.push('/register')} />
        <Button title="I already have an account" tone="ghost" onPress={() => router.push('/login')} />
      </Animated.View>
    </View>
  );
}
