import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { GOLD, metaFor } from './giftMeta';

// Eight hand-built gifts on a 100 x 100 grid. Each one is a small object with a light source in the top left,
// so they read as jewels on black rather than stickers.

function Grad({ id, stops, x2 = 1, y2 = 1 }: { id: string; stops: [number, string, number?][]; x2?: number; y2?: number }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={String(x2)} y2={String(y2)}>
      {stops.map(([o, c, op], i) => <Stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />)}
    </LinearGradient>
  );
}
function Radial({ id, stops, cx = 0.35, cy = 0.3, r = 0.8 }: { id: string; stops: [number, string, number?][]; cx?: number; cy?: number; r?: number }) {
  return (
    <RadialGradient id={id} cx={String(cx)} cy={String(cy)} r={String(r)}>
      {stops.map(([o, c, op], i) => <Stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />)}
    </RadialGradient>
  );
}
const goldStops: [number, string][] = [[0, GOLD.light], [0.45, GOLD.mid], [1, GOLD.deep]];

function Spark({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}g`} stops={goldStops} />
        <Grad id={`${k}w`} stops={[[0, '#FFFFFF'], [1, '#FFE9A8']]} />
      </Defs>
      <Path d="M50 6C54 36 64 46 94 50 64 54 54 64 50 94 46 64 36 54 6 50 36 46 46 36 50 6Z" fill={`url(#${k}g)`} />
      <Path d="M50 6C54 36 64 46 94 50 64 54 54 64 50 94Z" fill="#fff" opacity={0.16} />
      <Path d="M50 22C52 40 60 48 78 50 60 52 52 60 50 78 48 60 40 52 22 50 40 48 48 40 50 22Z" fill={`url(#${k}w)`} opacity={0.92} />
      <Path d="M80 14c.8 4 2.4 5.6 6.4 6.4-4 .8-5.6 2.4-6.4 6.4-.8-4-2.4-5.6-6.4-6.4 4-.8 5.6-2.4 6.4-6.4Z" fill={GOLD.light} />
      <Circle cx={50} cy={50} r={3} fill="#fff" />
    </>
  );
}

function Rose({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}s`} stops={[[0, '#6FB07A'], [1, '#1E5B3B']]} x2={0} y2={1} />
        <Radial id={`${k}b`} stops={[[0, '#FF6F8E'], [0.55, '#C8183F'], [1, '#6B0A27']]} cx={0.38} cy={0.3} r={0.85} />
        <Grad id={`${k}p`} stops={[[0, '#FF9BB0'], [1, '#B3123A']]} />
        <Grad id={`${k}i`} stops={[[0, '#E23A5F'], [1, '#7A0C2C']]} />
      </Defs>
      <Path d="M50 56C49 70 52 82 50 96" stroke={`url(#${k}s)`} strokeWidth={4.4} strokeLinecap="round" fill="none" />
      <Path d="M50 80C60 74 70 76 76 70 74 82 62 88 50 84Z" fill={`url(#${k}s)`} />
      <Path d="M50 72C42 66 32 68 26 62 28 74 38 80 50 76Z" fill={`url(#${k}s)`} opacity={0.9} />
      <Path d="M20 34C18 16 34 6 50 8c16-2 32 8 30 26-1 16-14 28-30 28S21 50 20 34Z" fill={`url(#${k}b)`} />
      <Path d="M28 30C30 20 40 16 50 20 46 28 40 34 30 40Z" fill={`url(#${k}p)`} opacity={0.9} />
      <Path d="M72 30C70 20 60 16 50 20c4 8 10 14 20 20Z" fill={`url(#${k}i)`} opacity={0.95} />
      <Path d="M32 42C34 54 42 58 50 58s16-4 18-16C60 48 40 48 32 42Z" fill={`url(#${k}i)`} />
      <Path d="M38 32c0-8 6-12 12-12s12 4 12 12-6 12-12 12-12-4-12-12Z" fill={`url(#${k}p)`} opacity={0.85} />
      <Path d="M44 30c0-4 3-6 6-6s6 2 6 6c0 3-2 5-5 5.5" stroke="#7A0C2C" strokeWidth={1.8} strokeLinecap="round" fill="none" opacity={0.8} />
      <Path d="M30 24c3-6 8-9 14-10" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" opacity={0.35} fill="none" />
    </>
  );
}

function Gem({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}a`} stops={[[0, '#E8FBFF'], [1, '#6FCBFF']]} />
        <Grad id={`${k}b`} stops={[[0, '#9FE4FF'], [1, '#3A8BFF']]} />
        <Grad id={`${k}c`} stops={[[0, '#6FB4FF'], [1, '#5A3FD8']]} />
        <Grad id={`${k}d`} stops={[[0, '#3F6BE6'], [1, '#2B1A8F']]} />
      </Defs>
      <Path d="M30 20h40l20 24H10Z" fill={`url(#${k}b)`} />
      <Path d="M30 20h40L58 44H42Z" fill={`url(#${k}a)`} />
      <Path d="M10 44 30 20l12 24Z" fill={`url(#${k}a)`} opacity={0.75} />
      <Path d="M90 44 70 20 58 44Z" fill={`url(#${k}c)`} opacity={0.9} />
      <Path d="M10 44h32L50 92Z" fill={`url(#${k}c)`} />
      <Path d="M42 44h16L50 92Z" fill={`url(#${k}b)`} />
      <Path d="M58 44h32L50 92Z" fill={`url(#${k}d)`} />
      <Path d="M30 20h40l20 24H10Z" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.2} fill="none" strokeLinejoin="round" />
      <Path d="M10 44h80L50 92Z" stroke="#fff" strokeOpacity={0.3} strokeWidth={1} fill="none" strokeLinejoin="round" />
      <Path d="M36 26h14l-6 12Z" fill="#fff" opacity={0.7} />
    </>
  );
}

function Crown({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}g`} stops={goldStops} />
        <Grad id={`${k}h`} stops={[[0, '#FFF6D6'], [0.5, '#F0C45C'], [1, '#9A6A22']]} x2={1} y2={0} />
        <Radial id={`${k}r`} stops={[[0, '#FF7C90'], [1, '#9C0F32']]} />
        <Radial id={`${k}e`} stops={[[0, '#9CF2C9'], [1, '#0E8A5A']]} />
      </Defs>
      <Path d="M16 72 10 30l24 20 16-28 16 28 24-20-6 42Z" fill={`url(#${k}g)`} />
      <Path d="M50 22 34 50 16 72h34Z" fill="#fff" opacity={0.18} />
      <Path d="M16 72 10 30l24 20" stroke={GOLD.light} strokeOpacity={0.7} strokeWidth={1.4} fill="none" strokeLinejoin="round" />
      <Rect x={14} y={72} width={72} height={14} rx={4} fill={`url(#${k}h)`} />
      <Rect x={14} y={72} width={72} height={3} rx={1.5} fill="#fff" opacity={0.45} />
      <Circle cx={10} cy={28} r={4.4} fill={GOLD.light} />
      <Circle cx={50} cy={19} r={5} fill={GOLD.light} />
      <Circle cx={90} cy={28} r={4.4} fill={GOLD.light} />
      <Circle cx={50} cy={79} r={4.4} fill={`url(#${k}r)`} />
      <Circle cx={30} cy={79} r={3} fill={`url(#${k}e)`} />
      <Circle cx={70} cy={79} r={3} fill={`url(#${k}e)`} />
      <Circle cx={48.6} cy={77.6} r={1.2} fill="#fff" opacity={0.8} />
    </>
  );
}

function Rocket({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}b`} stops={[[0, '#FFFFFF'], [0.5, '#E6E8EF'], [1, '#9CA3B5']]} x2={1} y2={0} />
        <Grad id={`${k}n`} stops={[[0, '#FF8A5C'], [1, '#C21F3A']]} />
        <Grad id={`${k}f`} stops={[[0, '#FFF3B0'], [0.45, '#FF9A3D'], [1, '#FF3D6A', 0]]} x2={0} y2={1} />
        <Radial id={`${k}w`} stops={[[0, '#BFEFFF'], [1, '#1E5FB8']]} />
      </Defs>
      <G rotation={38} originX={50} originY={50}>
        <Path d="M50 74C40 86 44 96 50 100 56 96 60 86 50 74Z" fill={`url(#${k}f)`} />
        <Path d="M50 76C46 84 48 90 50 94 52 90 54 84 50 76Z" fill="#FFF8D6" opacity={0.9} />
        <Path d="M36 56 22 74l-2 8 18-6Z" fill={`url(#${k}n)`} />
        <Path d="M64 56 78 74l2 8-18-6Z" fill={`url(#${k}n)`} />
        <Path d="M50 4C34 18 32 42 34 70h32C68 42 66 18 50 4Z" fill={`url(#${k}b)`} />
        <Path d="M50 4C40 12 35 24 34 38h32C65 24 60 12 50 4Z" fill={`url(#${k}n)`} />
        <Rect x={34} y={68} width={32} height={6} rx={2} fill={GOLD.mid} />
        <Circle cx={50} cy={46} r={9} fill={GOLD.deep} />
        <Circle cx={50} cy={46} r={6.8} fill={`url(#${k}w)`} />
        <Circle cx={47.5} cy={43.5} r={2} fill="#fff" opacity={0.85} />
      </G>
    </>
  );
}

function Trophy({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Grad id={`${k}g`} stops={goldStops} x2={1} y2={0.2} />
        <Grad id={`${k}d`} stops={[[0, '#F3D58A'], [1, '#7A5218']]} x2={0} y2={1} />
        <Grad id={`${k}m`} stops={[[0, '#2A2218'], [1, '#0E0B07']]} x2={0} y2={1} />
      </Defs>
      <Path d="M24 22H10c0 18 6 28 20 32" stroke={`url(#${k}d)`} strokeWidth={5} strokeLinecap="round" fill="none" />
      <Path d="M76 22h14c0 18-6 28-20 32" stroke={`url(#${k}d)`} strokeWidth={5} strokeLinecap="round" fill="none" />
      <Path d="M22 10h56v24c0 20-12 32-28 32S22 54 22 34Z" fill={`url(#${k}g)`} />
      <Path d="M22 10h24v56c-14-2-24-14-24-32Z" fill="#fff" opacity={0.2} />
      <Rect x={22} y={10} width={56} height={5} rx={2.5} fill={GOLD.light} opacity={0.8} />
      <Path d="m50 24 3.6 7.4 8 1.1-5.8 5.6 1.4 8L50 42.200 42.800 46l1.400-8-5.800-5.600 8-1.100Z" fill="#fff" opacity={0.92} />
      <Path d="M44 64h12l2 14H42Z" fill={`url(#${k}d)`} />
      <Rect x={30} y={78} width={40} height={8} rx={3} fill={`url(#${k}g)`} />
      <Rect x={24} y={86} width={52} height={9} rx={3} fill={`url(#${k}m)`} />
      <Rect x={24} y={86} width={52} height={1.6} fill={GOLD.mid} opacity={0.8} />
      <Rect x={42} y={89.500} width={16} height={2.200} rx={1.100} fill={GOLD.mid} opacity={0.9} />
    </>
  );
}

function Supernova({ k }: { k: string }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <>
      <Defs>
        <Radial id={`${k}c`} stops={[[0, '#FFFFFF'], [0.3, '#FFE9A8'], [0.65, '#FF7AD1'], [1, '#7A2BD6']]} cx={0.5} cy={0.5} r={0.5} />
        <Radial id={`${k}h`} stops={[[0, '#FF7AD1', 0.55], [1, '#7A2BD6', 0]]} cx={0.5} cy={0.5} r={0.5} />
        <Grad id={`${k}r`} stops={[[0, '#FFF3C4'], [1, '#FF7AD1', 0]]} x2={0} y2={1} />
      </Defs>
      <Circle cx={50} cy={50} r={48} fill={`url(#${k}h)`} />
      {rays.map((a) => (
        <Path key={a} d={a % 60 === 0 ? 'M50 50 46.500 14 50 2 53.500 14Z' : 'M50 50 47.800 24 50 14 52.200 24Z'} fill={`url(#${k}r)`} rotation={a} originX={50} originY={50} opacity={a % 60 === 0 ? 1 : 0.75} />
      ))}
      <Circle cx={50} cy={50} r={22} fill={`url(#${k}c)`} />
      <Circle cx={50} cy={50} r={22} stroke="#fff" strokeOpacity={0.55} strokeWidth={1.200} fill="none" />
      <Circle cx={50} cy={50} r={9} fill="#fff" />
      <Ellipse cx={43} cy={42} rx={6} ry={3.500} fill="#fff" opacity={0.7} rotation={-35} originX={43} originY={42} />
    </>
  );
}

function Orbit({ k }: { k: string }) {
  return (
    <>
      <Defs>
        <Radial id={`${k}p`} stops={[[0, '#C9B8FF'], [0.45, '#6C4BE0'], [1, '#1A1052']]} cx={0.34} cy={0.3} r={0.85} />
        <Grad id={`${k}r`} stops={[[0, '#FFF1C2'], [0.5, '#E8C77A'], [1, '#B88A3E']]} x2={1} y2={0} />
        <Grad id={`${k}b`} stops={[[0, '#7A5A2A'], [1, '#C79C4E']]} x2={1} y2={0} />
      </Defs>
      <G rotation={-22} originX={50} originY={50}>
        <Path d="M3 50A47 14 0 0 1 97 50" stroke={`url(#${k}b)`} strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.8} />
      </G>
      <Circle cx={50} cy={50} r={28} fill={`url(#${k}p)`} />
      <Path d="M24 44c10-4 22-4 52 2M23 56c12-2 26 0 54 4" stroke="#fff" strokeOpacity={0.12} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Ellipse cx={40} cy={36} rx={10} ry={6} fill="#fff" opacity={0.28} rotation={-30} originX={40} originY={36} />
      <G rotation={-22} originX={50} originY={50}>
        <Path d="M3 50A47 14 0 0 0 97 50" stroke={`url(#${k}r)`} strokeWidth={5.500} fill="none" strokeLinecap="round" />
        <Path d="M10 53A42 11 0 0 0 90 53" stroke="#fff" strokeOpacity={0.45} strokeWidth={1} fill="none" strokeLinecap="round" />
      </G>
      <Circle cx={86} cy={20} r={3.400} fill={GOLD.light} />
    </>
  );
}

const ART = { spark: Spark, rose: Rose, gem: Gem, crown: Crown, rocket: Rocket, trophy: Trophy, supernova: Supernova, orbit: Orbit } as const;

// ---- ambient motion: one clock drives every glint and particle, so a whole tray costs very little ----
function Glint({ phase, x, y, size, offset }: { phase: { value: number }; x: number; y: number; size: number; offset: number }) {
  const st = useAnimatedStyle(() => {
    const t = (phase.value + offset) % 1;
    const s = t < 0.5 ? t * 2 : (1 - t) * 2;
    const e = s * s;
    return { opacity: e, transform: [{ scale: 0.3 + 0.9 * e }, { rotate: `${t * 90}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }, st]}>
      <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M12 0C13 8 16 11 24 12 16 13 13 16 12 24 11 16 8 13 0 12 8 11 11 8 12 0Z" fill="#FFF6D6" /></Svg>
    </Animated.View>
  );
}
function Mote({ phase, x, size, offset, rise, color }: { phase: { value: number }; x: number; size: number; offset: number; rise: number; color: string }) {
  const st = useAnimatedStyle(() => {
    const t = (phase.value * 2 + offset) % 1;
    return { opacity: t < 0.2 ? t * 5 : (1 - t) * 1.25, transform: [{ translateY: -t * rise }, { translateX: Math.sin((t + offset) * 6.28) * 4 }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, bottom: 4, width: size, height: size, borderRadius: size, backgroundColor: color }, st]} />;
}

const GLINTS: [number, number][] = [[0.2, 0.22], [0.82, 0.3], [0.7, 0.8]];
const MOTES = [0.12, 0.3, 0.48, 0.66, 0.84, 0.95];

export function GiftArt({ slug, size = 96, ambient = true }: { slug: string; size?: number; ambient?: boolean }) {
  const k = useId().replace(/[^a-zA-Z0-9]/g, '');
  const meta = metaFor(slug);
  const Art = ART[(slug in ART ? slug : 'spark') as keyof typeof ART];
  const reduce = useReducedMotion();
  const phase = useSharedValue(0);
  const live = ambient && !reduce;
  React.useEffect(() => {
    if (!live) return;
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: 3600, easing: Easing.linear }), -1, false);
  }, [live, phase]);
  const float = useAnimatedStyle(() => ({ transform: [{ translateY: Math.sin(phase.value * 6.2832) * (size * 0.018) }] }));
  const glints = meta.tier >= 3 ? 3 : 2;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ width: size, height: size }, live ? float : null]}>
        <Svg width={size} height={size} viewBox="0 0 100 100"><Art k={k} /></Svg>
      </Animated.View>
      {live ? GLINTS.slice(0, glints).map(([gx, gy], i) => <Glint key={i} phase={phase} x={gx * size} y={gy * size} size={Math.max(8, size * 0.2)} offset={i * 0.33} />) : null}
      {live && meta.tier >= 3 ? MOTES.map((mx, i) => <Mote key={i} phase={phase} x={mx * size} size={Math.max(2, size * 0.035)} offset={i / MOTES.length} rise={size * 0.55} color={i % 2 ? meta.glow : GOLD.light} />) : null}
    </View>
  );
}
