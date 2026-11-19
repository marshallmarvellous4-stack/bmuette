import React, { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Sheet } from './Sheet';
import { Press, Text } from './ui';
import { fmtDuration } from './Voice';
import { useSounds } from '@/api/discovery';
import type { Sound } from '@/api/types';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

// The music library: search, tap the play button to hear a few seconds, tap a row to use it.
export function SoundSheet({ visible, onClose, onPick, selectedId }: { visible: boolean; onClose: () => void; onPick: (s: Sound | null) => void; selectedId?: string | null }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const sounds = useSounds(term);
  const player = useAudioPlayer();
  useEffect(() => { const t = setTimeout(() => setTerm(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);
  useEffect(() => { if (!visible) { player.pause(); setPlaying(null); } }, [visible, player]);

  const preview = (s: Sound) => {
    haptics.tap();
    if (playing === s.id) { player.pause(); setPlaying(null); return; }
    player.replace({ uri: s.url }); player.loop = true; player.play(); setPlaying(s.id);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Add a sound">
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search by title or mood" accessibilityLabel="Search sounds" placeholderTextColor="#9A9CA3" style={{ height: 44, borderRadius: radius.pill, backgroundColor: colors.cardSoft, paddingHorizontal: 16, color: colors.textOnCard, fontFamily: 'Inter_500Medium' }} />
      </View>
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {selectedId ? (
          <Press haptic="tap" onPress={() => { onPick(null); onClose(); }} accessibilityRole="button" accessibilityLabel="Remove sound" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingVertical: 12 }}>
            <Icon name="close" size={22} color={colors.danger} /><Text variant="bodyStrong" tone="danger">No sound</Text>
          </Press>
        ) : null}
        {(sounds.data?.items ?? []).map((s) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 }}>
            <Press haptic="none" scaleTo={0.9} onPress={() => preview(s)} accessibilityRole="button" accessibilityLabel={playing === s.id ? `Stop ${s.title}` : `Preview ${s.title}`} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: s.color ?? colors.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={playing === s.id ? 'pause' : 'play'} size={20} color="#fff" active />
            </Press>
            <Press haptic="select" onPress={() => { onPick(s); onClose(); }} accessibilityRole="button" accessibilityLabel={`Use ${s.title}`} style={{ flex: 1, paddingVertical: 6 }}>
              <Text variant="bodyStrong" tone="card" numberOfLines={1}>{s.title}{selectedId === s.id ? '  ✓' : ''}</Text>
              <Text variant="small" tone="mutedCard" numberOfLines={1}>{s.artist}{s.mood ? ` · ${s.mood}` : ''} · {fmtDuration(s.durationMs)}</Text>
            </Press>
          </View>
        ))}
        {sounds.data && !sounds.data.items.length ? <Text tone="mutedCard" style={{ padding: 24, textAlign: 'center' }}>No sounds match that.</Text> : null}
      </ScrollView>
    </Sheet>
  );
}
