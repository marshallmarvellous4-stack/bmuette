import React, { useEffect, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop, LinearGradient as SvgLinear } from 'react-native-svg';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { Text } from '../ui';
import { useGiftUi, type BurstShow } from '@/state/gifts';
import { haptics } from '@/theme/haptics';
import { GiftArt } from './GiftArt';
import { GOLD, metaFor } from './giftMeta';

const DURATION = [0, 2500, 2900, 3500, 4000];
const clamp = Extrapolation.CLAMP;

function Blob({ w, h, color, opacity }: { w: number; h: number; color: string; opacity: number }) {
  return (
    <Svg width={w} height={h} pointerEvents="none">
      <Defs><RadialGradient id="b" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={opacity} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
      <Rect width={w} height={h} fill="url(#b)" />
    </Svg>
  );
}

function Rays({ size, color }: { size: number; color: string }) {
  const wedges = useMemo(() => Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2, b = a + (Math.PI * 2) / 18 * 0.42, r = size / 2;
    return `M${r} ${r}L${r + Math.cos(a) * r} ${r + Math.sin(a) * r}L${r + Math.cos(b) * r} ${r + Math.sin(b) * r}Z`;
  }), [size]);
  return (
    <Svg width={size} height={size} pointerEvents="none">
      <Defs><RadialGradient id="r" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={0.55} /><Stop offset="0.7" stopColor={color} stopOpacity={0.12} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
      {wedges.map((d, i) => <Path key={i} d={d} fill="url(#r)" />)}
    </Svg>
  );
}

function Particle({ pop, angle, dist, size, color, t }: { pop: { value: number }; angle: number; dist: number; size: number; color: string; t: { value: number } }) {
  const st = useAnimatedStyle(() => {
    const p = interpolate(t.value, [0, 0.3], [0, 1], clamp);
    const e = 1 - (1 - p) * (1 - p);
    return { opacity: interpolate(t.value, [0, 0.05, 0.5, 0.75], [0, 1, 0.8, 0], clamp), transform: [{ translateX: Math.cos(angle) * dist * e }, { translateY: Math.sin(angle) * dist * e + p * 24 }, { scale: 1 - p * 0.4 }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size, backgroundColor: color }, st]} />;
}

function Shower({ w, h, t, count }: { w: number; h: number; t: { value: number }; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => <Piece key={i} i={i} w={w} h={h} t={t} />)}
    </>
  );
}
function Piece({ i, w, h, t }: { i: number; w: number; h: number; t: { value: number } }) {
  const x = ((i * 53) % 100) / 100 * w, size = 7 + (i * 7) % 9, delay = ((i * 0.071) % 0.55), spin = i % 2 ? 1 : -1;
  const st = useAnimatedStyle(() => {
    const p = interpolate(t.value, [delay * 0.6, delay * 0.6 + 0.62], [0, 1], clamp);
    return { opacity: interpolate(p, [0, 0.08, 0.85, 1], [0, 1, 1, 0], clamp), transform: [{ translateY: -30 + p * (h + 60) }, { translateX: Math.sin(p * 9 + i) * 14 }, { rotate: `${p * 540 * spin}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: 0, width: size, height: size * 1.4 }, st]}>
      <Svg width={size} height={size * 1.4} viewBox="0 0 10 14"><Defs><SvgLinear id="g" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={GOLD.light} /><Stop offset="1" stopColor={GOLD.deep} /></SvgLinear></Defs><Path d="M5 0 10 7 5 14 0 7Z" fill={i % 3 ? 'url(#g)' : '#FFFFFF'} /></Svg>
    </Animated.View>
  );
}

function BurstView({ b }: { b: BurstShow }) {
  const hide = useGiftUi((s) => s.hideBurst);
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const meta = metaFor(b.slug);
  const tier = Math.min(4, Math.max(1, b.tier));
  const dur = DURATION[tier];
  const t = useSharedValue(0), pop = useSharedValue(0), loop = useSharedValue(0);
  const artSize = [0, 120, 190, 230, Math.min(W * 0.72, 300)][tier];

  useEffect(() => {
    t.value = withTiming(1, { duration: dur, easing: Easing.linear });
    pop.value = reduce ? 1 : withSpring(1, { damping: tier >= 3 ? 9 : 12, stiffness: 95 });
    if (!reduce) loop.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1, false);
    if (tier >= 3) { haptics.major(); setTimeout(() => haptics.like(), 220); if (tier === 4) setTimeout(() => haptics.success(), 520); } else haptics.press();
    const id = setTimeout(hide, dur);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const master = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 0.07, 0.88, 1], [0, 1, 1, 0], clamp) }));
  const dim = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 0.08, 0.86, 1], [0, 1, 1, 0], clamp) }));
  const art = useAnimatedStyle(() => {
    if (tier === 1) return { transform: [{ translateY: interpolate(t.value, [0, 1], [H * 0.16, -H * 0.18]) }, { scale: 0.85 + pop.value * 0.15 }] };
    return { transform: [{ scale: 0.15 + pop.value * 0.85 }, { rotate: `${(1 - pop.value) * (tier === 4 ? -24 : -12)}deg` }] };
  });
  const rays = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 0.12], [0, 1], clamp), transform: [{ rotate: `${loop.value * 360}deg` }, { scale: 0.6 + pop.value * 0.4 }] }));
  const text = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0.08, 0.2], [0, 1], clamp), transform: [{ translateY: interpolate(t.value, [0.08, 0.2], [14, 0], clamp) }] }));
  const drift1 = useAnimatedStyle(() => ({ transform: [{ translateX: Math.sin(loop.value * 6.283) * W * 0.12 }, { translateY: Math.cos(loop.value * 6.283) * 24 }, { rotate: '-14deg' }] }));
  const drift2 = useAnimatedStyle(() => ({ transform: [{ translateX: Math.cos(loop.value * 6.283) * W * 0.14 }, { translateY: Math.sin(loop.value * 6.283) * 30 }, { rotate: '18deg' }] }));

  const particles = useMemo(() => Array.from({ length: tier === 4 ? 22 : 14 }, (_, i) => ({ angle: (i / (tier === 4 ? 22 : 14)) * Math.PI * 2 + (i % 3) * 0.12, dist: artSize * (0.55 + ((i * 37) % 50) / 100), size: 4 + (i % 4) * 2, color: i % 3 === 0 ? meta.glow : i % 3 === 1 ? GOLD.light : GOLD.mid })), [tier, artSize, meta.glow]);

  const dimColor = tier === 1 ? 'rgba(0,0,0,0)' : tier === 2 ? 'rgba(0,0,0,0.42)' : tier === 3 ? 'rgba(0,0,0,0.68)' : 'rgba(4,2,10,0.9)';
  const cy = tier === 1 ? H * 0.5 : H * 0.44;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={hide} accessibilityRole="button" accessibilityLabel={`${b.name} sent. Tap to dismiss`}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: dimColor }, dim]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, master]}>
        {tier === 4 ? (
          <>
            <Animated.View style={[{ position: 'absolute', left: -W * 0.3, top: H * 0.02 }, drift1]}><Blob w={W * 1.2} h={H * 0.55} color="#FF4FB8" opacity={0.55} /></Animated.View>
            <Animated.View style={[{ position: 'absolute', left: W * 0.1, top: H * 0.3 }, drift2]}><Blob w={W * 1.1} h={H * 0.5} color="#6B4DFF" opacity={0.5} /></Animated.View>
            <Animated.View style={[{ position: 'absolute', left: -W * 0.2, top: H * 0.55 }, drift1]}><Blob w={W * 1.3} h={H * 0.45} color="#E8C77A" opacity={0.35} /></Animated.View>
          </>
        ) : null}
        {tier >= 3 ? (
          <Animated.View style={[{ position: 'absolute', left: W / 2 - W * 0.8, top: cy - W * 0.8, width: W * 1.6, height: W * 1.6 }, rays]}><Rays size={W * 1.6} color={tier === 4 ? '#FFE9A8' : meta.glow} /></Animated.View>
        ) : null}
        {tier === 4 && !reduce ? <Shower w={W} h={H} t={t} count={30} /> : null}

        <View style={{ position: 'absolute', left: W / 2, top: cy, width: 0, height: 0 }}>
          {tier >= 2 && !reduce ? particles.slice(0, tier === 2 ? 8 : particles.length).map((p, i) => <Particle key={i} pop={pop} t={t} {...p} />) : null}
        </View>

        <Animated.View style={[{ position: 'absolute', left: W / 2 - artSize / 2, top: cy - artSize / 2, width: artSize, height: artSize }, art]}>
          {tier >= 2 ? <View style={{ position: 'absolute', left: -artSize * 0.3, top: -artSize * 0.3, width: artSize * 1.6, height: artSize * 1.6 }}><Blob w={artSize * 1.6} h={artSize * 1.6} color={meta.glow} opacity={tier === 4 ? 0.7 : 0.5} /></View> : null}
          <GiftArt slug={b.slug} size={artSize} />
        </Animated.View>

        <Animated.View style={[{ position: 'absolute', left: 20, right: 20, top: cy + artSize / 2 + (tier === 1 ? 6 : 22), alignItems: 'center', gap: 4 }, text]}>
          <Text style={{ color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: tier === 4 ? 34 : tier === 3 ? 26 : 18, letterSpacing: -0.8, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 }}>{b.name} ×{b.qty}</Text>
          {tier >= 3 ? <Text style={{ color: GOLD.light, fontFamily: 'Inter_600SemiBold', fontSize: tier === 4 ? 17 : 15 }}>for @{b.creator}</Text> : null}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

// Mounted once at the root. The overlay is a transparent modal, so a tap anywhere skips it and nothing is ever left blocking the screen.
export function GiftBurstHost() {
  const burst = useGiftUi((s) => s.burst);
  const hide = useGiftUi((s) => s.hideBurst);
  return (
    <Modal visible={!!burst} transparent animationType="none" statusBarTranslucent onRequestClose={hide}>
      {burst ? <BurstView key={burst.key} b={burst} /> : <View />}
    </Modal>
  );
}
