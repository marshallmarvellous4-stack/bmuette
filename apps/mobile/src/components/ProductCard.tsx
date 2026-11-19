import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Press, Text } from './ui';
import type { Product } from '@/api/types';
import { formatMoney } from '@/lib/money';
import { colors, radius, shadow } from '@/theme/tokens';

// A white card: the photo leads, the text stays small. Photo height follows the real photo so the grid has Pinterest's uneven rhythm.
export function ProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const m = product.media[0];
  const ratio = m?.width && m?.height ? Math.min(1.5, Math.max(0.75, m.width / m.height)) : 1;
  return (
    <Press haptic="tap" scaleTo={0.97} onPress={() => router.push(`/product/${product.id}`)} accessibilityRole="button" accessibilityLabel={`${product.title}, ${formatMoney(product.price.amountMinor, product.price.currency)}`}
      style={{ margin: 6, backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...shadow.card }}>
      <View style={{ aspectRatio: ratio, backgroundColor: colors.cardSoft }}>
        {m?.thumbUrl || m?.url ? <Image source={{ uri: (m.thumbUrl ?? m.url)! }} style={{ flex: 1 }} contentFit="cover" transition={180} /> : null}
        {m?.kind === 'video' ? (
          <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 }}>
            <Text variant="caption" style={{ color: '#fff' }}>VIDEO</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 12, gap: 3 }}>
        <Text variant="bodyStrong" tone="card" numberOfLines={2}>{product.title}</Text>
        <Text variant="bodyStrong" tone="card">{formatMoney(product.price.amountMinor, product.price.currency)}</Text>
        <Text variant="small" tone="mutedCard" numberOfLines={1}>{product.merchant.shopName}{!product.inStock ? '  ·  Sold out' : ''}</Text>
      </View>
    </Press>
  );
}
