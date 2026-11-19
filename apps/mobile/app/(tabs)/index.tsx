import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Illustration, LoadingMark } from '@/components/Illustrations';
import { PostPage } from '@/components/PostPage';
import { Button, IconButton, Press, Text } from '@/components/ui';
import { useFeed } from '@/api/hooks';
import type { Post } from '@/api/types';
import { tabEvents } from '@/state/ui';
import { haptics } from '@/theme/haptics';
import { colors, TAB_BAR } from '@/theme/tokens';

type ViewToken<T> = { item: T; isViewable: boolean };

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<'forYou' | 'following'>('forYou');
  const feed = useFeed(kind);
  const [pageH, setPageH] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const list = useRef<FlatList<Post>>(null);
  const posts = feed.data ?? [];

  useEffect(() => tabEvents.onReselect('index', () => { list.current?.scrollToOffset({ offset: 0, animated: true }); void feed.refetch(); }), [feed]);
  useEffect(() => { if (!activeId && posts.length) setActiveId(posts[0].id); }, [posts, activeId]);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.item) setActiveId((prev) => { if (prev !== first.item.id) haptics.select(); return first.item.id; });
  }, []);

  const bottomInset = insets.bottom + TAB_BAR.height + TAB_BAR.bottomGap + 12;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }} onLayout={(e) => setPageH(Math.round(e.nativeEvent.layout.height))}>
      {feed.isLoading || !pageH ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>
      ) : posts.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingHorizontal: 32, paddingBottom: 100 }}>
          <Illustration kind="video" />
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text variant="heading">{feed.isError ? 'Could not load your feed' : kind === 'following' ? 'Follow people to fill this' : 'Nothing to watch yet'}</Text>
            <Text tone="muted" style={{ textAlign: 'center' }}>{feed.isError ? 'Check your connection and try again.' : 'Be the first to post something worth watching.'}</Text>
          </View>
          <Button title={feed.isError ? 'Try again' : 'Post a video'} major onPress={() => (feed.isError ? feed.refetch() : router.push('/new'))} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <FlatList
          ref={list}
          data={posts}
          keyExtractor={(p) => p.id}
          pagingEnabled
          snapToInterval={pageH}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: pageH, offset: pageH * i, index: i })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          onEndReachedThreshold={1.5}
          onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
          renderItem={({ item }) => <PostPage post={item} active={item.id === activeId} height={pageH} bottomInset={bottomInset} topInset={insets.top} />}
        />
      )}

      <View style={{ position: 'absolute', top: insets.top + 6, right: 14 }}><IconButton icon="search" label="Search" onPress={() => router.push('/search')} /></View>
      {/* floating header: For You / Following */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 10, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 22 }}>
          {(['following', 'forYou'] as const).map((k) => (
            <Press key={k} haptic="select" onPress={() => { if (k !== kind) { setActiveId(null); setKind(k); } }} accessibilityRole="tab" accessibilityState={{ selected: kind === k }} style={{ paddingVertical: 6, alignItems: 'center', gap: 5 }}>
              <Text variant="bodyStrong" style={{ color: kind === k ? '#fff' : 'rgba(255,255,255,0.6)', fontSize: 17 }}>{k === 'forYou' ? 'For You' : 'Following'}</Text>
              <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: kind === k ? '#fff' : 'transparent' }} />
            </Press>
          ))}
        </View>
      </View>
    </View>
  );
}
