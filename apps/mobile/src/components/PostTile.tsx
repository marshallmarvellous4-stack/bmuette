import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Press } from './ui';
import type { Post } from '@/api/types';
import { Icon } from '@/theme/icons';
import { colors } from '@/theme/tokens';

// One square-ish thumbnail in a 3-column grid of posts.
export function PostTile({ post, size }: { post: Post; size: number }) {
  const router = useRouter();
  const m = post.media[0];
  return (
    <Press haptic="tap" scaleTo={0.97} onPress={() => router.push(`/post/${post.id}`)} accessibilityLabel={post.caption || 'Open post'} style={{ width: size, height: Math.round(size * 1.35), margin: 0.5, backgroundColor: colors.inkRaised }}>
      {m?.thumbUrl || m?.url ? <Image source={{ uri: (m.thumbUrl ?? m.url)! }} style={{ flex: 1 }} contentFit="cover" /> : null}
      {post.kind === 'video' ? <View style={{ position: 'absolute', top: 6, right: 6 }}><Icon name="play" size={16} color="#fff" active /></View> : null}
    </Press>
  );
}

export function Tiles({ posts, width }: { posts: Post[]; width: number }) {
  const size = Math.floor((width - 4) / 3);
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{posts.map((p) => <PostTile key={p.id} post={p} size={size} />)}</View>;
}
