import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press, Text } from './ui';
import { Icon, type IconName } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

// A white bottom sheet over a dimmed screen. Tap outside to close.
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View entering={SlideInDown.duration(220)} style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 10, paddingBottom: insets.bottom + 14, maxHeight: '88%' }}>
            <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,18,20,0.15)', marginBottom: 12 }} />
            {title ? <Text variant="bodyStrong" tone="card" style={{ textAlign: 'center', marginBottom: 8, paddingHorizontal: 20 }}>{title}</Text> : null}
            {children}
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

export type MenuAction = { label: string; icon?: IconName; danger?: boolean; onPress: () => void };

export function MenuRow({ action, onDone }: { action: MenuAction; onDone: () => void }) {
  return (
    <Press haptic="tap" scaleTo={0.985} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => { onDone(); action.onPress(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 15 }}>
      {action.icon ? <Icon name={action.icon} size={22} color={action.danger ? colors.danger : colors.textOnCard} /> : null}
      <Text variant="bodyStrong" tone={action.danger ? 'danger' : 'card'}>{action.label}</Text>
    </Press>
  );
}
