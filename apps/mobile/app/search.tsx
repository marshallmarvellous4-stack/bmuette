import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingMark } from '@/components/Illustrations';
import { ProductCard } from '@/components/ProductCard';
import { Tiles } from '@/components/PostTile';
import { Avatar, Chip, IconButton, Press, Text } from '@/components/ui';
import { useFind, useSuggest, useTrendingSearches, useTrendingTags } from '@/api/discovery';
import { compact } from '@/lib/money';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

type Tab = 'posts' | 'products' | 'users';
const TABS: { id: Tab; label: string }[] = [{ id: 'posts', label: 'Posts' }, { id: 'products', label: 'Products' }, { id: 'users', label: 'People' }];

export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [tab, setTab] = useState<Tab>('posts');
  const tags = useTrendingTags();
  const searches = useTrendingSearches();
  const suggest = useSuggest(q);
  const found = useFind(term, tab);
  useEffect(() => { const t = setTimeout(() => setTerm(q), 350); return () => clearTimeout(t); }, [q]);
  const searching = term.trim().length >= 2;
  const typing = q.trim().length >= 1 && !searching;

  const openSuggestion = (s: { type: string; text: string }) => {
    if (s.type === 'tag') router.push(`/tag/${encodeURIComponent(s.text)}`);
    else if (s.type === 'user') router.push(`/profile/${s.text}`);
    else { setQ(s.text); setTerm(s.text); setTab('products'); }
  };
  const posts = found.data?.posts ?? [], products = found.data?.products ?? [], users = found.data?.users ?? [];
  const empty = searching && !found.isLoading && (tab === 'posts' ? !posts.length : tab === 'products' ? !products.length : !users.length);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <IconButton icon="back" tone="ink" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1, height: 48, borderRadius: radius.pill, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search people, products, posts" placeholderTextColor="#5E6068" keyboardAppearance="dark" returnKeyType="search" onSubmitEditing={() => setTerm(q)} accessibilityLabel="Search" style={{ flex: 1, color: colors.textOnInk, fontSize: 16, fontFamily: 'Inter_500Medium', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) }} />
          {q ? <Press haptic="tap" onPress={() => { setQ(''); setTerm(''); }} accessibilityLabel="Clear"><Icon name="close" size={18} color={colors.muted} /></Press> : null}
        </View>
      </View>

      {searching ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 }}>
            {TABS.map((t) => <Chip key={t.id} label={t.label} selected={tab === t.id} onPress={() => setTab(t.id)} />)}
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
            {found.isLoading ? <View style={{ alignItems: 'center', padding: 40 }}><LoadingMark /></View> : null}
            {empty ? <View style={{ alignItems: 'center', padding: 40 }}><Text tone="muted">Nothing found for “{term}”.</Text></View> : null}
            {tab === 'posts' ? <Tiles posts={posts} width={width} /> : null}
            {tab === 'products' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 }}>{products.map((p) => <View key={p.id} style={{ width: '50%' }}><ProductCard product={p} /></View>)}</View> : null}
            {tab === 'users' ? users.map((u) => (
              <Press key={u.id} haptic="tap" onPress={() => router.push(`/profile/${u.username}`)} accessibilityRole="button" accessibilityLabel={`Open ${u.displayName}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 }}>
                <Avatar name={u.displayName} uri={u.avatarUrl} size={48} />
                <View style={{ flex: 1 }}><Text variant="bodyStrong">{u.displayName}</Text><Text variant="small" tone="muted">@{u.username} · {compact(u.followerCount)} followers{u.isMerchant ? ' · Shop' : ''}</Text></View>
              </Press>
            )) : null}
          </ScrollView>
        </View>
      ) : typing ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 4 }}>
          {(suggest.data ?? []).map((s) => (
            <Press key={`${s.type}${s.text}`} haptic="tap" onPress={() => openSuggestion(s)} accessibilityRole="button" accessibilityLabel={`${s.type} ${s.text}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <Icon name={s.type === 'tag' ? 'hash' : s.type === 'user' ? 'user' : 'bag'} size={20} color={colors.muted} />
              <Text>{s.type === 'tag' ? `#${s.text}` : s.type === 'user' ? `@${s.text}` : s.text}</Text>
            </Press>
          ))}
          <Press haptic="tap" onPress={() => setTerm(q)} style={{ paddingVertical: 12 }}><Text tone="muted">Search for “{q}”</Text></Press>
        </ScrollView>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 26, paddingBottom: insets.bottom + 30 }}>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="trending" size={20} color="#fff" /><Text variant="heading">Trending now</Text></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(tags.data?.items ?? []).map((t) => <Chip key={t.tag} label={`#${t.tag}`} onPress={() => router.push(`/tag/${encodeURIComponent(t.tag)}`)} />)}
              {tags.data && !tags.data.items.length ? <Text tone="muted">Hashtags people use will show up here.</Text> : null}
            </View>
          </View>
          {(searches.data?.items.length ?? 0) > 0 ? (
            <View style={{ gap: 6 }}>
              <Text variant="heading">Popular searches</Text>
              {searches.data!.items.map((s) => (
                <Press key={s} haptic="tap" onPress={() => { setQ(s); setTerm(s); }} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 }}>
                  <Icon name="search" size={18} color={colors.muted} /><Text>{s}</Text>
                </Press>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
void Image;
