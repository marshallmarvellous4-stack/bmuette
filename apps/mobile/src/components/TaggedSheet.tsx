import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Sheet } from './Sheet';
import { Button, Press, Text } from './ui';
import { useAddToCart } from '@/api/shop';
import type { TaggedProduct } from '@/api/types';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { colors } from '@/theme/tokens';

/** The products shown in a video. Tap one to open it, or add a plain one straight to the cart. */
export function TaggedSheet({ visible, onClose, products, highlight }: { visible: boolean; onClose: () => void; products: TaggedProduct[]; highlight?: string | null }) {
  const router = useRouter();
  const add = useAddToCart();
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} title={products.length > 1 ? 'Shop this video' : 'Shop this item'}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
        {products.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', opacity: p.inStock ? 1 : 0.55, borderWidth: highlight === p.id ? 2 : 0, borderColor: colors.ink, borderRadius: 16, padding: highlight === p.id ? 6 : 0 }}>
            <Press haptic="tap" onPress={() => { onClose(); router.push(`/product/${p.id}`); }} accessibilityRole="button" accessibilityLabel={`Open ${p.title}`}>
              <Image source={{ uri: p.thumbUrl ?? undefined }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: colors.cardSoft }} contentFit="cover" />
            </Press>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" tone="card" numberOfLines={2}>{p.title}</Text>
              <Text variant="small" tone="mutedCard">{p.inStock ? formatMoney(p.priceMinor, p.currency) : 'Sold out'}{p.hasVariants && p.inStock ? ' · choose an option' : ''}</Text>
            </View>
            {p.inStock && !p.hasVariants ? (
              <View style={{ width: 96 }}><Button title={done === p.id ? 'Added' : 'Add'} tone="dark" icon="cart" onPress={async () => { setErr(null); try { await add.mutateAsync({ productId: p.id, qty: 1 }); haptics.success(); setDone(p.id); } catch (e) { haptics.error(); setErr(e instanceof Error ? e.message : 'Could not add.'); } }} /></View>
            ) : <View style={{ width: 96 }}><Button title="View" tone="dark" onPress={() => { onClose(); router.push(`/product/${p.id}`); }} /></View>}
          </View>
        ))}
        {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
        {done ? <Button title="View cart" tone="ghost" onPress={() => { onClose(); router.push('/cart'); }} /> : null}
      </ScrollView>
    </Sheet>
  );
}
