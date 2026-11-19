import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Button, Press, Text } from '@/components/ui';
import { useOrders, type Order } from '@/api/shop';
import { formatMoney, timeAgo } from '@/lib/money';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

export const STATUS_LABEL: Record<Order['status'], string> = { pending: 'Waiting for payment', paid: 'Paid', failed: 'Payment failed', cancelled: 'Cancelled', refunded: 'Refunded' };

export function itemStatus(i: Order['items'][number]) {
  if (i.refundStatus === 'refunded') return 'Refunded';
  if (i.refundStatus === 'requested') return 'Return requested';
  if (i.refundStatus === 'approved') return 'Refund approved';
  return { pending: 'Preparing', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' }[i.fulfilment];
}

export default function Orders() {
  const router = useRouter();
  const q = useOrders();
  const orders = q.data?.items ?? [];
  return (
    <Page title="Orders" subtitle="Track what you bought, return an item or leave a review.">
      {q.isLoading ? <Text tone="muted">Loading</Text> : orders.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 50 }}><Icon name="box" size={40} color={colors.muted} /><Text variant="heading">No orders yet</Text><View style={{ width: 200 }}><Button title="Browse the market" onPress={() => router.replace('/market')} /></View></View>
      ) : orders.map((o) => (
        <Press key={o.id} haptic="tap" scaleTo={0.985} onPress={() => router.push(`/orders/${o.id}`)} accessibilityRole="button" accessibilityLabel={`Order of ${o.items.length} items, ${STATUS_LABEL[o.status]}`}
          style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="bodyStrong" tone="card">{STATUS_LABEL[o.status]}</Text>
            <Text variant="small" tone="mutedCard">{timeAgo(o.createdAt)}</Text>
          </View>
          {o.items.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Image source={{ uri: i.thumbUrl ?? undefined }} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: colors.cardSoft }} contentFit="cover" />
              <View style={{ flex: 1 }}><Text tone="card" numberOfLines={1}>{i.qty} × {i.title}{i.variantLabel ? ` (${i.variantLabel})` : ''}</Text>{o.status === 'paid' || o.status === 'refunded' ? <Text variant="small" tone="mutedCard">{itemStatus(i)}</Text> : null}</View>
            </View>
          ))}
          <Text variant="bodyStrong" tone="card">{formatMoney(o.totalMinor, o.currency)}</Text>
        </Press>
      ))}
    </Page>
  );
}
