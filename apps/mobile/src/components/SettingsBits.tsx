import React from 'react';
import { Switch, View } from 'react-native';
import { Press, Text } from './ui';
import { Icon, type IconName } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      {title ? <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase', paddingLeft: 6, letterSpacing: 0.8 }}>{title}</Text> : null}
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

export function Row({ icon, label, value, onPress, danger, last, right }: { icon?: IconName; label: string; value?: string; onPress?: () => void; danger?: boolean; last?: boolean; right?: React.ReactNode }) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: last ? 0 : 1, borderColor: colors.cardLine }}>
      {icon ? <Icon name={icon} size={22} color={danger ? colors.danger : colors.textOnCard} /> : null}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" tone={danger ? 'danger' : 'card'}>{label}</Text>
        {value ? <Text variant="small" tone="mutedCard" numberOfLines={1}>{value}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color="#9A9CA3" /> : null)}
    </View>
  );
  if (!onPress) return inner;
  return <Press haptic="tap" scaleTo={0.99} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>{inner}</Press>;
}

export function ToggleRow({ icon, label, value, onChange, hint, last }: { icon?: IconName; label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; last?: boolean }) {
  return <Row icon={icon} label={label} value={hint} last={last} right={<Switch value={value} onValueChange={onChange} trackColor={{ true: colors.ink, false: '#D5D6DA' }} thumbColor="#fff" accessibilityLabel={label} />} />;
}
