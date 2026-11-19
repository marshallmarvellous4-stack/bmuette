import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LoadingMark } from '@/components/Illustrations';
import { Page } from '@/components/Page';
import { SavedGrid } from '@/components/SavedGrid';
import { Button, IconButton } from '@/components/ui';
import { useBoardActions, useBoardItems, useBoards } from '@/api/discovery';
import { confirm } from '@/lib/moderation';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';

export default function Board() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const boards = useBoards();
  const items = useBoardItems(String(id));
  const { rename, remove } = useBoardActions();
  const board = boards.data?.items.find((b) => b.id === id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/saved'));
  const save = () => { const n = name.trim(); if (!n) return; rename.mutate({ id: String(id), name: n }, { onSuccess: () => { haptics.success(); setEditing(false); } }); };

  return (
    <Page title={board?.name ?? 'Board'} subtitle={board ? `${board.itemCount} ${board.itemCount === 1 ? 'item' : 'items'}` : undefined}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        {editing ? (
          <>
            <TextInput autoFocus value={name} onChangeText={setName} maxLength={60} accessibilityLabel="Board name" onSubmitEditing={save} placeholderTextColor="#5E6068" keyboardAppearance="dark" style={{ flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.inkRaised, paddingHorizontal: 14, color: colors.textOnInk, fontFamily: 'Inter_500Medium' }} />
            <Button title="Save" onPress={save} loading={rename.isPending} />
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}><Button title="Rename" tone="ghost" onPress={() => { setName(board?.name ?? ''); setEditing(true); }} /></View>
            <View style={{ flex: 1 }}><Button title="Delete board" tone="ghost" onPress={() => confirm('Delete this board?', 'Your saved items stay in Saved. Only the board is removed.', 'Delete', () => remove.mutate(String(id), { onSuccess: leave }))} /></View>
          </>
        )}
      </View>
      {items.isLoading ? <LoadingMark /> : <SavedGrid posts={items.data?.posts ?? []} products={items.data?.products ?? []} emptyText="Nothing in this board yet. Save a post and choose this board." />}
    </Page>
  );
}
void IconButton;
