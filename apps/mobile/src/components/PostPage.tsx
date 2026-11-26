import React, { useEffect, useRef } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { EditLayer } from './EditLayer';
import { TaggedSheet } from './TaggedSheet';
import { Avatar, IconButton, Press, Text } from './ui';
import { downloadLink, recordView, useFollow, useLike } from '@/api/hooks';
import { useBlock, useDeletePost } from '@/api/safety';
import { confirm, openSafetyMenu } from '@/lib/moderation';
import { useAuth } from '@/state/auth';
import { useMenu } from '@/state/menu';
import { useSaveSheet } from '@/state/saveSheet';
import type { Cta, Post } from '@/api/types';
import { compact } from '@/lib/money';
import { usePlayer } from '@/state/player';
import { useGiftUi } from '@/state/gifts';
import { GOLD } from './gifts/giftMeta';
import { Icon } from '@/theme/icons';
import { haptics } from '@/theme/haptics';
import { colors, TAB_BAR } from '@/theme/tokens';

const CTA_LABEL: Record<Cta['kind'], string> = { buy: 'Buy now', book: 'Book now', enroll: 'Enrol', join_event: 'Get tickets', order_food: 'Order now', expert: 'Talk to an expert' };

function Rail({ icon, label, active, onPress, activeColor }: { icon: 'heart' | 'comment' | 'download' | 'share' | 'bookmark' | 'gift'; label?: string; active?: boolean; onPress: () => void; activeColor?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <Press haptic="none" scaleTo={0.82} onPress={onPress} accessibilityRole="button" accessibilityLabel={icon} style={styles.railBtn}>
        <Icon name={icon} size={26} color={active ? activeColor ?? '#fff' : '#fff'} active={active} />
      </Press>
      {label !== undefined ? <Text variant="caption" style={{ color: '#fff' }}>{label}</Text> : null}
    </View>
  );
}

export function PostPage({ post, active, height, bottomInset, topInset, startAt = 0, standalone = false }: { post: Post; active: boolean; height: number; bottomInset: number; topInset: number; startAt?: number; standalone?: boolean }) {
  const router = useRouter();
  const meId = useAuth((x) => x.user?.id);
  const like = useLike();
  const follow = useFollow();
  const me = useAuth((s) => s.user?.id);
  const block = useBlock();
  const del = useDeletePost();
  const media = post.media[0];
  const isVideo = post.kind === 'video' && !!media?.url;
  const [muted, setMuted] = React.useState(true);
  const [paused, setPaused] = React.useState(false);
  const [shopOpen, setShopOpen] = React.useState(false);
  const [pin, setPin] = React.useState<string | null>(null);

  // ---- video ----
  // While a video floats in the corner, this page stays quiet so two soundtracks never play at once.
  const miniPostId = usePlayer((s) => s.mini?.post.id ?? null);
  const miniActive = miniPostId !== null;
  const miniIsThis = miniPostId === post.id;
  // Edits are stored with the post (the file is never changed): trim, sound and volumes are applied here while it plays.
  const trimStart = (post.edit?.trimStartMs ?? 0) / 1000;
  const trimEnd = post.edit?.trimEndMs ? post.edit.trimEndMs / 1000 : null;
  const player = useVideoPlayer(isVideo ? media!.url! : null, (p) => {
    p.loop = true; p.muted = true; p.volume = post.originalVolume / 100;
    if (trimStart > 0 || trimEnd) p.timeUpdateEventInterval = 0.2;
    const from = Math.max(startAt, trimStart);
    if (from > 0) p.currentTime = from;
  });
  const music = useAudioPlayer(post.sound ? { uri: post.sound.url } : undefined);
  const hasSound = !!post.sound;
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); music.loop = true; music.volume = post.soundVolume / 100; }, [music, post.soundVolume]);
  useEffect(() => {
    if (!isVideo || (!trimStart && !trimEnd)) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if ((trimEnd && currentTime >= trimEnd) || currentTime < trimStart - 0.3) { player.currentTime = trimStart; if (hasSound) void music.seekTo(0); }
    });
    return () => sub.remove();
  }, [isVideo, player, music, trimStart, trimEnd, hasSound]);
  // A product pinned to a moment in the video shows a small tag while that moment plays.
  const tagged = post.products ?? [];
  const timed = tagged.some((t) => t.atMs !== null);
  useEffect(() => {
    if (!isVideo || !active || !timed) return;
    const id = setInterval(() => {
      const ms = player.currentTime * 1000;
      setPin(tagged.find((t) => t.atMs !== null && ms >= t.atMs && ms < t.atMs + 4000)?.id ?? null);
    }, 400);
    return () => clearInterval(id);
  }, [isVideo, active, timed, player]); // eslint-disable-line react-hooks/exhaustive-deps
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useEffect(() => { player.muted = muted || miniActive; music.muted = muted || miniActive; }, [muted, miniActive, player, music]);
  useEffect(() => {
    if (!hasSound) return;
    if (active && !paused && !miniIsThis) music.play(); else music.pause();
  }, [active, paused, miniIsThis, hasSound, music]);
  useEffect(() => {
    if (!isVideo) return;
    if (active && !paused && !miniIsThis) player.play(); else player.pause();
  }, [active, paused, miniIsThis, isVideo, player]);

  // How long this post was actually watched, sent when you swipe away. Seeing is not the same as watching.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (active) { startedAt.current = Date.now(); setPaused(false); return; }
    if (startedAt.current) {
      const ms = Date.now() - startedAt.current;
      startedAt.current = null;
      const dur = media?.durationMs ?? 0;
      if (ms > 500) recordView(post.id, ms, dur ? ms / dur : post.kind === 'photo' ? Math.min(1, ms / 4000) : 0);
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- like with a heart burst ----
  const burst = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value, transform: [{ scale: 0.6 + burst.value * 0.7 }] }));
  const doLike = (fromDouble: boolean) => {
    const next = fromDouble ? true : !post.viewer.liked;
    if (fromDouble) burst.value = withSequence(withSpring(1, { damping: 8, stiffness: 260 }), withDelay(350, withTiming(0, { duration: 220 })));
    if (next === post.viewer.liked) return;
    if (next) haptics.like(); else haptics.tap();
    like.mutate({ post, like: next });
  };
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((_e, ok) => { if (ok) runOnJS(doLike)(true); });
  const singleTap = Gesture.Tap().onEnd((_e, ok) => { if (ok) runOnJS(setPaused)((p) => !p); });
  const taps = Gesture.Exclusive(doubleTap, singleTap);

  const cta = post.cta;
  const onCta = () => {
    if (cta?.productId) router.push(`/product/${cta.productId}`);
    else if (cta?.kind === 'expert') router.push(`/profile/${post.author.username}`);
  };
  const onMinimise = () => {
    // Hand the video to the floating player at the same moment, so it carries on where you were.
    usePlayer.getState().open(post, player.currentTime);
    if (standalone) { if (router.canGoBack()) router.back(); else router.replace('/'); }
  };
  const onMore = () => {
    if (post.author.id === me) {
      useMenu.getState().show({ actions: [{ label: 'Delete post', icon: 'trash', danger: true, onPress: () => confirm('Delete this post?', 'It will be removed for everyone.', 'Delete', () => del.mutate(post.id, { onSuccess: () => { if (standalone) router.back(); } })) }] });
    } else {
      openSafetyMenu({ target: { type: 'post', id: post.id, label: post.caption }, username: post.author.username, onBlock: (b) => block.mutate({ username: post.author.username, block: b }) });
    }
  };
  const onDownload = async () => {
    try { const { url } = await downloadLink(post.id); haptics.success(); if (url) await Linking.openURL(url); } catch { haptics.error(); }
  };

  return (
    <View style={{ height, backgroundColor: colors.ink }}>
      <GestureDetector gesture={taps}>
        <View style={StyleSheet.absoluteFill}>
          <EditLayer edit={post.edit}>
            {isVideo ? (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
            ) : media?.url ? (
              <Image source={{ uri: media.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : null}
            {isVideo && media?.thumbUrl && !isPlaying ? <Image source={{ uri: media.thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          </EditLayer>
          <Animated.View pointerEvents="none" style={[styles.burst, burstStyle]}>
            <Icon name="heart" size={110} color="#fff" active />
          </Animated.View>
          {paused && isVideo ? (
            <View pointerEvents="none" style={styles.pauseBadge}><Icon name="play" size={34} color="#fff" active /></View>
          ) : null}
        </View>
      </GestureDetector>

      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: topInset + 120 }} />
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.78)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.5 }} />

      {/* right rail, as in the sketch: creator, like, comment, download */}
      <View style={[styles.rail, { bottom: bottomInset + 12 }]}>
        <View style={{ alignItems: 'center', marginBottom: 6 }}>
          <Press haptic="tap" onPress={() => router.push(`/profile/${post.author.username}`)} accessibilityLabel={`Open ${post.author.displayName}`}>
            <Avatar name={post.author.displayName} uri={post.author.avatarUrl} size={48} ring />
          </Press>
          {!post.viewer.following ? (
            <Press haptic="press" scaleTo={0.8} onPress={() => follow.mutate({ username: post.author.username, follow: true, authorId: post.author.id })} accessibilityLabel={`Follow ${post.author.displayName}`} style={styles.followBadge}>
              <Icon name="plus" size={14} color={colors.ink} strokeWidth={3} />
            </Press>
          ) : null}
        </View>
        <Rail icon="heart" label={compact(post.counts.likes)} active={post.viewer.liked} activeColor="#FF4D6A" onPress={() => doLike(false)} />
        <Rail icon="comment" label={compact(post.counts.comments)} onPress={() => { haptics.tap(); router.push({ pathname: '/comments/[id]', params: { id: post.id, u: post.author.username, n: post.author.displayName } }); }} />
        {post.author.id !== meId ? <Rail icon="gift" label={(post.counts.giftCoins ?? 0) > 0 ? compact(post.counts.giftCoins ?? 0) : 'Gift'} activeColor={GOLD.mid} active={(post.counts.giftCoins ?? 0) > 0} onPress={() => { haptics.tap(); useGiftUi.getState().openTray({ postId: post.id, creator: { username: post.author.username, displayName: post.author.displayName } }); }} /> : null}
        <Rail icon="bookmark" label={compact(post.counts.saves)} active={post.viewer.saved} activeColor="#FFD166" onPress={() => { haptics.tap(); useSaveSheet.getState().open({ type: 'post', id: post.id, saved: post.viewer.saved }); }} />
        {post.allowDownload ? <Rail icon="download" label="Save" onPress={onDownload} /> : null}
        <Rail icon="share" label="Send" onPress={() => { haptics.tap(); router.push(`/send/post/${post.id}`); }} />
        <IconButton icon="more" label="More options" size={40} onPress={onMore} haptic="tap" />
        {isVideo ? <IconButton icon="minimize" label="Minimise to a floating player" size={40} onPress={onMinimise} haptic="none" /> : null}
        {isVideo || hasSound ? <IconButton icon={muted ? 'volumeOff' : 'volumeOn'} label={muted ? 'Unmute' : 'Mute'} size={40} onPress={() => setMuted((m) => !m)} haptic="tap" /> : null}
      </View>

      {/* bottom-left: who, what, and the action */}
      <View style={[styles.info, { bottom: bottomInset + 6 }]} pointerEvents="box-none">
        <Text variant="bodyStrong" style={{ color: '#fff', fontSize: 16 }}>@{post.author.username}</Text>
        {post.caption ? <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.92)' }}>{post.caption}</Text> : null}
        {post.tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {post.tags.slice(0, 4).map((t) => (
              <Press key={t} haptic="tap" scaleTo={0.95} onPress={() => router.push(`/tag/${encodeURIComponent(t)}`)} accessibilityRole="link" accessibilityLabel={`Hashtag ${t}`}>
                <Text variant="small" style={{ color: 'rgba(255,255,255,0.85)' }}>#{t}</Text>
              </Press>
            ))}
          </View>
        ) : null}
        {post.sound ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`Sound: ${post.sound.title} by ${post.sound.artist}`}>
            <Icon name="music" size={14} color="rgba(255,255,255,0.85)" /><Text variant="small" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', flexShrink: 1 }}>{post.sound.title} · {post.sound.artist}</Text>
          </View>
        ) : null}
        {tagged.length ? (
          <Press haptic="major" onPress={() => setShopOpen(true)} accessibilityRole="button" accessibilityLabel={`Shop ${tagged.length} item${tagged.length > 1 ? 's' : ''} in this ${post.kind}`} style={[styles.cta, pin ? { backgroundColor: '#FFD166' } : null]}>
            <Icon name="bag" size={18} color={colors.ink} active />
            <Text variant="bodyStrong" tone="card">{pin ? tagged.find((t) => t.id === pin)?.title.slice(0, 24) ?? 'Shop' : `Shop ${tagged.length > 1 ? `${tagged.length} items` : 'this item'}`}</Text>
          </Press>
        ) : null}
        {cta && !(tagged.length && cta.productId && tagged.some((t) => t.id === cta.productId)) ? (
          <Press haptic="major" onPress={onCta} accessibilityRole="button" accessibilityLabel={cta.label || CTA_LABEL[cta.kind]} style={styles.cta}>
            <Icon name={cta.kind === 'buy' ? 'bag' : 'play'} size={18} color={colors.ink} active />
            <Text variant="bodyStrong" tone="card">{cta.label || CTA_LABEL[cta.kind]}</Text>
          </Press>
        ) : null}
      </View>
      {tagged.length ? <TaggedSheet visible={shopOpen} onClose={() => setShopOpen(false)} products={tagged} highlight={pin} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: 12, alignItems: 'center', gap: 16 },
  railBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  followBadge: { position: 'absolute', bottom: -9, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  info: { position: 'absolute', left: 16, right: 84, gap: 8 },
  cta: { alignSelf: 'flex-start', height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  burst: { position: 'absolute', alignSelf: 'center', top: '40%' },
  pauseBadge: { position: 'absolute', alignSelf: 'center', top: '44%', opacity: 0.85 },
});
void TAB_BAR;
