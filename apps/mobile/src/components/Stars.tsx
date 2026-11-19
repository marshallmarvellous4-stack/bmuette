import React from 'react';
import { View } from 'react-native';
import { Press, Text } from './ui';
import { Icon } from '@/theme/icons';
import { haptics } from '@/theme/haptics';

/** Five stars. Read-only when onChange is missing. */
export function Stars({ value, size = 16, onChange, color = '#FFB400' }: { value: number; size?: number; onChange?: (n: number) => void; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: onChange ? 8 : 2 }} accessible accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= Math.round(value);
        const star = <Icon name="star" size={size} color={on ? color : '#B7B9C0'} active={on} />;
        return onChange
          ? <Press key={n} haptic="select" onPress={() => { haptics.select(); onChange(n); }} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>{star}</Press>
          : <View key={n}>{star}</View>;
      })}
    </View>
  );
}

export function RatingLine({ avg, count, tone = 'mutedCard' }: { avg: number; count: number; tone?: 'mutedCard' | 'muted' }) {
  if (!count) return <Text variant="small" tone={tone}>No reviews yet</Text>;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Stars value={avg} size={14} /><Text variant="small" tone={tone}>{avg.toFixed(1)} ({count})</Text></View>;
}
