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

export default function Comments() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
        <View style={{ height: Math.min(520, Math.round(winH * 0.72)), backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 10 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,18,20,0.15)', marginBottom: 12 }} />
          <Text variant="bodyStrong" tone="card" style={{ textAlign: 'center', marginBottom: 10 }}>{items.length} {items.length === 1 ? 'comment' : 'comments'}</Text>
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ padding: 18, gap: 18, flexGrow: 1 }}
            ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text tone="mutedCard">{isLoading ? 'Loading' : 'Be the first to comment.'}</Text></View>}
            renderItem={({ item }) => (
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
