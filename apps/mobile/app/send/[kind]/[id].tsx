import React from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Press, Text } from '@/components/ui';
import { api } from '@/api/client';
import { newClientId, openChat, useConversations, type ChatPerson } from '@/api/chat';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';
import { sheetHeight } from '@/lib/sheetHeight';
import { useKeyboardHeight } from '@/lib/useKeyboard';

// "Send to…" sheet for a post or a product. Tap a person and it goes straight into your chat with them.
export default function SendTo() {
  const { kind, id } = useLocalSearchParams<{ kind: 'post' | 'product'; id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const { height: winH } = useWindowDimensions();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [state, setState] = React.useState<Record<string, 'sending' | 'sent' | 'failed'>>({});
  React.useEffect(() => { const t = setTimeout(() => setDebounced(q.trim().replace(/^@/, '')), 250); return () => clearTimeout(t); }, [q]);

  const { data: recent } = useConversations();
  const search = useQuery({ queryKey: ['people', debounced], enabled: debounced.length >= 2, queryFn: () => api<{ users: ChatPerson[] }>(`/search?q=${encodeURIComponent(debounced)}&type=users`) });
  const people = debounced.length >= 2 ? (search.data?.users ?? []).filter((u) => u.id !== me) : (recent ?? []).map((c) => c.with);

  const sendTo = async (p: ChatPerson) => {
    if (state[p.id] === 'sending' || state[p.id] === 'sent') return;
    setState((s) => ({ ...s, [p.id]: 'sending' }));
    haptics.press();
    try {
      const c = await openChat(p.id);
      await api(`/conversations/${c.id}/messages`, { method: 'POST', body: { kind, refId: id, clientId: newClientId() } });
      haptics.send();
      setState((s) => ({ ...s, [p.id]: 'sent' }));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch {
      haptics.error();
      setState((s) => ({ ...s, [p.id]: 'failed' }));
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior="padding">
        <View style={{ height: Math.min(sheetHeight(winH, insets.top, 0.7), winH - kb - insets.top - 24), backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 10 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(17,18,20,0.15)', marginBottom: 12 }} />
          <Text variant="bodyStrong" tone="card" style={{ textAlign: 'center', marginBottom: 12 }}>Send to</Text>
          <View style={{ marginHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: colors.cardSoft, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
            <Icon name="search" size={18} color={colors.mutedOnCard} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search people" placeholderTextColor="#8A8C93" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search people" style={{ flex: 1, color: colors.textOnCard, fontFamily: 'Inter_500Medium', fontSize: 15, outlineStyle: 'none' } as any} />
          </View>
          <FlatList
            data={people}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, flexGrow: 1 }}
            ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 30 }}><Text tone="mutedCard" style={{ textAlign: 'center' }}>{debounced.length >= 2 ? (search.isLoading ? 'Searching' : 'No one found.') : 'Search for someone to send this to.'}</Text></View>}
            renderItem={({ item }) => {
              const st = state[item.id];
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                  <Avatar name={item.displayName} uri={item.avatarUrl} size={46} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" tone="card">{item.displayName}</Text>
                    <Text variant="small" tone="mutedCard">@{item.username}</Text>
                  </View>
                  <Press haptic="none" scaleTo={0.92} disabled={st === 'sending' || st === 'sent'} onPress={() => void sendTo(item)} accessibilityRole="button" accessibilityLabel={`Send to ${item.displayName}`} style={{ height: 36, minWidth: 76, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: st === 'sent' ? colors.cardSoft : colors.ink }}>
                    <Text variant="small" style={{ color: st === 'sent' ? colors.textOnCard : '#fff', fontFamily: 'Inter_600SemiBold' }}>{st === 'sent' ? 'Sent' : st === 'sending' ? '...' : st === 'failed' ? 'Retry' : 'Send'}</Text>
                  </Press>
                </View>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
