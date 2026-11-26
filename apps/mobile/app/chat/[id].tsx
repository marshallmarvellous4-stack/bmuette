import React from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SharedCard } from '@/components/ChatBits';
import { RecordingBar, TypingDots, VoiceBubble, useVoiceRecorder } from '@/components/Voice';
import { Avatar, IconButton, Press, Text } from '@/components/ui';
import { api, getAccessToken } from '@/api/client';
import { flatten, markRead, useChatState, useIsTyping, useSendMessage, useThread, type ChatMessage, type Conversation } from '@/api/chat';
import { uploadMedia } from '@/api/upload';
import { sendTyping } from '@/state/realtime';
import { clock, dayHeading, sameDay } from '@/lib/time';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

const GROUP_MS = 5 * 60_000;

function Bubble({ m, mine, tail, onOpen, onRetry }: { m: ChatMessage; mine: boolean; tail: boolean; onOpen: () => void; onRetry: () => void }) {
  const fill = mine ? colors.card : colors.inkRaised;
  const ink = mine ? 'card' : 'ink';
  const corner = tail ? 6 : 20;
  const shape = { borderRadius: 20, [mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: corner } as const;
  const media = m.kind === 'image' && m.mediaUrl;
  const shared = m.kind === 'post' || m.kind === 'product';
  const voice = m.kind === 'voice';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Press haptic="none" scaleTo={m.state === 'failed' ? 0.97 : 1} onPress={m.state === 'failed' ? onRetry : undefined} disabled={m.state !== 'failed' && !voice && !shared} outerStyle={{ maxWidth: '82%' }}
        style={[{ overflow: 'hidden', backgroundColor: shared ? 'transparent' : fill, opacity: m.state === 'sending' ? 0.6 : 1 }, shape, media || shared ? { padding: shared ? 0 : 4 } : voice ? { paddingHorizontal: 10, paddingVertical: 8 } : { paddingHorizontal: 14, paddingVertical: 10 }]}>
        {voice ? (m.mediaUrl ? <VoiceBubble uri={m.mediaUrl} durationMs={m.durationMs ?? 0} seed={m.clientId} mine={mine} /> : <Text variant="small" tone={ink}>Voice note</Text>) : null}
        {media ? <Image source={{ uri: m.mediaUrl! }} style={{ width: 230, height: 290, borderRadius: 16, backgroundColor: colors.inkHigh }} contentFit="cover" /> : null}
        {shared ? <SharedCard m={m} onPress={onOpen} /> : null}
        {m.body && !shared && !voice ? <Text tone={ink} style={media ? { paddingHorizontal: 10, paddingVertical: 8 } : undefined}>{m.body}</Text> : null}
        {m.body && shared ? <Text tone="ink" style={{ marginTop: 6 }}>{m.body}</Text> : null}
      </Press>
    </View>
  );
}

function SendButton({ ready, onPress }: { ready: boolean; onPress: () => void }) {
  const s = useSharedValue(ready ? 1 : 0);
  React.useEffect(() => { s.value = withSpring(ready ? 1 : 0, { damping: 12, stiffness: 260 }); }, [ready, s]);
  const style = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: 0.5 + 0.5 * s.value }, { rotate: `${(1 - s.value) * -40}deg` }] }));
  return (
    <Animated.View style={[{ width: 44, height: 44 }, style]} pointerEvents={ready ? 'auto' : 'none'}>
      <Press haptic="none" scaleTo={0.88} onPress={onPress} accessibilityRole="button" accessibilityLabel="Send" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="send" size={20} color={colors.ink} active />
      </Press>
    </Animated.View>
  );
}

export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user!.id);
  const convo = useQuery({ queryKey: ['conversation', id], queryFn: () => api<Conversation>(`/conversations/${id}`) });
  const thread = useThread(id);
  const { send, retry } = useSendMessage(id, me);
  const [text, setText] = React.useState('');
  const [busyImage, setBusyImage] = React.useState(false);
  const typing = useIsTyping(id);
  const voice = useVoiceRecorder();
  const lastPing = React.useRef(0);
  const onChangeText = (t: string) => {
    setText(t);
    const now = Date.now();
    if (t.trim() && now - lastPing.current > 2500) { lastPing.current = now; sendTyping(id); }
  };

  const onVoiceSend = async () => {
    const rec = await voice.finish();
    if (!rec) { haptics.error(); return; }
    haptics.send();
    try {
      const media = await uploadMedia({ uri: rec.uri, mimeType: rec.mimeType }, 'audio', getAccessToken());
      send({ kind: 'voice', mediaId: media.id, durationMs: rec.durationMs }, { mediaUrl: rec.uri, durationMs: rec.durationMs });
    } catch { haptics.error(); }
  };
  const messages = flatten(thread.data);
  const peerReadAt = thread.data?.pages[0]?.peerReadAt ?? null;
  const peer = convo.data?.with;

  // While this screen is open, new messages count as read straight away.
  React.useEffect(() => {
    useChatState.setState({ openId: id });
    markRead(qc, id);
    return () => { useChatState.setState({ openId: null }); };
  }, [id, qc]);
  const newestId = messages[0]?.id;
  React.useEffect(() => { if (newestId && !newestId.startsWith('local-') && messages[0]?.senderId !== me) markRead(qc, id); }, [newestId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSend = () => {
    const body = text.trim();
    if (!body) return;
    haptics.send();
    setText('');
    send({ kind: 'text', body });
  };

  const onPhoto = async () => {
    if (busyImage) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    haptics.press();
    setBusyImage(true);
    try {
      const media = await uploadMedia({ uri: a.uri, mimeType: a.mimeType, width: a.width, height: a.height, fileName: a.fileName }, 'image', getAccessToken());
      haptics.send();
      send({ kind: 'image', mediaId: media.id }, { mediaUrl: a.uri });
    } catch { haptics.error(); } finally { setBusyImage(false); }
  };

  const open = (m: ChatMessage) => { if (m.refId) router.push(m.kind === 'product' ? `/product/${m.refId}` : `/post/${m.refId}`); };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ink }}>
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: colors.line }}>
        <IconButton icon="back" label="Back" tone="ink" onPress={() => router.back()} />
        <Press haptic="tap" scaleTo={0.97} onPress={() => peer && router.push(`/profile/${peer.username}`)} accessibilityRole="button" accessibilityLabel={peer ? `Open ${peer.displayName}'s profile` : 'Profile'} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Avatar name={peer?.displayName} uri={peer?.avatarUrl} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>{peer?.displayName ?? ' '}</Text>
            <Text variant="small" tone={typing ? 'ink' : 'muted'} numberOfLines={1}>{typing ? 'typing…' : peer ? `@${peer.username}` : ' '}</Text>
          </View>
        </Press>
      </View>

      <FlatList
        data={messages}
        inverted
        keyExtractor={(m) => m.clientId}
        onEndReached={() => { if (thread.hasNextPage && !thread.isFetchingNextPage) void thread.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 14, gap: 3 }}
        ListHeaderComponent={typing ? <TypingDots /> : undefined}
        ListFooterComponent={thread.isFetchingNextPage ? <ActivityIndicator color="#fff" style={{ margin: 16 }} /> : undefined}
        ListEmptyComponent={thread.isLoading ? undefined : <View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', padding: 40, gap: 6 }}><Text variant="bodyStrong">Say hello</Text><Text tone="muted" style={{ textAlign: 'center' }}>Messages here are between you and {peer?.displayName ?? 'them'}.</Text></View>}
        renderItem={({ item, index }) => {
          const mine = item.senderId === me;
          const newer = messages[index - 1]; // inverted: index 0 is the newest
          const older = messages[index + 1];
          const endsGroup = !newer || newer.senderId !== item.senderId || +new Date(newer.createdAt) - +new Date(item.createdAt) > GROUP_MS;
          const startsDay = !older || !sameDay(older.createdAt, item.createdAt);
          const isNewestMine = mine && !messages.slice(0, index).some((x) => x.senderId === me);
          const seen = isNewestMine && !item.state && peerReadAt && +new Date(peerReadAt) >= +new Date(item.createdAt);
          return (
            <View style={{ gap: 4, marginTop: endsGroup ? 8 : 0 }}>
              {startsDay ? <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginVertical: 14 }}>{dayHeading(item.createdAt).toUpperCase()}</Text> : null}
              <Bubble m={item} mine={mine} tail={endsGroup} onOpen={() => open(item)} onRetry={() => { haptics.tap(); retry(item as any); }} />
              {item.state === 'failed' ? (
                <Press haptic="tap" onPress={() => retry(item as any)} accessibilityRole="button" accessibilityLabel="Not sent. Tap to retry" style={{ alignSelf: 'flex-end', marginHorizontal: 6, paddingVertical: 2 }}>
                  <Text variant="caption" tone="danger">Not sent. Tap to retry</Text>
                </Press>
              ) : endsGroup || item.state || seen ? (
                <Text variant="caption" tone="muted" style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginHorizontal: 6 }}>
                  {item.state === 'sending' ? 'Sending' : `${clock(item.createdAt)}${seen ? '  ·  Seen' : ''}`}
                </Text>
              ) : null}
            </View>
          );
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.ink }}>
        {voice.recording ? (
          <RecordingBar ms={voice.ms} onCancel={() => void voice.cancel()} onSend={() => void onVoiceSend()} />
        ) : (
          <>
            <IconButton icon={busyImage ? 'pause' : 'image'} label="Send a photo" tone="ink" onPress={onPhoto} />
            <View style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: radius.pill, backgroundColor: colors.inkRaised, justifyContent: 'center' }}>
              <TextInput value={text} onChangeText={onChangeText} placeholder={voice.denied ? 'Microphone is off. Allow it in Settings' : 'Message'} placeholderTextColor={colors.muted} multiline maxLength={4000} accessibilityLabel="Message"
                style={{ color: colors.textOnInk, fontFamily: 'Inter_400Regular', fontSize: 15, paddingHorizontal: 18, paddingTop: Platform.OS === 'ios' ? 12 : 10, paddingBottom: Platform.OS === 'ios' ? 12 : 10, outlineStyle: 'none' } as any} />
            </View>
            {text.trim() ? <SendButton ready onPress={onSend} /> : <IconButton icon="mic" label="Record a voice note" tone="ink" onPress={() => { haptics.press(); void voice.start(); }} />}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
