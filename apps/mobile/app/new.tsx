import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { Press, Text } from '@/components/ui';
import { Icon, type IconName } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

function Option({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Press haptic="press" scaleTo={0.97} onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg, backgroundColor: colors.cardSoft }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={24} color="#fff" /></View>
      <View style={{ flex: 1 }}><Text variant="bodyStrong" tone="card">{title}</Text><Text variant="small" tone="mutedCard">{sub}</Text></View>
      <Icon name="back" size={18} color="#8A8C93" />
    </Press>
  );
}

// The sheet the centre "+" opens.
export default function CreateSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const go = (path: '/compose' | '/sell', kind?: 'video' | 'photo') => { router.replace(kind ? { pathname: path as '/compose', params: { kind } } : (path as '/sell')); };
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
      <Animated.View entering={FadeIn.duration(180)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={SlideInDown.springify().damping(20).stiffness(220)} style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: insets.bottom + 20, gap: 12 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,18,20,0.15)', marginBottom: 4 }} />
        <Text variant="heading" tone="card" style={{ marginBottom: 4 }}>Create</Text>
        <Option icon="video" title="Post a video" sub="Share a clip people can watch and act on" onPress={() => go('/compose', 'video')} />
        <Option icon="image" title="Post a photo" sub="Show something worth saving" onPress={() => go('/compose', 'photo')} />
        <Option icon="bag" title="Sell a product" sub="List something in the market" onPress={() => go('/sell')} />
      </Animated.View>
    </View>
  );
}
