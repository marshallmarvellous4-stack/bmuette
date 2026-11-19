import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Tiles } from './PostTile';
import { Press, Text } from './ui';
import type { Post, SavedProduct } from '@/api/types';
import { formatMoney } from '@/lib/money';
import { colors, radius } from '@/theme/tokens';

// Saved posts as a grid, then saved products as white cards.
export function SavedGrid({ posts, products, emptyText }: { posts: Post[]; products: SavedProduct[]; emptyText: string }) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  if (!posts.length && !products.length) return <View style={{ alignItems: 'center', padding: 40 }}><Text tone="muted" style={{ textAlign: 'center' }}>{emptyText}</Text></View>;
  return (
    <View style={{ gap: 18 }}>
      {posts.length ? <View style={{ marginHorizontal: -20 }}><Tiles posts={posts} width={width} /></View> : null}
      {products.length ? (
        <View style={{ gap: 10 }}>
          <Text variant="heading">Products</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {products.map((p) => (
              <Press key={p.id} haptic="tap" scaleTo={0.97} onPress={() => router.push(`/product/${p.id}`)} accessibilityRole="button" accessibilityLabel={p.title} style={{ width: (width - 50) / 2, backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' }}>
                <View style={{ aspectRatio: 1, backgroundColor: colors.cardSoft }}>{p.image ? <Image source={{ uri: p.image }} style={{ flex: 1 }} contentFit="cover" /> : null}</View>
                <View style={{ padding: 12 }}><Text variant="bodyStrong" tone="card" numberOfLines={1}>{p.title}</Text><Text variant="small" tone="mutedCard">{formatMoney(p.priceMinor, p.currency)}</Text></View>
              </Press>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
