import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { Press, Text } from './ui';
import { Icon, type IconName } from '@/theme/icons';
import { haptics } from '@/theme/haptics';
import { useUnread } from '@/api/chat';
import { useActivityUnread } from '@/api/notifications';
import { tabEvents } from '@/state/ui';
import { colors, shadow, TAB_BAR } from '@/theme/tokens';

const TABS: Record<string, { icon: IconName; label: string }> = {
  index: { icon: 'home', label: 'Home' },
  chat: { icon: 'chat', label: 'Inbox' },
  market: { icon: 'bag', label: 'Market' },
  profile: { icon: 'profile', label: 'You' },
};

function Slot({ focused, icon, label, onPress, badge }: { focused: boolean; icon: IconName; label: string; onPress: () => void; badge?: number }) {
  const lift = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => { lift.value = withSpring(focused ? 1 : 0, { damping: 13, stiffness: 240, mass: 0.7 }); }, [focused, lift]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * lift.value }, { scale: 1 + 0.12 * lift.value }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * lift.value, transform: [{ translateY: -2 * lift.value }] }));
  return (
    <Press haptic="none" scaleTo={0.9} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} outerStyle={styles.slotOuter} style={styles.slot}>
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={24} color={focused ? '#fff' : '#8E9097'} active={focused} />
        {badge ? <View style={styles.badge} /> : null}
      </Animated.View>
      <Animated.View style={labelStyle}>
        <Text variant="caption" style={{ color: focused ? '#fff' : '#8E9097' }}>{label}</Text>
      </Animated.View>
    </Press>
  );
}

// Floating capsule: a white-tinted pill slides under the active tab, the icon lifts, and changing tab gives a firm tap.
export function FloatingTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const router = useRouter();
  const unread = (useUnread().data?.unread ?? 0) + (useActivityUnread().data?.unread ?? 0);
  const { width } = useWindowDimensions();
  const barWidth = width - TAB_BAR.sideGap * 2;
  const slotWidth = barWidth / state.routes.length;
  const x = useSharedValue(state.index * slotWidth);
  const centre = state.routes.findIndex((r) => r.name === 'create');
  const activeIsCentre = state.index === centre;
  React.useEffect(() => { x.value = withSpring(state.index * slotWidth, { damping: 16, stiffness: 210, mass: 0.8 }); }, [state.index, slotWidth, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: activeIsCentre ? 0 : 1 }));

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, TAB_BAR.bottomGap) }]}>
      <View style={[styles.bar, { width: barWidth }]}>
        <Animated.View style={[styles.pill, { width: slotWidth - 12 }, pill]} />
        {state.routes.map((route, index) => {
          if (route.name === 'create') {
            return (
              <View key={route.key} style={[styles.slot, { flex: 1, width: undefined }]}>
                <Press
                  haptic="major"
                  scaleTo={0.88}
                  onPress={() => router.push('/new')}
                  accessibilityRole="button"
                  accessibilityLabel="Create"
                  style={styles.plus}
                >
                  <Icon name="plus" size={26} color={colors.ink} strokeWidth={2.4} />
                </Press>
              </View>
            );
          }
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          return (
            <Slot
              key={route.key}
              focused={focused}
              icon={meta.icon}
              label={meta.label}
              badge={route.name === 'chat' ? unread : 0}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (focused) {
                  haptics.tap();
                  tabEvents.reselect(route.name);
                } else if (!event.defaultPrevented) {
                  haptics.tab();
                  navigateToTab(route.key);
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: { height: TAB_BAR.height, borderRadius: 32, backgroundColor: 'rgba(23,24,27,0.94)', borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', ...shadow.bar },
  pill: { position: 'absolute', left: 6, top: 8, bottom: 8, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.10)' },
  slot: { width: '100%', height: TAB_BAR.height, alignItems: 'center', justifyContent: 'center', gap: 2 },
  slotOuter: { flex: 1, height: TAB_BAR.height },
  plus: { width: 56, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -1, right: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.inkRaised },
});
