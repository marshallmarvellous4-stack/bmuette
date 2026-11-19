import React from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Avatar, IconButton, Press, Text } from '@/components/ui';
import { api } from '@/api/client';
import { openChat, useConversations, type ChatPerson } from '@/api/chat';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

type Found = { id: string; username: string; displayName: string; avatarUrl: string | null };

export default function NewChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user?.id);
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setDebounced(q.trim().replace(/^@/, '')), 250); return () => clearTimeout(t); }, [q]);

  const { data: recent } = useConversations();
  const search = useQuery({ queryKey: ['people', debounced], enabled: debounced.length >= 2, queryFn: () => api<{ users: Found[] }>(`/search?q=${encodeURIComponent(debounced)}&type=users`) });
  const people: ChatPerson[] = debounced.length >= 2 ? (search.data?.users ?? []).filter((u) => u.id !== me) : (recent ?? []).map((c) => c.with);

  const start = async (p: ChatPerson) => {
    if (opening) return;
    setOpening(p.id);
    setError(null);
    try {
      const c = await openChat(p.id);
      router.replace(`/chat/${c.id}`);
    } catch (e: any) {
      haptics.error();
      setError(e?.message ?? 'Could not open that chat.');
      setOpening(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 14 }}>
        <Text variant="title">New chat</Text>
        <IconButton icon="close" label="Close" tone="ink" onPress={() => router.back()} />
      </View>
      <View style={{ marginHorizontal: 16, height: 48, borderRadius: radius.pill, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Find someone by name or @username" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find someone" style={{ flex: 1, color: colors.textOnInk, fontFamily: 'Inter_500Medium', fontSize: 15, outlineStyle: 'none' } as any} />
      </View>
      {error ? <Text tone="danger" style={{ marginHorizontal: 20, marginTop: 12 }}>{error}</Text> : null}
      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={debounced.length < 2 && people.length ? <Text variant="caption" tone="muted" style={{ marginBottom: 6 }}>RECENT</Text> : undefined}
        ListEmptyComponent={<Text tone="muted" style={{ textAlign: 'center', marginTop: 40 }}>{debounced.length >= 2 ? (search.isLoading ? 'Searching' : 'No one found.') : 'Type a name to find someone.'}</Text>}
        renderItem={({ item }) => (
          <Press haptic="select" scaleTo={0.985} onPress={() => void start(item)} accessibilityRole="button" accessibilityLabel={`Message ${item.displayName}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, opacity: opening && opening !== item.id ? 0.4 : 1 }}>
            <Avatar name={item.displayName} uri={item.avatarUrl} size={48} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{item.displayName}</Text>
              <Text variant="small" tone="muted">@{item.username}</Text>
            </View>
            <Icon name="chat" size={20} color={colors.muted} />
          </Press>
        )}
      />
    </View>
  );
}
