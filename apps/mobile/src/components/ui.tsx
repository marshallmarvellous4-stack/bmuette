import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text as RNText, TextInput, View, type PressableProps, type StyleProp, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '@/theme/icons';
import { triggerHaptic, type HapticKind } from '@/theme/haptics';
import { colors, fonts, radius, shadow, type as typeScale } from '@/theme/tokens';

// ---- Text ----
type Variant = keyof typeof typeScale;
export function Text({ variant = 'body', tone = 'ink', style, ...rest }: TextProps & { variant?: Variant; tone?: 'ink' | 'card' | 'muted' | 'mutedCard' | 'danger' }) {
  const color = { ink: colors.textOnInk, card: colors.textOnCard, muted: colors.muted, mutedCard: colors.mutedOnCard, danger: colors.danger }[tone];
  return <RNText {...rest} style={[typeScale[variant], { color }, style]} />;
}

// ---- Press: every tappable thing shrinks a touch and fires its own haptic ----
export function Press({ haptic = 'tap', scaleTo = 0.96, onPress, style, outerStyle, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & { haptic?: HapticKind; scaleTo?: number; style?: StyleProp<ViewStyle>; outerStyle?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      style={outerStyle}
      onPressIn={(e) => { s.value = withSpring(scaleTo, { damping: 18, stiffness: 420 }); rest.onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withSpring(1, { damping: 14, stiffness: 320 }); rest.onPressOut?.(e); }}
      onPress={(e) => { triggerHaptic(haptic); onPress?.(e); }}
    >
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---- Button: white on black screens, black on white cards. "major" buttons get the heavy haptic ----
export function Button({ title, onPress, loading, disabled, tone = 'light', major = false, icon, style }: { title: string; onPress?: () => void; loading?: boolean; disabled?: boolean; tone?: 'light' | 'dark' | 'ghost'; major?: boolean; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const bg = tone === 'light' ? colors.card : tone === 'dark' ? colors.ink : 'transparent';
  const fg = tone === 'light' ? colors.textOnCard : colors.textOnInk;
  return (
    <Press
      haptic={major ? 'major' : 'press'}
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[{ height: 54, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : 1 }, tone === 'ghost' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Icon name={icon} size={20} color={fg} /> : null}
          <RNText style={{ fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.2, color: fg }}>{title}</RNText>
        </>
      )}
    </Press>
  );
}

// ---- Card: the white surface ----
export function Card({ children, style, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[{ backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' }, padded && { padding: 16 }, shadow.card, style]}>{children}</View>;
}

// ---- Field: for forms on black ----
export function Field({ label, error, onCard = false, ...rest }: TextInputProps & { label: string; error?: string | null; onCard?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text variant="small" tone={onCard ? 'mutedCard' : 'muted'}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor="#5E6068"
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        keyboardAppearance={onCard ? 'light' : 'dark'}
        autoCapitalize={rest.autoCapitalize ?? 'none'}
        style={[{ height: 54, borderRadius: radius.md, paddingHorizontal: 16, color: onCard ? colors.textOnCard : colors.textOnInk, fontFamily: fonts.medium, fontSize: 16, backgroundColor: onCard ? colors.cardSoft : colors.inkRaised, borderWidth: 1.5, borderColor: error ? colors.danger : focused ? (onCard ? colors.textOnCard : '#fff') : onCard ? 'transparent' : colors.line }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null, rest.style]}
      />
      {error ? <Text variant="small" tone="danger">{error}</Text> : null}
    </View>
  );
}

// ---- Avatar ----
export function Avatar({ name, uri, size = 40, ring = false }: { name?: string | null; uri?: string | null; size?: number; ring?: boolean }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const box = { width: size, height: size, borderRadius: size / 2 };
  const border = ring ? { borderWidth: 2, borderColor: '#fff' } : null;
  if (uri) return <Image source={{ uri }} style={[box, border, { backgroundColor: colors.inkHigh }]} />;
  return (
    <View style={[box, border, { backgroundColor: colors.inkHigh, alignItems: 'center', justifyContent: 'center' }]}>
      <RNText style={{ color: colors.textOnInk, fontFamily: fonts.bold, fontSize: size * 0.4 }}>{initial}</RNText>
    </View>
  );
}

// ---- Round icon button ----
export function IconButton({ icon, onPress, label, size = 44, tone = 'glass', active = false, haptic = 'tap' }: { icon: IconName; onPress?: () => void; label: string; size?: number; tone?: 'glass' | 'card' | 'ink'; active?: boolean; haptic?: HapticKind }) {
  const bg = tone === 'glass' ? 'rgba(20,20,22,0.55)' : tone === 'card' ? colors.card : colors.inkRaised;
  const fg = tone === 'card' ? colors.textOnCard : '#fff';
  return (
    <Press haptic={haptic} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: tone === 'glass' ? 1 : 0, borderColor: 'rgba(255,255,255,0.12)' }}>
      <Icon name={icon} size={size * 0.5} color={fg} active={active} />
    </Press>
  );
}

// ---- Chip ----
export function Chip({ label, selected, onPress, onCard = false }: { label: string; selected?: boolean; onPress?: () => void; onCard?: boolean }) {
  return (
    <Press haptic="select" onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={{ height: 38, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: onCard ? (selected ? colors.ink : colors.cardSoft) : selected ? colors.card : colors.inkRaised, borderWidth: 1, borderColor: onCard ? 'transparent' : selected ? colors.card : colors.line }}>
      <RNText style={{ fontFamily: fonts.semibold, fontSize: 14, color: onCard ? (selected ? '#fff' : colors.textOnCard) : selected ? colors.textOnCard : colors.textOnInk }}>{label}</RNText>
    </Press>
  );
}

// ---- Skeleton: placeholder that pulses while content loads ----
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const o = useSharedValue(0.55);
  React.useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: colors.inkRaised, borderRadius: radius.md }, style, anim]} />;
}

export const hairline = StyleSheet.hairlineWidth;
