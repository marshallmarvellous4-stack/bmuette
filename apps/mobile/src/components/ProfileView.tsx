import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingMark } from './Illustrations';
import { Avatar, Button, IconButton, Press, Text } from './ui';
import { useMessageUser } from '@/api/chat';
import { useFollow, useProfile, useUserPosts } from '@/api/hooks';
import { useBlock } from '@/api/safety';
import { useCartCount } from '@/api/shop';
import { openSafetyMenu } from '@/lib/moderation';
import type { Post } from '@/api/types';
import { compact } from '@/lib/money';
import { useAuth } from '@/state/auth';
import { Icon } from '@/theme/icons';
import { colors, TAB_BAR } from '@/theme/tokens';

function Stat({ value, label }: { value: number; label: string }) {
  return <View style={{ alignItems: 'center', minWidth: 72 }}><Text variant="heading">{compact(value)}</Text><Text variant="small" tone="muted">{label}</Text></View>;
}

export function ProfileView({ username, own, onBack }: { username: string; own?: boolean; onBack?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useAuth((s) => s.user);
  const block = useBlock();
  const { data: profile, isLoading } = useProfile(username);
  const posts = useUserPosts(username);
  const follow = useFollow();
  const message = useMessageUser();
  const cartCount = useCartCount(own ? {} : undefined);
  const tile = Math.floor((width - 4) / 3);
  if (isLoading || !profile) return <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>;
  const following = profile.viewer?.following ?? false;

  const header = (
    <View style={{ alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingTop: insets.top + (onBack ? 60 : 20), paddingBottom: 22 }}>
      <Avatar name={profile.displayName} uri={profile.avatarUrl} size={96} ring />
      <Text variant="title">{profile.displayName}</Text>
      <Text tone="muted">@{profile.username}{profile.merchant ? `  ·  ${profile.merchant.shopName}` : ''}</Text>
      {profile.bio ? <Text style={{ textAlign: 'center' }}>{profile.bio}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
        <Stat value={profile.postCount} label="Posts" /><Stat value={profile.followerCount} label="Followers" /><Stat value={profile.followingCount} label="Following" />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 8 }}>
        {own ? (
          <>
            <View style={{ flex: 1 }}><Button title={profile.merchant ? 'Add a product' : 'Start selling'} tone="light" onPress={() => router.push('/sell')} /></View>
            <View style={{ flex: 1 }}><Button title="Settings" tone="ghost" icon="settings" onPress={() => router.push('/settings')} /></View>
            <View style={{ flex: 1 }}><Button title="Saved" tone="ghost" icon="bookmark" onPress={() => router.push('/saved')} /></View>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Button title={following ? 'Following' : 'Follow'} tone={following ? 'ghost' : 'light'} major={!following} onPress={() => follow.mutate({ username: profile.username, follow: !following, authorId: profile.id })} />
            </View>
            <View style={{ flex: 1 }}><Button title="Message" tone="ghost" icon="chat" loading={message.busy} onPress={() => void message.go(profile.id)} /></View>
            {profile.merchant ? <View style={{ flex: 1 }}><Button title="Shop" tone="ghost" icon="bag" onPress={() => router.push(`/shop/${profile.merchant!.slug}`)} /></View> : null}
          </>
        )}
      </View>
      {own ? (
        <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
          <View style={{ flex: 1 }}><Button title="Orders" tone="ghost" icon="box" onPress={() => router.push('/orders')} /></View>
          <View style={{ flex: 1 }}><Button title={cartCount.data?.count ? `Cart (${cartCount.data.count})` : 'Cart'} tone="ghost" icon="cart" onPress={() => router.push('/cart')} /></View>
          {profile.merchant ? <View style={{ flex: 1 }}><Button title="Shop tools" tone="ghost" icon="wallet" onPress={() => router.push('/shop-admin')} /></View> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <FlashList
        data={posts.data ?? []}
        numColumns={3}
        keyExtractor={(p: Post) => p.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={{ alignItems: 'center', padding: 40 }}><Text tone="muted">{own ? 'Your posts will appear here.' : 'No posts yet.'}</Text></View>}
        contentContainerStyle={{ paddingBottom: own ? insets.bottom + TAB_BAR.height + TAB_BAR.bottomGap + 24 : insets.bottom + 24 }}
        onEndReachedThreshold={1}
        onEndReached={() => { if (posts.hasNextPage && !posts.isFetchingNextPage) void posts.fetchNextPage(); }}
        renderItem={({ item }: { item: Post }) => {
          const m = item.media[0];
          return (
            <Press haptic="tap" scaleTo={0.97} onPress={() => router.push(`/post/${item.id}`)} accessibilityLabel={item.caption || 'Open post'} style={{ width: tile, height: Math.round(tile * 1.35), margin: 0.5, backgroundColor: colors.inkRaised }}>
              {m?.thumbUrl || m?.url ? <Image source={{ uri: (m.thumbUrl ?? m.url)! }} style={{ flex: 1 }} contentFit="cover" /> : null}
              {item.kind === 'video' ? <View style={{ position: 'absolute', top: 6, right: 6 }}><Icon name="play" size={16} color="#fff" active /></View> : null}
            </Press>
          );
        }}
      />
      {onBack ? <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><IconButton icon="back" label="Go back" onPress={onBack} /></View> : null}
      {!own && user ? (
        <View style={{ position: 'absolute', top: insets.top + 8, right: 16 }}>
          <IconButton icon="more" label="More options" onPress={() => openSafetyMenu({ target: { type: 'user', id: profile.id, label: `@${profile.username}` }, username: profile.username, blocked: profile.viewer?.blocked, onBlock: (b) => block.mutate({ username: profile.username, block: b }) })} />
        </View>
      ) : null}
    </View>
  );
}
