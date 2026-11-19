import React from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingMark } from '@/components/Illustrations';
import { PostTile } from '@/components/PostTile';
import { useTagPosts } from '@/api/discovery';
import { IconButton, Text } from '@/components/ui';
import { colors } from '@/theme/tokens';

export default function TagScreen() {
  const { tag: raw } = useLocalSearchParams<{ tag: string }>();
  const tag = decodeURIComponent(String(raw ?? '')).replace(/^#/, '');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const q = useTagPosts(tag);
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];
  const count = q.data?.pages[0]?.postCount ?? 0;
  const size = Math.floor((width - 4) / 3);
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <FlatList
        data={posts} numColumns={3} key="tiles" keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <View style={{ padding: 20, paddingTop: insets.top + 12, gap: 6 }}>
            <View style={{ alignSelf: 'flex-start' }}><IconButton icon="back" tone="ink" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /></View>
            <Text variant="title" style={{ marginTop: 14 }}>#{tag}</Text>
            {q.data ? <Text tone="muted">{count} {count === 1 ? 'post' : 'posts'}</Text> : null}
          </View>
        }
        ListEmptyComponent={q.isLoading ? <View style={{ alignItems: 'center', padding: 40 }}><LoadingMark /></View> : <View style={{ alignItems: 'center', padding: 40 }}><Text tone="muted">No posts with this hashtag yet.</Text></View>}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        onEndReachedThreshold={1} onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
        renderItem={({ item }) => <PostTile post={item} size={size} />}
      />
    </View>
  );
}
