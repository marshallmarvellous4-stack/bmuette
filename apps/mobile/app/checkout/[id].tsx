import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CodeField } from '@/components/CodeField';
import { ShippingForm, cleanShipping, emptyShipping, validateShipping } from '@/components/ShippingForm';
import { Button, IconButton, Press, Text } from '@/components/ui';
import { ApiError } from '@/api/client';
import { useProduct } from '@/api/hooks';
import { buyLines, type Quote } from '@/api/shop';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';

// "Buy now" for one product (with its chosen option). Several items at once go through the cart.
export default function Checkout() {
  const { id, variant } = useLocalSearchParams<{ id: string; variant?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: p } = useProduct(id);
  const [qty, setQty] = useState(1);
  const [f, setF] = useState(emptyShipping);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState<string | undefined>();
  const [q, setQ] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lines = useMemo(() => [{ productId: id, variantId: variant ?? null, qty }], [id, variant, qty]);
  // A new quantity changes the discount, so a preview made for the old quantity is dropped.
  useEffect(() => { setQ(null); setCode(undefined); }, [qty]);
  if (!p) return <View style={{ flex: 1, backgroundColor: colors.ink }} />;
  const v = (p.variants ?? []).find((x) => x.id === variant) ?? null;
  const unit = v?.priceMinor ?? p.price.amountMinor;
  const maxQty = Math.min(20, (v ? v.stock : p.stock) ?? 20);
  const needsShipping = p.kind === 'physical';
  const total = q ? q.totalMinor : unit * qty;

  async function pay() {
    const e = needsShipping ? validateShipping(f) : {};
    setErrors(e);
    if (Object.keys(e).length) return haptics.warning();
    setBusy(true); setMessage(null);
    try {
      const r = await buyLines(lines, code, needsShipping ? cleanShipping(f) : undefined);
      haptics.success();
      await WebBrowser.openBrowserAsync(r.checkout.url); // Flutterwave or Stripe hosted payment page
      setMessage('When your payment completes, the order appears under Orders. You can close this screen.');
    } catch (err) {
      haptics.error();
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') router.push('/verify-email');
      setMessage(err instanceof ApiError ? err.message : 'Could not start the payment.');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30, gap: 22 }}>
        <View style={{ alignSelf: 'flex-start' }}><IconButton icon="back" tone="ink" label="Go back" onPress={() => router.back()} /></View>
        <Text variant="title">Checkout</Text>
        <View style={{ flexDirection: 'row', gap: 14, backgroundColor: colors.card, borderRadius: radius.lg, padding: 12, alignItems: 'center' }}>
          <Image source={{ uri: (p.media[0]?.thumbUrl ?? p.media[0]?.url)! }} style={{ width: 72, height: 72, borderRadius: 14, backgroundColor: colors.cardSoft }} contentFit="cover" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" tone="card" numberOfLines={2}>{p.title}</Text>
            {v ? <Text variant="small" tone="mutedCard">{v.label}</Text> : null}
            <Text variant="small" tone="mutedCard">{p.merchant.shopName} · {formatMoney(unit, p.price.currency)}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Press haptic="tap" onPress={() => setQty((x) => Math.max(1, x - 1))} accessibilityLabel="Fewer" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardSoft, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodyStrong" tone="card">−</Text></Press>
            <Text variant="bodyStrong" tone="card">{qty}</Text>
            <Press haptic="tap" onPress={() => setQty((x) => Math.min(maxQty, x + 1))} accessibilityLabel="More" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardSoft, alignItems: 'center', justifyContent: 'center' }}><Text variant="bodyStrong" tone="card">+</Text></Press>
          </View>
        </View>
        {needsShipping ? <ShippingForm value={f} onChange={setF} errors={errors} /> : null}
        <CodeField lines={lines} onQuote={(c, quoted) => { setCode(c); setQ(quoted); }} />
        <View style={{ gap: 6 }}>
          {q && q.discountMinor > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="muted">Discount</Text><Text tone="muted">−{formatMoney(q.discountMinor, p.price.currency)}</Text></View> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text tone="muted">Total</Text>
            <Text variant="title">{formatMoney(total, p.price.currency)}</Text>
          </View>
        </View>
        {message ? <Text tone="muted" accessibilityLiveRegion="polite">{message}</Text> : null}
        {message?.startsWith('When your payment') ? <Button title="View my orders" tone="ghost" onPress={() => router.replace('/orders')} /> : null}
        <Button title={`Pay ${formatMoney(total, p.price.currency)}`} major loading={busy} onPress={pay} />
        <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>You pay on a secure page run by {p.price.currency === 'NGN' ? 'Flutterwave' : 'Stripe'}. BMUETTE never sees your card.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
