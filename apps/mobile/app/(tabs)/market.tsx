import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Illustration, LoadingMark } from '@/components/Illustrations';
import { ProductCard } from '@/components/ProductCard';
import { Chip, Text } from '@/components/ui';
import { useMarket, useSearch } from '@/api/hooks';
import { useCartCount } from '@/api/shop';
import { useRouter } from 'expo-router';
import { IconButton } from '@/components/ui';
import type { Product } from '@/api/types';
import { Icon } from '@/theme/icons';
import { tabEvents } from '@/state/ui';
import { colors, radius, TAB_BAR } from '@/theme/tokens';

const CATEGORIES = ['All', 'fashion', 'food', 'beauty', 'tech', 'home', 'art', 'services', 'courses', 'tickets'];
const label = (c: string) => (c === 'All' ? 'All' : c[0].toUpperCase() + c.slice(1));

export default function Market() {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const router = useRouter();
  const cartCount = useCartCount({});
  const market = useMarket(category);
  const search = useSearch(debounced);
  const list = useRef<any>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => tabEvents.onReselect('market', () => { list.current?.scrollToOffset?.({ offset: 0, animated: true }); void market.refetch(); }), [market]);

  const searching = debounced.trim().length >= 2;
  const items: Product[] = searching ? search.data?.products ?? [] : market.data ?? [];
  const loading = searching ? search.isLoading : market.isLoading;
  const bottom = insets.bottom + TAB_BAR.height + TAB_BAR.bottomGap + 24;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top + 12 }}>
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Market</Text>
          <View>
            <IconButton icon="cart" tone="ink" label={cartCount.data?.count ? `Cart, ${cartCount.data.count} items` : 'Cart'} onPress={() => router.push('/cart')} />
            {cartCount.data?.count ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text variant="caption" style={{ color: '#fff' }}>{cartCount.data.count}</Text></View> : null}
          </View>
        </View>
        <View style={{ height: 48, borderRadius: radius.pill, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search products, shops, ideas" placeholderTextColor="#5E6068" keyboardAppearance="dark" returnKeyType="search" style={{ flex: 1, color: colors.textOnInk, fontSize: 16, fontFamily: 'Inter_500Medium' }} />
        </View>
      </View>
      {!searching ? (
        <View style={{ height: 62 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}>
            {CATEGORIES.map((c) => <Chip key={c} label={label(c)} selected={(category ?? 'All') === c} onPress={() => setCategory(c === 'All' ? null : c)} />)}
          </ScrollView>
        </View>
      ) : <View style={{ height: 12 }} />}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><LoadingMark /></View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingBottom: 120 }}>
          <Illustration kind={searching ? 'search' : 'bag'} />
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text variant="heading">{market.isError ? 'Could not load the market' : searching ? 'Nothing found' : 'No products yet'}</Text>
            <Text tone="muted" style={{ textAlign: 'center', maxWidth: 260 }}>{searching ? 'Try different words.' : 'Merchants will list their products here.'}</Text>
          </View>
        </View>
      ) : (
        <FlashList
          ref={list}
          data={items}
          masonry
          numColumns={2}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <ProductCard product={item} />}
          contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: bottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={1}
          onEndReached={() => { if (!searching && market.hasNextPage && !market.isFetchingNextPage) void market.fetchNextPage(); }}
        />
      )}
    </View>
  );
}
