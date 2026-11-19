import React, { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingMark } from '@/components/Illustrations';
import { ProductCard } from '@/components/ProductCard';
import { useAuth } from '@/state/auth';
import { openSafetyMenu } from '@/lib/moderation';
import { useMessageUser } from '@/api/chat';
import { useSaveSheet } from '@/state/saveSheet';
import { Avatar, Button, IconButton, Press, Text } from '@/components/ui';
import { api } from '@/api/client';
import { useProduct, useSimilar } from '@/api/hooks';
import { Sheet } from '@/components/Sheet';
import { RatingLine, Stars } from '@/components/Stars';
import { useAddToCart, useReviews } from '@/api/shop';
import { formatMoney, timeAgo } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius, shadow } from '@/theme/tokens';

const ACTION: Record<string, string> = { physical: 'Buy now', digital: 'Buy now', service: 'Book now', course: 'Enrol', ticket: 'Get tickets', food: 'Order now' };

function ReviewRow({ r }: { r: import('@/api/shop').Review }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar name={r.reviewer.displayName} uri={r.reviewer.avatarUrl} size={30} />
        <View style={{ flex: 1 }}><Text variant="bodyStrong" tone="card">{r.reviewer.displayName}</Text><Text variant="caption" tone="mutedCard">Verified purchase · {timeAgo(r.createdAt)}</Text></View>
        <Stars value={r.rating} size={14} />
      </View>
      {r.body ? <Text tone="card">{r.body}</Text> : null}
      {r.reply ? <View style={{ backgroundColor: colors.cardSoft, borderRadius: 12, padding: 10 }}><Text variant="small" tone="mutedCard">Reply from the shop</Text><Text variant="small" tone="card">{r.reply}</Text></View> : null}
    </View>
  );
}

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const { data: p, isLoading, isError } = useProduct(id);
  const similar = useSimilar(id);
  const message = useMessageUser();
  const me = useAuth((x) => x.user?.id);
  const [page, setPage] = useState(0);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [allReviews, setAllReviews] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const reviews = useReviews(id);
  const addToCart = useAddToCart();

  if (isLoading) return <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>;
  if (isError || !p) return (
    <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
      <Text variant="heading">This product is not available</Text>
      <Button title="Go back" tone="ghost" onPress={() => router.back()} />
    </View>
  );
  const isSaved = saved ?? p.viewer.saved;
  const toggleSave = async () => {
    const next = !isSaved; setSaved(next); haptics.press();
    try { await api(`/products/${p.id}/save`, { method: next ? 'POST' : 'DELETE' }); void qc.invalidateQueries({ queryKey: ['product', p.id] }); } catch { setSaved(!next); haptics.error(); }
  };
  const heroH = Math.round(width * 1.2);
  const variants = p.variants ?? [];
  const chosen = variants.find((v) => v.id === variantId) ?? null;
  const priceMinor = chosen?.priceMinor ?? p.price.amountMinor;
  const canBuy = p.inStock && (variants.length === 0 || (!!chosen && chosen.inStock));
  const isOwn = p.merchant.userId === me;
  const needChoice = variants.length > 0 && !chosen;
  const addCart = async () => {
    if (needChoice) { haptics.warning(); return setNote('Choose an option first.'); }
    try { await addToCart.mutateAsync({ productId: p.id, variantId: chosen?.id ?? null, qty: 1 }); haptics.success(); setNote('Added to your cart.'); }
    catch (e) { haptics.error(); setNote(e instanceof Error ? e.message : 'Could not add to cart.'); }
  };
  const buyNowGo = () => {
    if (needChoice) { haptics.warning(); return setNote('Choose an option first.'); }
    router.push(chosen ? `/checkout/${p.id}?variant=${chosen.id}` : `/checkout/${p.id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        <View style={{ height: heroH, backgroundColor: colors.inkRaised }}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => { const n = Math.round(e.nativeEvent.contentOffset.x / width); if (n !== page) { setPage(n); haptics.select(); } }}>
            {p.media.map((m) => <Image key={m.id} source={{ uri: (m.url ?? m.thumbUrl)! }} style={{ width, height: heroH }} contentFit="cover" />)}
          </ScrollView>
          {p.media.length > 1 ? (
            <View style={{ position: 'absolute', bottom: 28, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
              {p.media.map((m, i) => <View key={m.id} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? '#fff' : 'rgba(255,255,255,0.5)' }} />)}
            </View>
          ) : null}
        </View>

        {/* the white sheet that slides up over the photo */}
        <View style={{ marginTop: -24, backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 22, gap: 14, ...shadow.card }}>
          <Text variant="title" tone="card">{p.title}</Text>
          <Text variant="heading" tone="card">{formatMoney(priceMinor, p.price.currency)}</Text>
          <RatingLine avg={p.rating?.avg ?? 0} count={p.rating?.count ?? 0} />
          {variants.length ? (
            <View style={{ gap: 8 }}>
              <Text variant="small" tone="mutedCard">Options</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variants.map((v) => (
                  <Press key={v.id} haptic="select" disabled={!v.inStock} onPress={() => { setVariantId(v.id); setNote(null); }} accessibilityRole="button" accessibilityState={{ selected: variantId === v.id, disabled: !v.inStock }} accessibilityLabel={`${v.label}${v.inStock ? '' : ', sold out'}`}
                    style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: variantId === v.id ? colors.ink : colors.cardSoft, opacity: v.inStock ? 1 : 0.4 }}>
                    <Text variant="bodyStrong" style={{ color: variantId === v.id ? '#fff' : colors.textOnCard, textDecorationLine: v.inStock ? 'none' : 'line-through' }}>{v.label}{v.priceMinor !== null && v.priceMinor !== p.price.amountMinor ? `  ·  ${formatMoney(v.priceMinor, p.price.currency)}` : ''}</Text>
                  </Press>
                ))}
              </View>
              {chosen?.stock !== null && chosen?.stock !== undefined && chosen.stock > 0 && chosen.stock <= 5 ? <Text variant="small" tone="danger">Only {chosen.stock} left</Text> : null}
            </View>
          ) : null}
          <Press haptic="tap" onPress={() => router.push(`/shop/${p.merchant.slug}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={p.merchant.shopName} uri={p.merchant.avatarUrl} size={36} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" tone="card">{p.merchant.shopName}{p.merchant.verified ? '  ✓' : ''}</Text>
              <RatingLine avg={p.merchant.rating?.avg ?? 0} count={p.merchant.rating?.count ?? 0} /><Text variant="small" tone="mutedCard">{p.counts.sold} sold</Text>
            </View>
          </Press>
          {p.merchant.userId !== me ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button title="Message seller" tone="dark" icon="chat" loading={message.busy} onPress={() => void message.go(p.merchant.userId)} /></View>
              <View style={{ width: 120 }}><Button title="Share" tone="dark" icon="share" onPress={() => router.push(`/send/product/${p.id}`)} /></View>
            </View>
          ) : null}
          {p.description ? <Text tone="mutedCard" style={{ color: '#3A3C42' }}>{p.description}</Text> : null}
          {p.tags.length ? <Text variant="small" tone="mutedCard">{p.tags.map((t) => `#${t}`).join('  ')}</Text> : null}
          {isOwn ? <Button title="Manage options and stock" tone="dark" onPress={() => router.push('/shop-admin?tab=products')} /> : null}
          <View style={{ gap: 10, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="heading" tone="card">Reviews</Text>
              {reviews.data && reviews.data.items.length > 2 ? <Press haptic="tap" onPress={() => setAllReviews(true)} accessibilityRole="button" accessibilityLabel="See all reviews"><Text variant="small" tone="mutedCard">See all {reviews.data.summary.count}</Text></Press> : null}
            </View>
            {reviews.data && reviews.data.summary.count ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Text variant="title" tone="card">{reviews.data.summary.avg.toFixed(1)}</Text><Stars value={reviews.data.summary.avg} size={18} /><Text variant="small" tone="mutedCard">{reviews.data.summary.count} review{reviews.data.summary.count > 1 ? 's' : ''}</Text></View>
                {reviews.data.items.slice(0, 2).map((r) => <ReviewRow key={r.id} r={r} />)}
              </>
            ) : <Text tone="mutedCard">No reviews yet. Buyers can review after they receive it.</Text>}
          </View>
        </View>

        {similar.data?.items.length ? (
          <View style={{ paddingTop: 26 }}>
            <Text variant="heading" style={{ paddingHorizontal: 22, marginBottom: 8 }}>More like this</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 10 }}>
              {[0, 1].map((col) => (
                <View key={col} style={{ flex: 1 }}>{similar.data!.items.filter((_, i) => i % 2 === col).slice(0, 4).map((s) => <ProductCard key={s.id} product={s} />)}</View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <IconButton icon="back" label="Go back" onPress={() => router.back()} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {p.merchant.userId !== me ? <IconButton icon="more" label="More options" onPress={() => openSafetyMenu({ target: { type: 'product', id: p.id, label: p.title }, title: p.title })} /> : null}
          <IconButton icon="bookmark" label={isSaved ? 'Remove from saved' : 'Save'} active={isSaved} onPress={() => (isSaved ? toggleSave() : useSaveSheet.getState().open({ type: 'product', id: p.id, saved: false }))} haptic="none" />
        </View>
      </View>

      {!isOwn ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: 'rgba(11,11,13,0.94)', borderTopWidth: 1, borderColor: colors.line, gap: 8 }}>
          {note ? <Text variant="small" tone={note.startsWith('Added') ? 'muted' : 'danger'} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">{note}{note.startsWith('Added') ? '' : ''}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {p.kind === 'physical' || p.kind === 'digital' ? <View style={{ flex: 1 }}><Button title="Add to cart" tone="ghost" icon="cart" loading={addToCart.isPending} disabled={!p.inStock || (variants.length > 0 && !!chosen && !chosen.inStock)} onPress={addCart} /></View> : null}
            <View style={{ flex: 1 }}><Button title={p.inStock ? ACTION[p.kind] ?? 'Buy now' : 'Sold out'} major disabled={!canBuy && !needChoice} icon="bag" onPress={buyNowGo} /></View>
          </View>
          {note?.startsWith('Added') ? <Press haptic="tap" onPress={() => router.push('/cart')} accessibilityRole="button"><Text variant="small" style={{ textAlign: 'center', textDecorationLine: 'underline' }}>View cart</Text></Press> : null}
        </View>
      ) : null}
      <Sheet visible={allReviews} onClose={() => setAllReviews(false)} title={`Reviews (${reviews.data?.summary.count ?? 0})`}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>{reviews.data?.items.map((r) => <ReviewRow key={r.id} r={r} />)}</ScrollView>
      </Sheet>
    </View>
  );
}
