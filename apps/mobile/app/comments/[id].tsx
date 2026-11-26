import React, { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Press, Text } from '@/components/ui';
import { useAddComment, useComments } from '@/api/hooks';
import { confirm, openSafetyMenu } from '@/lib/moderation';
import { api } from '@/api/client';
import { useAuth } from '@/state/auth';
import { useMenu } from '@/state/menu';
import { useQueryClient } from '@tanstack/react-query';
import { timeAgo } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';
import { sheetHeight } from '@/lib/sheetHeight';
import { LinearGradient } from 'expo-linear-gradient';
import { GiftArt } from '@/components/gifts/GiftArt';
import { GOLD, metaFor } from '@/components/gifts/giftMeta';
import { useGiftUi } from '@/state/gifts';
import { useTopGifters } from '@/api/gifts';
import type { Comment } from '@/api/types';

function GiftRow({ c, onHold }: { c: Comment; onHold: () => void }) {
  const g = c.gift!;
  const tier = metaFor(g.slug).tier;
  const glow = metaFor(g.slug).glow;
  return (
    <Pressable onLongPress={onHold} delayLongPress={350} accessibilityLabel={`${c.author.displayName} sent ${g.qty} ${g.name}`} style={{ borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: tier >= 3 ? GOLD.mid : GOLD.light }}>
      <LinearGradient colors={tier >= 3 ? ['#1B1710', '#0E0E10'] : ['#FFFBEF', '#FFF3D1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: tier >= 3 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.7)' }}>
          <View style={{ position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: glow, opacity: 0.18 }} />
          <GiftArt slug={g.slug} size={52} ambient={false} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="small" style={{ color: tier >= 3 ? 'rgba(255,255,255,0.65)' : colors.mutedOnCard }}>@{c.author.username}  ·  {timeAgo(c.createdAt)}</Text>
          <Text variant="bodyStrong" style={{ color: tier >= 3 ? '#fff' : colors.textOnCard }}>Sent {g.qty > 1 ? `${g.qty} × ` : 'a '}{g.name}</Text>
          {g.message ? <Text style={{ color: tier >= 3 ? 'rgba(255,255,255,0.85)' : colors.textOnCard }} numberOfLines={3}>{g.message}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: GOLD.mid, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Icon name="coin" size={14} color={colors.ink} />
          <Text variant="caption" style={{ color: colors.ink, fontFamily: 'Inter_700Bold' }}>{g.coins.toLocaleString()}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export default function Comments() {
  const { id, u, n } = useLocalSearchParams<{ id: string; u?: string; n?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { data, isLoading } = useComments(id);
  const add = useAddComment(id);
  const me = useAuth((x) => x.user?.id);
  const qc = useQueryClient();
  const onHold = (c: { id: string; body: string; author: { id: string; username: string } }) => {
    if (c.author.id === me) {
      useMenu.getState().show({ actions: [{ label: 'Delete comment', icon: 'trash', danger: true, onPress: () => confirm('Delete your comment?', '', 'Delete', async () => { try { await api(`/comments/${c.id}`, { method: 'DELETE' }); } catch {} void qc.invalidateQueries({ queryKey: ['comments', id] }); }) }] });
    } else openSafetyMenu({ target: { type: 'comment', id: c.id, label: c.body }, title: `@${c.author.username}` });
  };
  const [text, setText] = useState('');
  const top = useTopGifters(id);
  const openGift = () => {
    haptics.tap();
    useGiftUi.getState().openTray({ postId: id, creator: { username: u ?? 'creator', displayName: n ?? u ?? 'creator' } });
  };
  const items = data?.items ?? [];

  const send = () => {
    const body = text.trim();
    if (!body || add.isPending) return;
    haptics.send();
    add.mutate(body, { onSuccess: () => setText(''), onError: () => haptics.error() });
  };

  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close comments" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ height: sheetHeight(winH, insets.top, 0.66), backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 10 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,18,20,0.15)', marginBottom: 12 }} />
          <Text variant="bodyStrong" tone="card" style={{ textAlign: 'center', marginBottom: 10 }}>{items.length} {items.length === 1 ? 'comment' : 'comments'}</Text>
          {top.data && top.data.totalCoins > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 8 }}>
              <Icon name="coin" size={16} color={GOLD.deep} />
              <Text variant="small" tone="mutedCard" numberOfLines={1} style={{ flex: 1 }}>{top.data.totalCoins.toLocaleString()} coins gifted · top: {top.data.top.slice(0, 3).map((t) => `@${t.username}`).join(', ')}</Text>
            </View>
          ) : null}
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 18, gap: 18, flexGrow: 1 }}
            ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text tone="mutedCard">{isLoading ? 'Loading' : 'Be the first to comment.'}</Text></View>}
            renderItem={({ item }) => item.kind === 'gift' && item.gift ? <GiftRow c={item} onHold={() => onHold(item)} /> : (
              <Pressable onLongPress={() => onHold(item)} delayLongPress={350} accessibilityHint="Press and hold for options" style={{ flexDirection: 'row', gap: 12 }}>
                <Avatar name={item.author.displayName} uri={item.author.avatarUrl} size={36} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="small" tone="mutedCard">@{item.author.username}  ·  {timeAgo(item.createdAt)}</Text>
                  <Text tone="card">{item.body}</Text>
                </View>
              </Pressable>
            )}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderColor: colors.cardLine }}>
            <Press haptic="none" onPress={openGift} accessibilityRole="button" accessibilityLabel="Send a gift" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="gift" size={21} color={GOLD.mid} active />
            </Press>
            <TextInput value={text} onChangeText={setText} placeholder="Add a comment" placeholderTextColor="#8A8C93" multiline maxLength={1000} style={{ flex: 1, maxHeight: 96, minHeight: 44, borderRadius: 22, backgroundColor: colors.cardSoft, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, color: colors.textOnCard, fontSize: 15, fontFamily: 'Inter_500Medium' }} />
            <Press haptic="none" onPress={send} disabled={!text.trim()} accessibilityRole="button" accessibilityLabel="Send comment" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? colors.ink : 'rgba(17,18,20,0.15)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="send" size={20} color="#fff" active />
            </Press>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
