import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press, Text } from './ui';
import type { Post } from '@/api/types';
import { usePlayer } from '@/state/player';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon, type IconName } from '@/theme/icons';
import { colors, TAB_BAR } from '@/theme/tokens';

const MARGIN = 12;

function sizeFor(post: Post) {
  const m = post.media[0];
  const ratio = m?.width && m?.height ? Math.min(1.8, Math.max(0.5, m.width / m.height)) : 9 / 16;
  return ratio >= 1 ? { w: 220, h: Math.round(220 / ratio) } : { w: Math.round(230 * ratio), h: 230 };
}

function Ctl({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Press haptic="none" scaleTo={0.88} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(11,11,13,0.62)', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color="#fff" strokeWidth={2} />
    </Press>
  );
}

function Player({ post, startAt }: { post: Post; startAt: number }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const close = usePlayer((s) => s.close);
  const { w, h } = React.useMemo(() => sizeFor(post), [post]);
  const media = post.media[0];

  const player = useVideoPlayer(media?.url ?? null, (p) => { p.loop = true; p.muted = false; p.timeUpdateEventInterval = 0.25; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  // Pick up exactly where the big player stopped, as soon as the video is ready, then play.
  React.useEffect(() => {
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      if (startAt > 0) player.currentTime = startAt;
      player.play();
    };
    if (player.status === 'readyToPlay') begin();
    const sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') begin(); });
    return () => sub.remove();
  }, [player, startAt]);
  const [muted, setMuted] = React.useState(false);
  const [controls, setControls] = React.useState(true);
  const [progress, setProgress] = React.useState(0);
  React.useEffect(() => { player.muted = muted; }, [muted, player]);

  // Progress bar: look at the clock a few times a second.
  React.useEffect(() => {
    const t = setInterval(() => { const d = player.duration; setProgress(d > 0 ? Math.min(1, player.currentTime / d) : 0); }, 300);
    return () => clearInterval(t);
  }, [player]);
  // Controls fade out by themselves while it plays.
  React.useEffect(() => {
    if (!controls || !isPlaying) return;
    const t = setTimeout(() => setControls(false), 2800);
    return () => clearTimeout(t);
  }, [controls, isPlaying]);

  const minY = insets.top + MARGIN;
  const maxY = winH - h - (TAB_BAR.height + Math.max(insets.bottom, TAB_BAR.bottomGap) + MARGIN * 2);
  const x = useSharedValue(winW - w - MARGIN);
  const y = useSharedValue(Math.max(minY, maxY));
  const pop = useSharedValue(0);
  React.useEffect(() => { pop.value = withSpring(1, { damping: 14, stiffness: 200 }); haptics.press(); }, [pop]);

  const toggle = () => { if (player.playing) player.pause(); else player.play(); haptics.tap(); setControls(true); };
  const expand = () => {
    haptics.press();
    const at = Math.max(0, player.currentTime);
    close();
    router.push({ pathname: '/post/[id]', params: { id: post.id, t: String(Math.round(at * 10) / 10) } });
  };
  const dismiss = () => { haptics.tap(); pop.value = withTiming(0, { duration: 140 }, (done) => { if (done) runOnJS(close)(); }); };

  const pan = Gesture.Pan().minDistance(6)
    .onChange((e) => { x.value += e.changeX; y.value += e.changeY; })
    .onEnd((e) => {
      // Throw it and it settles on whichever side it was heading for.
      const toRight = x.value + w / 2 + e.velocityX * 0.12 > winW / 2;
      x.value = withSpring(toRight ? winW - w - MARGIN : MARGIN, { damping: 20, stiffness: 220, velocity: e.velocityX });
      y.value = withSpring(Math.min(Math.max(y.value + e.velocityY * 0.1, minY), Math.max(minY, maxY)), { damping: 20, stiffness: 220, velocity: e.velocityY });
      runOnJS(haptics.select)();
    });
  // First tap wakes the controls, the next one plays or pauses.
  const controlsRef = React.useRef(controls);
  controlsRef.current = controls;
  const tapRef = React.useRef(() => {});
  tapRef.current = () => { if (!controlsRef.current) setControls(true); else toggle(); };
  const fireTap = React.useCallback(() => tapRef.current(), []);
  const tap = Gesture.Tap().onEnd((_e, ok) => { if (ok) runOnJS(fireTap)(); });
  const gesture = Gesture.Race(pan, tap);

  const box = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: 0.7 + 0.3 * pop.value }], opacity: pop.value }));

  return (
    <Animated.View accessibilityLabel={`Playing ${post.author.displayName}'s video`} style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 24 }, box]}>
      <GestureDetector gesture={gesture}>
        <View style={{ width: w, height: h }}>
          <VideoView player={player} style={{ width: w, height: h }} contentFit="cover" nativeControls={false} />
          {media?.thumbUrl && !isPlaying && progress === 0 ? <Image source={{ uri: media.thumbUrl }} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} contentFit="cover" /> : null}
        </View>
      </GestureDetector>
      {controls ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, padding: 8, justifyContent: 'space-between' }}>
          <View pointerEvents="box-none" style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Ctl icon="expand" label="Open full screen" onPress={expand} />
            <Ctl icon="close" label="Close player" onPress={dismiss} />
          </View>
          <View pointerEvents="none" style={{ alignItems: 'center' }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(11,11,13,0.55)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={isPlaying ? 'pause' : 'play'} size={22} color="#fff" active strokeWidth={2.4} />
            </View>
          </View>
          <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <Text variant="caption" numberOfLines={1} style={{ color: '#fff', maxWidth: w - 60 }}>@{post.author.username}</Text>
            <Ctl icon={muted ? 'volumeOff' : 'volumeOn'} label={muted ? 'Unmute' : 'Mute'} onPress={() => { haptics.tap(); setMuted((m) => !m); }} />
          </View>
        </View>
      ) : null}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.22)' }}>
        <View style={{ height: 3, width: `${Math.round(progress * 100)}%`, backgroundColor: colors.card }} />
      </View>
    </Animated.View>
  );
}

// Mounted once at the root. Renders nothing until a video is minimised.
export function MiniPlayer() {
  const mini = usePlayer((s) => s.mini);
  const status = useAuth((s) => s.status);
  const close = usePlayer((s) => s.close);
  React.useEffect(() => { if (status !== 'signedIn') close(); }, [status, close]);
  if (!mini || status !== 'signedIn') return null;
  // A different video gets a fresh player (and a fresh pop-in).
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}><Player key={mini.post.id} post={mini.post} startAt={mini.startAt} /></View>;
}
