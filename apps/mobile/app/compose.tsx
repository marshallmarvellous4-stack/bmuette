import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { EditLayer } from '@/components/EditLayer';
import { Slider } from '@/components/Slider';
import { SoundSheet } from '@/components/SoundSheet';
import { Button, Chip, Field, IconButton, Press, Text } from '@/components/ui';
import { fmtDuration } from '@/components/Voice';
import { FILTERS, TEXT_COLORS, TEXT_POSITIONS } from '@/lib/edit';
import type { FilterName, PostEdit, Sound, TextOverlay } from '@/api/types';
import { ApiError, api, getAccessToken } from '@/api/client';
import { uploadMedia, type PickedFile } from '@/api/upload';
import { useMyProducts } from '@/api/shop';
import { useAuth } from '@/state/auth';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

export default function Compose() {
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const kind: 'video' | 'photo' = kindParam === 'photo' ? 'photo' : 'video';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [durationMs, setDurationMs] = useState(0);
  const [sound, setSound] = useState<Sound | null>(null);
  const [soundVol, setSoundVol] = useState(70);
  const [origVol, setOrigVol] = useState(100);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [filter, setFilter] = useState<FilterName>('none');
  const [texts, setTexts] = useState<TextOverlay[]>([]);
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState(TEXT_COLORS[0]);
  const [draftPos, setDraftPos] = useState<(typeof TEXT_POSITIONS)[number]['id']>('middle');
  const [soundOpen, setSoundOpen] = useState(false);
  const isMerchant = useAuth((x) => !!x.user?.isMerchant);
  const mine = useMyProducts();
  const [tagged, setTagged] = useState<{ id: string; atMs: number | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { haptics.warning(); return setError('Allow photo access in Settings to choose a file.'); }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === 'video' ? ['videos'] : ['images'], quality: 0.85, videoMaxDuration: 180 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    haptics.select(); setError(null);
    const d = Math.round(a.duration ?? 0); setDurationMs(d); setTrim([0, d]);
    setFile({ uri: a.uri, mimeType: a.mimeType, width: a.width, height: a.height, fileName: a.fileName });
  }

  async function post() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const media = await uploadMedia(file, kind === 'video' ? 'video' : 'image', getAccessToken());
      const tagList = tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 15);
      const trimmed = kind === 'video' && durationMs > 0 && (trim[0] > 0 || trim[1] < durationMs);
      const edit: PostEdit | undefined = filter !== 'none' || texts.length || trimmed
        ? { filter, texts, ...(trimmed ? { trimStartMs: trim[0], trimEndMs: trim[1] } : {}) } : undefined;
      await api('/posts', { method: 'POST', body: { kind, caption: caption.trim(), tags: tagList, mediaIds: [media.id], ...(sound ? { soundId: sound.id, soundVolume: soundVol } : {}), ...(kind === 'video' && sound ? { originalVolume: origVol } : {}), ...(edit ? { edit } : {}), ...(tagged.length ? { products: tagged.map((t) => ({ productId: t.id, ...(t.atMs !== null ? { atMs: t.atMs } : {}) })) } : {}) } });
      haptics.success();
      void qc.invalidateQueries({ queryKey: ['feed'] }); void qc.invalidateQueries({ queryKey: ['userPosts'] });
      router.back();
    } catch (e) {
      haptics.error();
      setError(e instanceof ApiError ? e.message : 'Could not post. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30, gap: 20 }}>
        <View style={{ alignSelf: 'flex-start' }}><IconButton icon="close" tone="ink" label="Close" onPress={() => router.back()} /></View>
        <Text variant="title">{kind === 'video' ? 'New video' : 'New photo'}</Text>
        <Press haptic="press" onPress={pick} accessibilityRole="button" accessibilityLabel="Choose a file" style={{ height: 300, borderRadius: radius.lg, backgroundColor: colors.inkRaised, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {file ? (
            <>
              <EditLayer edit={{ filter, texts }}><Image source={{ uri: file.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /></EditLayer>
              {kind === 'video' ? <View pointerEvents="none" style={{ position: 'absolute' }}><Icon name="play" size={48} color="#fff" active /></View> : null}
            </>
          ) : (
            <View style={{ alignItems: 'center', gap: 10 }}><Icon name={kind === 'video' ? 'video' : 'image'} size={34} color="#fff" /><Text variant="bodyStrong">Choose {kind === 'video' ? 'a video' : 'a photo'}</Text><Text variant="small" tone="muted">Tap to open your library</Text></View>
          )}
        </Press>
        {file ? (
          <View style={{ gap: 18 }}>
            <View style={{ gap: 10 }}>
              <Text variant="heading">Sound</Text>
              <Press haptic="press" onPress={() => setSoundOpen(true)} accessibilityRole="button" accessibilityLabel={sound ? `Sound: ${sound.title}. Change` : 'Add sound'} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.inkRaised }}>
                <Icon name="music" size={22} color="#fff" />
                <View style={{ flex: 1 }}><Text variant="bodyStrong" numberOfLines={1}>{sound ? sound.title : 'Add a sound'}</Text>{sound ? <Text variant="small" tone="muted">{sound.artist}</Text> : <Text variant="small" tone="muted">Pick music from the library</Text>}</View>
                <Text variant="small" tone="muted">{sound ? 'Change' : ''}</Text>
              </Press>
              {sound ? (
                <View style={{ gap: 2 }}>
                  <Text variant="small" tone="muted">Music volume · {soundVol}%</Text>
                  <Slider label="Music volume" value={soundVol} onChange={setSoundVol} />
                  {kind === 'video' ? <><Text variant="small" tone="muted">Original sound · {origVol}%</Text><Slider label="Original sound volume" value={origVol} onChange={setOrigVol} /></> : null}
                </View>
              ) : null}
            </View>

            {kind === 'video' && durationMs > 0 ? (
              <View style={{ gap: 2 }}>
                <Text variant="heading">Trim</Text>
                <Text variant="small" tone="muted">Start {fmtDuration(trim[0])}   ·   End {fmtDuration(trim[1])}   ·   Length {fmtDuration(trim[1] - trim[0])}</Text>
                <Slider label="Trim start" value={trim[0]} min={0} max={Math.max(0, durationMs - 1000)} step={100} onChange={(v) => setTrim(([, e]) => [v, Math.max(e, v + 1000)])} />
                <Slider label="Trim end" value={trim[1]} min={Math.min(1000, durationMs)} max={durationMs} step={100} onChange={(v) => setTrim(([st]) => [Math.min(st, Math.max(0, v - 1000)), v])} />
              </View>
            ) : null}

            <View style={{ gap: 10 }}>
              <Text variant="heading">Filter</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {FILTERS.map((f) => <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => { haptics.select(); setFilter(f.id); }} />)}
              </ScrollView>
            </View>

            <View style={{ gap: 10 }}>
              <Text variant="heading">Text on {kind === 'video' ? 'video' : 'photo'}</Text>
              <Field label="Words on the picture" value={draft} onChangeText={setDraft} maxLength={80} placeholder="New drop, 20% off" autoCapitalize="sentences" />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {TEXT_COLORS.map((c) => <Press key={c} haptic="select" onPress={() => setDraftColor(c)} accessibilityRole="button" accessibilityLabel={`Text colour ${c}`} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: draftColor === c ? 3 : 1, borderColor: draftColor === c ? '#888' : 'rgba(255,255,255,0.3)' }}><View /></Press>)}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TEXT_POSITIONS.map((p) => <Chip key={p.id} label={p.label} selected={draftPos === p.id} onPress={() => setDraftPos(p.id)} />)}
              </View>
              <Button title="Add text" tone="ghost" icon="text" disabled={!draft.trim() || texts.length >= 8} onPress={() => { const pos = TEXT_POSITIONS.find((p) => p.id === draftPos)!; setTexts((t) => [...t, { text: draft.trim(), x: pos.x, y: pos.y, color: draftColor, size: 28 }]); setDraft(''); haptics.success(); }} />
              {texts.map((t, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.color }} /><Text style={{ flex: 1 }} numberOfLines={1}>{t.text}</Text>
                  <Press haptic="tap" onPress={() => setTexts((x) => x.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove text ${t.text}`}><Icon name="close" size={18} color={colors.muted} /></Press>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {isMerchant && (mine.data?.items.filter((p) => p.status === 'active').length ?? 0) > 0 ? (
          <View style={{ gap: 10 }}>
            <Text variant="heading">Tag products</Text>
            <Text variant="small" tone="muted">Viewers tap the Shop button to buy what they see. Up to 6.</Text>
            {mine.data!.items.filter((p) => p.status === 'active').map((p) => {
              const t = tagged.find((x) => x.id === p.id);
              return (
                <View key={p.id} style={{ gap: 4 }}>
                  <Press haptic="select" onPress={() => setTagged((l) => (t ? l.filter((x) => x.id !== p.id) : l.length >= 6 ? l : [...l, { id: p.id, atMs: null }]))} accessibilityRole="checkbox" accessibilityState={{ checked: !!t }} accessibilityLabel={`Tag ${p.title}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: colors.inkRaised, borderWidth: 1.5, borderColor: t ? '#fff' : 'transparent' }}>
                    <Icon name={t ? 'check' : 'tag'} size={20} color="#fff" />
                    <View style={{ flex: 1 }}><Text variant="bodyStrong" numberOfLines={1}>{p.title}</Text><Text variant="small" tone="muted">{formatMoney(p.price.amountMinor, p.price.currency)}</Text></View>
                  </Press>
                  {t && kind === 'video' && durationMs > 0 ? (
                    <View style={{ paddingHorizontal: 6 }}>
                      <Text variant="small" tone="muted">{t.atMs === null ? 'Shown the whole time' : `Pinned from ${fmtDuration(t.atMs)}`}   <Text variant="small" onPress={() => setTagged((l) => l.map((x) => (x.id === p.id ? { ...x, atMs: x.atMs === null ? trim[0] : null } : x)))} style={{ textDecorationLine: 'underline' }} accessibilityRole="button">{t.atMs === null ? 'Pin to a moment' : 'Show all the time'}</Text></Text>
                      {t.atMs !== null ? <Slider label={`Pin time for ${p.title}`} value={t.atMs} min={0} max={Math.max(0, durationMs - 1000)} step={100} onChange={(v) => setTagged((l) => l.map((x) => (x.id === p.id ? { ...x, atMs: v } : x)))} /> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <Field label="Caption" value={caption} onChangeText={setCaption} multiline maxLength={2200} autoCapitalize="sentences" placeholder="Say something about it" style={{ height: 96, paddingTop: 14, textAlignVertical: 'top' }} />
        <Field label="Tags" value={tags} onChangeText={setTags} placeholder="sneakers style lagos" />
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button title={busy ? 'Posting' : 'Post'} major disabled={!file} loading={busy} onPress={post} />
        <SoundSheet visible={soundOpen} onClose={() => setSoundOpen(false)} onPick={setSound} selectedId={sound?.id} />
        {kind === 'video' ? <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>Videos are prepared after upload and appear in the feed in a moment.</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
