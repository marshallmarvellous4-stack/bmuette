import React from 'react';
import { RefreshControl, TextInput, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityList } from '@/components/Activity';
import { ConversationRow } from '@/components/ChatBits';
import { Illustration } from '@/components/Illustrations';
import { Button, Press, Skeleton, Text } from '@/components/ui';
import { useConversations, useUnread } from '@/api/chat';
import { useActivityUnread } from '@/api/notifications';
import { useAuth } from '@/state/auth';
import { tabEvents } from '@/state/ui';
import { Icon } from '@/theme/icons';
import { colors, radius, TAB_BAR } from '@/theme/tokens';

export default function Chat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useAuth((s) => s.user?.id);
  const { data, isLoading, refetch, isRefetching } = useConversations();
  const [q, setQ] = React.useState('');
  const [tab, setTab] = React.useState<'messages' | 'activity'>('messages');
  const msgUnread = useUnread().data?.unread ?? 0;
  const actUnread = useActivityUnread().data?.unread ?? 0;
  const list = React.useRef<Animated.FlatList<any>>(null);
  React.useEffect(() => tabEvents.onReselect('chat', () => list.current?.scrollToOffset({ offset: 0, animated: true })), []);

  // The floating "+" slides away while you scroll down and comes back when you scroll up or reach the top.
  const hidden = useSharedValue(0);
  const lastY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    const y = Math.max(0, e.contentOffset.y);
    const dy = y - lastY.value;
    if (y < 24 || dy < -6) hidden.value = withTiming(0, { duration: 180 });
    else if (dy > 6) hidden.value = withTiming(1, { duration: 180 });
    lastY.value = y;
  });
  const fab = useAnimatedStyle(() => ({ opacity: 1 - hidden.value, transform: [{ translateY: hidden.value * 110 }, { scale: 1 - hidden.value * 0.2 }] }));

  const items = (data ?? []).filter((c) => !q.trim() || c.with.displayName.toLowerCase().includes(q.trim().toLowerCase()) || c.with.username.toLowerCase().includes(q.trim().toLowerCase()));
  const bottom = TAB_BAR.height + Math.max(insets.bottom, TAB_BAR.bottomGap) + 16;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top + 12 }}>
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        <Text variant="title">Inbox</Text>
        <View style={{ flexDirection: 'row', backgroundColor: colors.inkRaised, borderRadius: radius.pill, padding: 4 }} accessibilityRole="tablist">
          {([['messages', 'Messages', msgUnread], ['activity', 'Activity', actUnread]] as const).map(([k, label, n]) => (
            <Press key={k} haptic="select" scaleTo={0.97} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} accessibilityLabel={label}
              outerStyle={{ flex: 1 }} style={{ height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: tab === k ? colors.card : 'transparent' }}>
              <Text variant="bodyStrong" tone={tab === k ? 'card' : 'muted'}>{label}</Text>
              {n > 0 ? <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Text variant="caption" style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 11 }}>{n > 99 ? '99+' : n}</Text></View> : null}
            </Press>
          ))}
        </View>
        {tab === 'messages' ? <View style={{ height: 48, borderRadius: radius.pill, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search chats" style={{ flex: 1, color: colors.textOnInk, fontFamily: 'Inter_500Medium', fontSize: 15, outlineStyle: 'none' } as any} />
        </View> : null}
      </View>

      {tab === 'activity' ? <ActivityList bottom={bottom} /> : isLoading ? (
        <View style={{ padding: 16, gap: 18 }}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}><Skeleton style={{ width: 54, height: 54, borderRadius: 27 }} /><View style={{ flex: 1, gap: 8 }}><Skeleton style={{ height: 14, width: '45%' }} /><Skeleton style={{ height: 12, width: '75%' }} /></View></View>)}
        </View>
      ) : (
        <Animated.FlatList
          ref={list}
          data={items}
          keyExtractor={(c) => c.id}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#fff" />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottom + 80, flexGrow: 1 }}
          renderItem={({ item }) => <ConversationRow c={item} me={me} onPress={() => router.push(`/chat/${item.id}`)} />}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingBottom: 60 }}>
              <Illustration kind="chat" />
              <View style={{ alignItems: 'center', gap: 6 }}>
                <Text variant="heading">{q ? 'No one by that name' : 'No messages yet'}</Text>
                <Text tone="muted" style={{ textAlign: 'center', maxWidth: 270 }}>{q ? 'Try another name or start a new chat.' : 'Message a creator, ask a seller a question, or chat with a friend.'}</Text>
              </View>
              <View style={{ width: 200 }}><Button title="Start a chat" onPress={() => router.push('/chat/new')} /></View>
            </View>
          }
        />
      )}

      {tab === 'messages' ? <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', right: 20, bottom }, fab]}>
        <Press haptic="press" scaleTo={0.9} onPress={() => router.push('/chat/new')} accessibilityRole="button" accessibilityLabel="New chat" style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 }}>
          <Icon name="newChat" size={26} color={colors.ink} strokeWidth={2} />
        </Press>
      </Animated.View> : null}
    </View>
  );
}
