import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { LoadingMark } from '@/components/Illustrations';
import { PostPage } from '@/components/PostPage';
import { IconButton } from '@/components/ui';
import { api } from '@/api/client';
import type { Post } from '@/api/types';
import { colors } from '@/theme/tokens';

export default function SinglePost() {
  const { id, t } = useLocalSearchParams<{ id: string; t?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [h, setH] = React.useState(0);
  const { data } = useQuery({ queryKey: ['post', id], queryFn: () => api<Post>(`/posts/${id}`) });
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }} onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}>
      {data && h ? <PostPage post={data} active height={h} bottomInset={insets.bottom + 16} topInset={insets.top} startAt={Number(t) || 0} standalone /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><IconButton icon="back" label="Go back" onPress={() => router.back()} /></View>
    </View>
  );
}
