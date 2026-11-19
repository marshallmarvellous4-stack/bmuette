import React, { useState } from 'react';
import { TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { LoadingMark } from '@/components/Illustrations';
import { Page } from '@/components/Page';
import { SavedGrid } from '@/components/SavedGrid';
import { Button, Press, Text } from '@/components/ui';
import { useBoardActions, useBoards, useSavedAll } from '@/api/discovery';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

export default function Saved() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const boards = useBoards();
  const all = useSavedAll();
  const { create } = useBoardActions();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const w = (width - 50) / 2;
  const make = () => { const n = name.trim(); if (!n) return; create.mutate(n, { onSuccess: () => { haptics.success(); setName(''); setAdding(false); } }); };

  return (
    <Page title="Saved" subtitle="Your boards and everything you have saved.">
      {adding ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput autoFocus value={name} onChangeText={setName} placeholder="Board name" maxLength={60} accessibilityLabel="Board name" onSubmitEditing={make} placeholderTextColor="#5E6068" keyboardAppearance="dark" style={{ flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.inkRaised, paddingHorizontal: 14, color: colors.textOnInk, fontFamily: 'Inter_500Medium' }} />
          <Button title="Create" onPress={make} loading={create.isPending} />
        </View>
      ) : <Button title="New board" tone="ghost" icon="plus" onPress={() => setAdding(true)} />}

      {boards.isLoading ? <View style={{ alignItems: 'center', padding: 30 }}><LoadingMark /></View> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {(boards.data?.items ?? []).map((b) => (
            <Press key={b.id} haptic="tap" scaleTo={0.97} onPress={() => router.push(`/saved/${b.id}`)} accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.itemCount} items`} style={{ width: w }}>
              <View style={{ width: w, height: w, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.inkRaised, flexDirection: 'row', flexWrap: 'wrap' }}>
                {b.covers.length ? b.covers.slice(0, 4).map((c, i) => <Image key={i} source={{ uri: c }} style={{ width: b.covers.length === 1 ? '100%' : '50%', height: b.covers.length <= 2 ? '100%' : '50%' }} contentFit="cover" />) : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Icon name="folder" size={30} color={colors.muted} /></View>}
              </View>
              <Text variant="bodyStrong" style={{ marginTop: 8 }} numberOfLines={1}>{b.name}</Text>
              <Text variant="small" tone="muted">{b.itemCount} {b.itemCount === 1 ? 'item' : 'items'}</Text>
            </Press>
          ))}
        </View>
      )}

      <Text variant="heading">All saved</Text>
      {all.isLoading ? <LoadingMark /> : <SavedGrid posts={all.data?.posts ?? []} products={all.data?.products ?? []} emptyText="Tap the bookmark on any post or product to keep it here." />}
    </Page>
  );
}
