import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Sheet } from '@/components/Sheet';
import { Stars } from '@/components/Stars';
import { Button, Chip, Field, Press, Text } from '@/components/ui';
import { ApiError } from '@/api/client';
import { useOrder, useOrderActions, type OrderItem } from '@/api/shop';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';
import { STATUS_LABEL, itemStatus } from './index';

const REASONS = ['Arrived damaged', 'Not as described', 'Wrong item', 'Does not fit', 'Not received', 'Changed my mind'];
const EVENT: Record<string, string> = { placed: 'Order placed', paid: 'Payment received', shipped: 'Shipped', delivered: 'Delivered', refund_requested: 'Return requested', refund_approved: 'Return approved', refund_rejected: 'Return declined', refunded: 'Refund sent', cancelled: 'Cancelled', failed: 'Payment failed' };
const at = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useOrder(id);
  const act = useOrderActions(id);
  const [ret, setRet] = useState<OrderItem | null>(null);
  const [rev, setRev] = useState<OrderItem | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [stars, setStars] = useState(5);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const o = q.data;
  if (!o) return <Page title="Order"><Text tone="muted">{q.isError ? 'Could not load this order.' : 'Loading'}</Text></Page>;
  const names = new Map(o.items.map((i) => [i.id, i.title]));
  const fail = (e: unknown) => { haptics.error(); setErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); };

  return (
    <Page title={STATUS_LABEL[o.status]} subtitle={`Order ${o.id.slice(0, 8)} · ${formatMoney(o.totalMinor, o.currency)}`}>
      {o.items.map((i) => (
        <View key={i.id} style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Press haptic="tap" onPress={() => router.push(`/product/${i.productId}`)} accessibilityLabel={`Open ${i.title}`}><Image source={{ uri: i.thumbUrl ?? undefined }} style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: colors.cardSoft }} contentFit="cover" /></Press>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" tone="card" numberOfLines={2}>{i.qty} × {i.title}</Text>
              {i.variantLabel ? <Text variant="small" tone="mutedCard">{i.variantLabel}</Text> : null}
              <Text variant="small" tone="mutedCard">{formatMoney(i.unitPriceMinor * i.qty - i.discountMinor, o.currency)}</Text>
            </View>
          </View>
          {o.status === 'paid' || o.status === 'refunded' ? (
            <>
              <Text variant="bodyStrong" tone="card">{itemStatus(i)}</Text>
              {i.trackingNumber ? (
                <View style={{ backgroundColor: colors.cardSoft, borderRadius: 12, padding: 10, gap: 2 }}>
                  <Text variant="small" tone="mutedCard">{i.carrier ?? 'Courier'}</Text>
                  <Text variant="bodyStrong" tone="card" selectable>{i.trackingNumber}</Text>
                  {i.trackingUrl ? <Press haptic="tap" onPress={() => void Linking.openURL(i.trackingUrl!)} accessibilityRole="link" accessibilityLabel="Track this parcel"><Text variant="small" tone="card" style={{ textDecorationLine: 'underline' }}>Track this parcel</Text></Press> : null}
                </View>
              ) : null}
              {i.refundedMinor > 0 ? <Text variant="small" tone="mutedCard">Refunded {formatMoney(i.refundedMinor, o.currency)}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {i.fulfilment !== 'delivered' && i.fulfilment !== 'cancelled' ? <View style={{ minWidth: 150 }}><Button title="Mark received" tone="dark" loading={act.received.isPending} onPress={() => act.received.mutate(i.id, { onError: fail })} /></View> : null}
                {i.canRefund ? <View style={{ minWidth: 150 }}><Button title="Return item" tone="dark" onPress={() => { setErr(null); setRet(i); }} /></View> : null}
                {i.canReview ? <View style={{ minWidth: 150 }}><Button title="Write a review" tone="dark" onPress={() => { setErr(null); setRev(i); }} /></View> : null}
              </View>
            </>
          ) : null}
        </View>
      ))}
      <View style={{ gap: 6 }}>
        <Text variant="heading">Summary</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="muted">Subtotal</Text><Text tone="muted">{formatMoney(o.subtotalMinor, o.currency)}</Text></View>
        {o.discountMinor > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="muted">Discount</Text><Text tone="muted">−{formatMoney(o.discountMinor, o.currency)}</Text></View> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodyStrong">Total</Text><Text variant="bodyStrong">{formatMoney(o.totalMinor, o.currency)}</Text></View>
      </View>
      <View style={{ gap: 10 }}>
        <Text variant="heading">Timeline</Text>
        {(o.timeline ?? []).map((e) => (
          <View key={e.id} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center' }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', marginTop: 6 }} /></View>
            <View style={{ flex: 1 }}><Text>{EVENT[e.kind] ?? e.kind}{e.itemId && names.get(e.itemId) ? ` · ${names.get(e.itemId)}` : ''}</Text>{e.note ? <Text variant="small" tone="muted">{e.note}</Text> : null}<Text variant="caption" tone="muted">{at(e.at)}</Text></View>
          </View>
        ))}
      </View>

      <Sheet visible={!!ret} onClose={() => setRet(null)} title="Return this item">
        <View style={{ padding: 20, gap: 14 }}>
          <Text variant="small" tone="mutedCard">You get back what you paid for this item, after the shop approves.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{REASONS.map((r) => <Chip onCard key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}</View>
          <Field onCard label="Anything to add? (optional)" value={details} onChangeText={setDetails} multiline style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }} />
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Send request" tone="dark" major loading={act.refund.isPending} onPress={() => act.refund.mutate({ itemId: ret!.id, reason, details }, { onSuccess: () => { haptics.success(); setRet(null); setDetails(''); }, onError: fail })} />
        </View>
      </Sheet>
      <Sheet visible={!!rev} onClose={() => setRev(null)} title={rev ? `Review ${rev.title}` : 'Review'}>
        <View style={{ padding: 20, gap: 14, alignItems: 'stretch' }}>
          <View style={{ alignItems: 'center' }}><Stars value={stars} size={34} onChange={setStars} /></View>
          <Field onCard label="Tell others about it (optional)" value={text} onChangeText={setText} multiline maxLength={1500} style={{ height: 100, paddingTop: 12, textAlignVertical: 'top' }} />
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Post review" tone="dark" major loading={act.review.isPending} onPress={() => act.review.mutate({ productId: rev!.productId, orderItemId: rev!.id, rating: stars, body: text }, { onSuccess: () => { haptics.success(); setRev(null); setText(''); }, onError: fail })} />
        </View>
      </Sheet>
    </Page>
  );
}
