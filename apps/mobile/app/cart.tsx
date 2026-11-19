import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { CodeField } from '@/components/CodeField';
import { ShippingForm, cleanShipping, emptyShipping, validateShipping } from '@/components/ShippingForm';
import { Button, Press, Text } from '@/components/ui';
import { ApiError } from '@/api/client';
import { cartCheckout, useCart, useCartQty, useCartRemove, type CartItem, type Quote } from '@/api/shop';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

function Line({ i }: { i: CartItem }) {
  const qty = useCartQty();
  const remove = useCartRemove();
  const router = useRouter();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Press haptic="tap" onPress={() => router.push(`/product/${i.productId}`)} accessibilityLabel={`Open ${i.title}`}>
          <Image source={{ uri: i.thumbUrl ?? undefined }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: colors.cardSoft }} contentFit="cover" />
        </Press>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" tone="card" numberOfLines={2}>{i.title}</Text>
          {i.variantLabel ? <Text variant="small" tone="mutedCard">{i.variantLabel}</Text> : null}
          <Text variant="small" tone="mutedCard">{i.merchant.shopName} · {formatMoney(i.unitPriceMinor, i.currency)}</Text>
        </View>
        <Press haptic="tap" onPress={() => remove.mutate(i.id)} accessibilityRole="button" accessibilityLabel={`Remove ${i.title}`}><Icon name="trash" size={20} color={colors.textOnCard} /></Press>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Press haptic="tap" disabled={i.qty <= 1} onPress={() => qty.mutate({ id: i.id, qty: i.qty - 1 })} accessibilityLabel="Fewer" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardSoft, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodyStrong" tone="card">−</Text></Press>
          <Text variant="bodyStrong" tone="card" accessibilityLabel={`Quantity ${i.qty}`}>{i.qty}</Text>
          <Press haptic="tap" disabled={i.qty >= 20} onPress={() => qty.mutate({ id: i.id, qty: i.qty + 1 })} accessibilityLabel="More" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardSoft, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodyStrong" tone="card">+</Text></Press>
        </View>
        <Text variant="bodyStrong" tone="card">{formatMoney(i.unitPriceMinor * i.qty, i.currency)}</Text>
      </View>
      {i.issue ? <Text variant="small" tone="danger" accessibilityLiveRegion="polite">{i.issue}</Text> : null}
    </View>
  );
}

// One cart, grouped by currency: each currency is its own checkout (the payment providers charge in one currency at a time).
export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  const [currency, setCurrency] = useState<string | null>(null);
  const [f, setF] = useState(emptyShipping);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState<string | undefined>();
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const groups = cart.data?.groups ?? [];
  const active = groups.find((g) => g.currency === currency) ?? groups[0];
  const lines = useMemo(() => (cart.data?.items ?? []).filter((i) => i.currency === active?.currency).map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), [cart.data, active?.currency]);
  // Any change to the cart makes an earlier discount preview stale.
  useEffect(() => { setQ(null); setCode(undefined); }, [cart.dataUpdatedAt, active?.currency]);

  if (cart.isLoading) return <Page title="Cart"><Text tone="muted">Loading</Text></Page>;
  if (!cart.data || cart.data.items.length === 0) return (
    <Page title="Cart"><View style={{ alignItems: 'center', gap: 12, paddingTop: 50 }}><Icon name="cart" size={40} color={colors.muted} /><Text variant="heading">Your cart is empty</Text><Text tone="muted" style={{ textAlign: 'center' }}>Add things you like and check out in one go.</Text><View style={{ width: 200 }}><Button title="Browse the market" onPress={() => router.replace('/market')} /></View></View></Page>
  );
  const items = cart.data.items.filter((i) => i.currency === active!.currency);
  const needsShipping = true; // the server decides; asking for an address is harmless for digital goods and required for physical ones
  const total = q ? q.totalMinor : active!.subtotalMinor;

  async function pay() {
    const e = validateShipping(f);
    setErrors(e);
    if (Object.keys(e).length) return haptics.warning();
    setBusy(true); setMessage(null);
    try {
      const r = await cartCheckout(active!.currency, code, cleanShipping(f));
      haptics.success();
      await WebBrowser.openBrowserAsync(r.checkout.url);
      setMessage('When your payment completes, the order appears under Orders and leaves your cart.');
    } catch (err) {
      haptics.error();
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') router.push('/verify-email');
      setMessage(err instanceof ApiError ? err.message : 'Could not start the payment.');
    } finally { setBusy(false); }
  }

  return (
    <Page title="Cart" subtitle={`${cart.data.count} item${cart.data.count > 1 ? 's' : ''}`}>
      {groups.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Text variant="small" tone="muted">Items in different currencies are paid separately. Pick which to check out now.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {groups.map((g) => (
              <Press key={g.currency} haptic="select" onPress={() => setCurrency(g.currency)} accessibilityRole="button" accessibilityState={{ selected: active!.currency === g.currency }} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: active!.currency === g.currency ? colors.card : colors.inkRaised }}>
                <Text variant="bodyStrong" tone={active!.currency === g.currency ? 'card' : 'ink'}>{g.currency} · {formatMoney(g.subtotalMinor, g.currency)}</Text>
              </Press>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={{ gap: 12 }}>{items.map((i) => <Line key={i.id} i={i} />)}</View>
      {needsShipping ? <ShippingForm value={f} onChange={setF} errors={errors} /> : null}
      <CodeField lines={lines} onQuote={(c, quoted) => { setCode(c); setQ(quoted); }} />
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="muted">Subtotal</Text><Text tone="muted">{formatMoney(active!.subtotalMinor, active!.currency)}</Text></View>
        {q && q.discountMinor > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="muted">Discount</Text><Text tone="muted">−{formatMoney(q.discountMinor, active!.currency)}</Text></View> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text tone="muted">Total</Text><Text variant="title">{formatMoney(total, active!.currency)}</Text></View>
      </View>
      {message ? <Text tone="muted" accessibilityLiveRegion="polite">{message}</Text> : null}
      {message?.startsWith('When your payment') ? <Button title="View my orders" tone="ghost" onPress={() => router.replace('/orders')} /> : null}
      <Button title={`Pay ${formatMoney(total, active!.currency)}`} major loading={busy} disabled={!active!.ready} onPress={pay} />
      {!active!.ready ? <Text variant="small" tone="danger" style={{ textAlign: 'center' }}>Fix the items marked above to continue.</Text> : null}
    </Page>
  );
}
