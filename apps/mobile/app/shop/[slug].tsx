import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { LoadingMark } from '@/components/Illustrations';
import { ProductCard } from '@/components/ProductCard';
import { Avatar, IconButton, Text } from '@/components/ui';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import { colors } from '@/theme/tokens';

type Shop = { userId: string; shopName: string; slug: string; description: string; country: string | null; verified: boolean; username: string; avatarUrl: string | null; products: Product[] };

export default function ShopScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({ queryKey: ['shop', slug], queryFn: () => api<Shop>(`/shops/${slug}`) });
  if (isLoading || !data) return <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}>
      <View style={{ paddingHorizontal: 16 }}><IconButton icon="back" tone="ink" label="Go back" onPress={() => router.back()} /></View>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 22, paddingHorizontal: 24 }}>
        <Avatar name={data.shopName} uri={data.avatarUrl} size={84} ring />
        <Text variant="title">{data.shopName}{data.verified ? '  ✓' : ''}</Text>
        {data.description ? <Text tone="muted" style={{ textAlign: 'center' }}>{data.description}</Text> : null}
        <Text variant="small" tone="muted">{data.products.length} products</Text>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 10 }}>
        {[0, 1].map((col) => <View key={col} style={{ flex: 1 }}>{data.products.filter((_, i) => i % 2 === col).map((p) => <ProductCard key={p.id} product={p} />)}</View>)}
      </View>
    </ScrollView>
  );
}
