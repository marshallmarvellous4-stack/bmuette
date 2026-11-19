import React, { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { BMark } from './BMark';
import { colors } from '@/theme/tokens';

// Loading: the B breathes while a soft ring pulses outward. Used wherever a screen is waiting for data.
export function LoadingMark({ size = 72 }: { size?: number }) {
  const breathe = useSharedValue(0);
  const ring = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    ring.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }), -1, false);
  }, [breathe, ring]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.92 + breathe.value * 0.1 }], opacity: 0.75 + breathe.value * 0.25 }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - ring.value), transform: [{ scale: 1 + ring.value * 0.9 }] }));
  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <Animated.View style={[{ position: 'absolute', width: size * 1.3, height: size * 1.3, borderRadius: size, borderWidth: 1.5, borderColor: '#fff' }, ringStyle]} />
      <Animated.View style={markStyle}>
        <BMark size={size} />
      </Animated.View>
    </View>
  );
}

function Float({ children, delay = 0, amplitude = 6, style: place }: { children: React.ReactNode; delay?: number; amplitude?: number; style?: ViewStyle }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-amplitude, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1));
  }, [y, delay, amplitude]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[place, style]}>{children}</Animated.View>;
}

export type IllustrationKind = 'video' | 'bag' | 'chat' | 'search';

// Empty states: a small composition of white cards. Each has one moving piece so the screen never feels dead.
export function Illustration({ kind, size = 180 }: { kind: IllustrationKind; size?: number }) {
  const s = size / 180;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 180 180" style={{ position: 'absolute' }}>
        <Circle cx="90" cy="92" r="70" fill="#17181B" />
        <Circle cx="90" cy="92" r="70" stroke="#fff" strokeOpacity={0.08} fill="none" />
        {kind === 'video' && (
          <>
            <Rect x="58" y="44" width="64" height="92" rx="14" fill="#fff" />
            <Rect x="66" y="52" width="48" height="58" rx="8" fill="#0B0B0D" />
            <Rect x="66" y="118" width="30" height="5" rx="2.5" fill="#D8D9DD" />
          </>
        )}
        {kind === 'bag' && (
          <>
            <Rect x="52" y="66" width="76" height="68" rx="12" fill="#fff" />
            <Path d="M74 74V64a16 16 0 0 1 32 0v10" stroke="#fff" strokeWidth={5} strokeLinecap="round" fill="none" />
            <Circle cx="90" cy="100" r="8" fill="#0B0B0D" />
          </>
        )}
        {kind === 'chat' && (
          <>
            <Rect x="44" y="54" width="70" height="40" rx="14" fill="#fff" />
            <Rect x="70" y="86" width="66" height="40" rx="14" fill="#2B2C31" />
            <Rect x="54" y="68" width="34" height="5" rx="2.5" fill="#0B0B0D" />
            <Rect x="54" y="78" width="22" height="5" rx="2.5" fill="#C9CACF" />
          </>
        )}
        {kind === 'search' && (
          <>
            <Circle cx="82" cy="84" r="28" stroke="#fff" strokeWidth={9} fill="none" />
            <Path d="m104 106 22 22" stroke="#fff" strokeWidth={9} strokeLinecap="round" />
          </>
        )}
      </Svg>
      <Float delay={200} amplitude={5 * s} style={{ position: 'absolute', top: size * 0.1, right: size * 0.12 }}>
        <View style={{ width: 12 * s, height: 12 * s, borderRadius: 6 * s, backgroundColor: colors.card }} />
      </Float>
      <Float delay={700} amplitude={4 * s} style={{ position: 'absolute', bottom: size * 0.18, left: size * 0.06 }}>
        <View style={{ width: 8 * s, height: 8 * s, borderRadius: 4 * s, backgroundColor: '#5B5D66' }} />
      </Float>
    </View>
  );
}
