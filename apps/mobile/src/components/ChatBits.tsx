import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Press, Text } from './ui';
import type { ChatMessage, Conversation } from '@/api/chat';
import { formatMoney } from '@/lib/money';
import { listTime } from '@/lib/time';
import { colors, radius } from '@/theme/tokens';

export const preview = (m: ChatMessage | null, me?: string) => {
  if (!m) return 'Say hello';
  const body = m.kind === 'text' ? m.body ?? '' : m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice note' : m.kind === 'product' ? 'Shared a product' : 'Shared a post';
  return m.senderId === me ? `You: ${body}` : body;
};

export function ConversationRow({ c, me, onPress }: { c: Conversation; me?: string; onPress: () => void }) {
  const unread = c.unread > 0;
  return (
    <Press haptic="select" scaleTo={0.985} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Chat with ${c.with.displayName}${unread ? `, ${c.unread} unread` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 4 }}>
      <Avatar name={c.with.displayName} uri={c.with.avatarUrl} size={54} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{c.with.displayName}</Text>
          <Text variant="caption" tone={unread ? 'ink' : 'muted'}>{listTime(c.lastMessageAt)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text numberOfLines={1} tone={unread ? 'ink' : 'muted'} style={{ flex: 1, fontFamily: unread ? 'Inter_600SemiBold' : 'Inter_400Regular' }}>{preview(c.lastMessage, me)}</Text>
          {unread ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" tone="card" style={{ fontFamily: 'Inter_700Bold' }}>{c.unread > 99 ? '99+' : c.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Press>
  );
}

// What a shared product or post looks like inside a bubble: a small white card you can tap.
export function SharedCard({ m, onPress }: { m: ChatMessage; onPress: () => void }) {
  const r = m.ref;
  if (!r) return <Text variant="small" tone="muted" style={{ padding: 4 }}>This {m.kind} is no longer available.</Text>;
  const title = m.kind === 'product' ? r.title : r.caption || `@${r.username}`;
  return (
    <Press haptic="tap" scaleTo={0.97} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${m.kind}`} style={{ width: 220, borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden' }}>
      {r.thumbUrl ? <Image source={{ uri: r.thumbUrl }} style={{ width: 220, height: 160, backgroundColor: colors.cardSoft }} contentFit="cover" /> : <View style={{ width: 220, height: 160, backgroundColor: colors.cardSoft }} />}
      <View style={{ padding: 12, gap: 2 }}>
        <Text variant="bodyStrong" tone="card" numberOfLines={2}>{title}</Text>
        {m.kind === 'product' && r.priceMinor !== undefined ? <Text variant="small" tone="mutedCard">{formatMoney(r.priceMinor, r.currency ?? 'NGN')}</Text> : <Text variant="small" tone="mutedCard">{r.kind === 'video' ? 'Video' : 'Photo'} by @{r.username}</Text>}
      </View>
    </Press>
  );
}
