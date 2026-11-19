import React from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Avatar, Button, Press, Text } from './ui';
import { Icon, type IconName } from '@/theme/icons';
import { useActivity, useMarkActivityRead, type Activity } from '@/api/notifications';
import { routeFor } from '@/lib/push';
import { listTime } from '@/lib/time';
import { colors } from '@/theme/tokens';

const ICON: Record<Activity['type'], IconName> = {
  like: 'heart', comment: 'comment', reply: 'comment', follow: 'user', message: 'chat',
  order_paid: 'bag', order_update: 'truck', sale: 'wallet', review: 'star', refund: 'refresh', payout: 'wallet', system: 'bell',
};

function Row({ a, onOpen }: { a: Activity; onOpen: () => void }) {
  return (
    <Press haptic="select" scaleTo={0.985} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${a.title}. ${a.body ?? ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 }}>
      <View>
        {a.actor ? <Avatar name={a.actor.displayName} uri={a.actor.avatarUrl} size={48} /> : (
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.inkRaised, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={ICON[a.type]} size={22} color="#fff" />
          </View>
        )}
        {a.actor ? (
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink }}>
            <Icon name={ICON[a.type]} size={12} color={colors.ink} active />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontFamily: a.read ? 'Inter_400Regular' : 'Inter_600SemiBold' }}>{a.title}</Text>
        {a.body ? <Text variant="small" tone="muted" numberOfLines={1}>{a.body}</Text> : null}
        <Text variant="caption" tone="muted">{listTime(a.createdAt)}</Text>
      </View>
      {a.thumbUrl ? <Image source={{ uri: a.thumbUrl }} style={{ width: 46, height: 58, borderRadius: 10, backgroundColor: colors.inkRaised }} contentFit="cover" /> : null}
      {!a.read ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger }} /> : null}
    </Press>
  );
}

// "Activity": likes, comments, new followers and orders, newest first.
export function ActivityList({ bottom }: { bottom: number }) {
  const router = useRouter();
  const q = useActivity();
  const mark = useMarkActivityRead();
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const unread = q.data?.pages[0]?.unread ?? 0;

  const open = (a: Activity) => {
    if (!a.read) mark.mutate([a.id]);
    const to = routeFor({ type: a.type, title: a.title, postId: a.postId, conversationId: a.conversationId, orderId: a.orderId, username: a.actor?.username });
    if (to) router.push(to as any);
  };

  if (q.isLoading) return <View style={{ padding: 40 }}><ActivityIndicator color="#fff" /></View>;
  return (
    <FlashList
      data={items}
      keyExtractor={(a) => a.id}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor="#fff" />}
      onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottom + 80 }}
      ListHeaderComponent={unread > 0 ? (
        <Press haptic="tap" onPress={() => mark.mutate(undefined)} accessibilityRole="button" accessibilityLabel="Mark all as read" style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 }}>
          <Text variant="small" tone="muted">Mark all as read</Text>
        </Press>
      ) : null}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color="#fff" style={{ margin: 16 }} /> : null}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 80, paddingHorizontal: 24 }}>
          <Icon name="bell" size={40} color={colors.muted} />
          <Text variant="heading">Nothing yet</Text>
          <Text tone="muted" style={{ textAlign: 'center' }}>Likes, comments, new followers and order updates will show up here.</Text>
          <View style={{ width: 220, marginTop: 8 }}><Button title="Notification settings" tone="ghost" onPress={() => router.push('/settings/notifications')} /></View>
        </View>
      }
      renderItem={({ item }) => <Row a={item} onOpen={() => open(item)} />}
    />
  );
}
