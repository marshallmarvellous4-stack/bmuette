import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Chip, Field, IconButton, Press, Text } from '@/components/ui';
import { ApiError, api, getAccessToken } from '@/api/client';
import { uploadMedia, type PickedFile } from '@/api/upload';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'];
const KINDS: { id: string; label: string }[] = [{ id: 'physical', label: 'Item' }, { id: 'digital', label: 'Digital' }, { id: 'service', label: 'Service' }, { id: 'course', label: 'Course' }, { id: 'food', label: 'Food' }, { id: 'ticket', label: 'Ticket' }];
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (<><View style={{ alignSelf: 'flex-start' }}><IconButton icon="close" tone="ink" label="Close" onPress={onClose} /></View><Text variant="title">{title}</Text></>);
}

export default function Sell() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // step 1: a shop (only once)
  const [shopName, setShopName] = useState('');
  const [slug, setSlug] = useState('');
  const [country, setCountry] = useState('NG');
  // step 2: the product
  const [images, setImages] = useState<PickedFile[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [kind, setKind] = useState('physical');
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState('');

  const wrap = (children: React.ReactNode) => (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30, gap: 18 }}>{children}</ScrollView>
    </KeyboardAvoidingView>
  );

  if (!user?.isMerchant) {
    const create = async () => {
      setError(null);
      const finalSlug = slug || slugify(shopName);
      if (shopName.trim().length < 2) return setError('Give your shop a name.');
      if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(finalSlug)) return setError('Shop link: 3 to 30 lowercase letters, numbers or dashes.');
      if (country.trim().length !== 2) return setError('Country is two letters, like NG.');
      setBusy(true);
      try { await api('/merchants', { method: 'POST', body: { shopName: shopName.trim(), slug: finalSlug, description: '', country: country.toUpperCase() } }); haptics.success(); await refreshMe(); }
      catch (e) { haptics.error(); if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') router.push('/verify-email'); setError(e instanceof ApiError ? e.message : 'Could not create your shop.'); }
      finally { setBusy(false); }
    };
    return wrap(<>
      <Header title="Open your shop" onClose={() => router.back()} />
      <Text tone="muted">One minute. You can sell as soon as it is open.</Text>
      <Field label="Shop name" value={shopName} onChangeText={(v) => { setShopName(v); setSlug(slugify(v)); }} autoCapitalize="words" placeholder="Ada's Kicks" />
      <Field label="Shop link" value={slug} onChangeText={(v) => setSlug(slugify(v))} placeholder="adas-kicks" />
      <Field label="Country (2 letters)" value={country} onChangeText={setCountry} maxLength={2} autoCapitalize="characters" />
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button title="Open shop" major loading={busy} onPress={create} />
    </>);
  }

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { haptics.warning(); return setError('Allow photo access in Settings to add pictures.'); }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.85 });
    if (r.canceled) return;
    haptics.select(); setError(null);
    setImages(r.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, width: a.width, height: a.height, fileName: a.fileName })));
  }

  async function publish() {
    setError(null);
    const priceNum = Number(price.replace(',', '.'));
    if (!images.length) return setError('Add at least one photo.');
    if (title.trim().length < 2) return setError('Give your product a title.');
    if (!(priceNum >= 0) || price.trim() === '') return setError('Enter a price.');
    setBusy(true);
    try {
      const token = getAccessToken();
      const media = [];
      for (const img of images) media.push(await uploadMedia(img, 'image', token));
      await api('/products', { method: 'POST', body: {
        title: title.trim(), description: description.trim(), kind, priceMinor: Math.round(priceNum * 100), currency,
        stock: stock.trim() === '' ? null : Math.max(0, Math.floor(Number(stock) || 0)), category: category.trim().toLowerCase() || 'general', tags: [], mediaIds: media.map((m) => m.id),
      } });
      haptics.success();
      void qc.invalidateQueries({ queryKey: ['market'] });
      router.back();
    } catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not list your product.'); }
    finally { setBusy(false); }
  }

  return wrap(<>
    <Header title="Sell a product" onClose={() => router.back()} />
    <Press haptic="press" onPress={pickImages} accessibilityRole="button" accessibilityLabel="Add photos" style={{ height: 220, borderRadius: radius.lg, backgroundColor: colors.inkRaised, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {images.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '100%', height: '100%' }}>
          {images.map((i, n) => <Image key={n} source={{ uri: i.uri }} style={{ width: images.length === 1 ? '100%' : '33.33%', height: images.length === 1 ? '100%' : '50%' }} contentFit="cover" />)}
        </View>
      ) : (<View style={{ alignItems: 'center', gap: 10 }}><Icon name="camera" size={32} color="#fff" /><Text variant="bodyStrong">Add photos</Text><Text variant="small" tone="muted">Up to 5. Bright, close-up shots sell best.</Text></View>)}
    </Press>
    <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" placeholder="White leather sneakers" />
    <Field label="Description" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" style={{ height: 100, paddingTop: 14, textAlignVertical: 'top' }} />
    <Text variant="small" tone="muted">What are you selling?</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{KINDS.map((k) => <Chip key={k.id} label={k.label} selected={kind === k.id} onPress={() => setKind(k.id)} />)}</View>
    <Text variant="small" tone="muted">Currency</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{CURRENCIES.map((c) => <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />)}</View>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ flex: 1 }}><Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="25000" /></View>
      <View style={{ flex: 1 }}><Field label="In stock (optional)" value={stock} onChangeText={setStock} keyboardType="number-pad" /></View>
    </View>
    <Field label="Category" value={category} onChangeText={setCategory} placeholder="fashion" />
    {error ? <Text tone="danger">{error}</Text> : null}
    <Button title="List product" major loading={busy} onPress={publish} />
  </>);
}
