import React, { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MenuRow, Sheet } from './Sheet';
import { Button, Press, Text } from './ui';
import { REASONS, useSendReport } from '@/api/safety';
import { useMenu, useReport } from '@/state/menu';
import { useSaveSheet } from '@/state/saveSheet';
import { useBoardActions, useBoards, useSaveItem } from '@/api/discovery';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

// Mounted once in the root layout. Screens call useMenu.getState().show(...) or useReport.getState().start(...).
export function MenuHost() {
  const { menu, hide } = useMenu();
  return (
    <Sheet visible={!!menu} onClose={hide} title={menu?.title}>
      {menu?.actions.map((a) => <MenuRow key={a.label} action={a} onDone={hide} />)}
    </Sheet>
  );
}

const NOUN = { post: 'post', product: 'listing', user: 'account', comment: 'comment' } as const;

export function ReportHost() {
  const { target, close } = useReport();
  const send = useSendReport();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (target) { setReason(null); setDetails(''); setDone(false); setError(null); send.reset(); } }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!target || !reason) return;
    setError(null);
    send.mutate({ target, reason, details: details.trim() || undefined }, {
      onSuccess: () => { haptics.success(); setDone(true); },
      onError: (e: any) => { haptics.error(); setError(e?.message ?? 'Could not send the report.'); },
    });
  };

  return (
    <Sheet visible={!!target} onClose={close} title={done ? undefined : `Report this ${target ? NOUN[target.type] : ''}`}>
      {done ? (
        <View style={{ alignItems: 'center', gap: 10, padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={28} color="#fff" strokeWidth={2.4} /></View>
          <Text variant="heading" tone="card">Thanks for telling us</Text>
          <Text tone="mutedCard" style={{ textAlign: 'center' }}>Our team will look at it. You will not see it again if we remove it. You can also block the person from their profile.</Text>
          <Button title="Done" tone="dark" onPress={close} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
          <Text variant="small" tone="mutedCard" style={{ paddingHorizontal: 22, marginBottom: 6 }}>Why are you reporting it? It is private.</Text>
          {REASONS.map((r) => (
            <Press key={r.id} haptic="select" scaleTo={0.985} onPress={() => setReason(r.id)} accessibilityRole="radio" accessibilityState={{ selected: reason === r.id }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 14 }}>
              <Text variant="bodyStrong" tone="card">{r.label}</Text>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: reason === r.id ? colors.ink : 'rgba(17,18,20,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                {reason === r.id ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.ink }} /> : null}
              </View>
            </Press>
          ))}
          {reason ? (
            <View style={{ paddingHorizontal: 22, gap: 12, paddingTop: 6 }}>
              <TextInput value={details} onChangeText={setDetails} placeholder="Add details (optional)" placeholderTextColor="#8A8C93" multiline maxLength={500} style={{ minHeight: 70, borderRadius: radius.md, backgroundColor: colors.cardSoft, padding: 14, color: colors.textOnCard, fontSize: 15, textAlignVertical: 'top' }} />
              {error ? <Text variant="small" tone="danger">{error}</Text> : null}
              <Button title="Send report" tone="dark" major loading={send.isPending} onPress={submit} />
            </View>
          ) : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

// "Save to a board": pick a board, make a new one, or save without one. Mounted once in the root layout.
export function SaveHost() {
  const { target, close } = useSaveSheet();
  const boards = useBoards();
  const save = useSaveItem();
  const { create } = useBoardActions();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (target) { setName(''); setAdding(false); setError(null); } }, [target]);
  if (!target) return <Sheet visible={false} onClose={close}><View /></Sheet>;

  const done = (collectionId?: string) => save.mutate({ type: target.type, id: target.id, save: true, collectionId }, { onSuccess: () => { haptics.success(); close(); }, onError: () => { haptics.error(); setError('Could not save. Try again.'); } });
  const makeBoard = () => {
    const n = name.trim();
    if (!n) return;
    create.mutate(n, { onSuccess: (b) => done(b.id), onError: () => setError('Could not create the board.') });
  };
  return (
    <Sheet visible onClose={close} title="Save to">
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        <MenuRow action={{ label: 'Saved (no board)', icon: 'bookmark', onPress: () => done() }} onDone={() => {}} />
        {(boards.data?.items ?? []).map((b) => <MenuRow key={b.id} action={{ label: `${b.name}  ·  ${b.itemCount}`, icon: 'folder', onPress: () => done(b.id) }} onDone={() => {}} />)}
        {adding ? (
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 10 }}>
            <TextInput autoFocus value={name} onChangeText={setName} placeholder="Board name" maxLength={60} accessibilityLabel="Board name" onSubmitEditing={makeBoard} placeholderTextColor="#9A9CA3" style={{ flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.cardSoft, paddingHorizontal: 14, color: colors.textOnCard, fontFamily: 'Inter_500Medium' }} />
            <Button title="Create" tone="dark" onPress={makeBoard} loading={create.isPending} />
          </View>
        ) : <MenuRow action={{ label: 'New board', icon: 'plus', onPress: () => setAdding(true) }} onDone={() => {}} />}
        {target.saved ? <MenuRow action={{ label: 'Remove from saved', icon: 'trash', danger: true, onPress: () => save.mutate({ type: target.type, id: target.id, save: false }, { onSuccess: () => { haptics.tap(); close(); } }) }} onDone={() => {}} /> : null}
        {error ? <Text tone="danger" style={{ paddingHorizontal: 22, paddingVertical: 8 }}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}
