import React from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from 'expo-audio';
import { Press, Text } from './ui';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors } from '@/theme/tokens';

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// A fixed-looking pattern of bars per message (taken from its id), so every voice note has its own shape.
const bars = (seed: string, n = 26) => {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => { h = (h * 1664525 + 1013904223) >>> 0; return 0.25 + ((h >>> 8) % 100) / 100 * 0.75; });
};

function Playing({ uri, fallbackMs, seed, mine }: { uri: string; fallbackMs: number; seed: string; mine: boolean }) {
  const player = useAudioPlayer({ uri });
  const st = useAudioPlayerStatus(player);
  const total = st.duration && st.duration > 0 ? st.duration * 1000 : fallbackMs;
  const pct = Math.min(1, total ? (st.currentTime * 1000) / total : 0);
  const done = st.didJustFinish;
  React.useEffect(() => { if (done) { void player.seekTo(0); } }, [done, player]);
  React.useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); player.play(); }, [player]);
  const toggle = () => { haptics.tap(); if (st.playing) player.pause(); else player.play(); };
  return <Body playing={st.playing} onToggle={toggle} pct={pct} seed={seed} label={fmtDuration(st.playing ? st.currentTime * 1000 : total)} mine={mine} />;
}

function Body({ playing, onToggle, pct, seed, label, mine }: { playing: boolean; onToggle: () => void; pct: number; seed: string; label: string; mine: boolean }) {
  const on = mine ? colors.textOnCard : colors.textOnInk;
  const off = mine ? 'rgba(11,11,13,0.28)' : 'rgba(255,255,255,0.3)';
  const b = React.useMemo(() => bars(seed), [seed]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: 220, paddingVertical: 2 }}>
      <Press haptic="none" scaleTo={0.9} onPress={onToggle} accessibilityRole="button" accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: mine ? colors.ink : colors.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={playing ? 'pause' : 'play'} size={16} color={mine ? '#fff' : colors.ink} active />
      </Press>
      <View style={{ flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {b.map((h, i) => <View key={i} style={{ flex: 1, height: 4 + h * 22, borderRadius: 2, backgroundColor: i / b.length < pct ? on : off }} />)}
      </View>
      <Text variant="caption" tone={mine ? 'card' : 'ink'} style={{ minWidth: 34, textAlign: 'right' }}>{label}</Text>
    </View>
  );
}

/** A voice note in a chat bubble. The audio player is only created after the first tap, so long threads stay light. */
export function VoiceBubble({ uri, durationMs, seed, mine }: { uri: string; durationMs: number; seed: string; mine: boolean }) {
  const [started, setStarted] = React.useState(false);
  if (started) return <Playing uri={uri} fallbackMs={durationMs} seed={seed} mine={mine} />;
  return <Body playing={false} onToggle={() => { haptics.tap(); setStarted(true); }} pct={0} seed={seed} label={fmtDuration(durationMs)} mine={mine} />;
}

// ---------------- recording ----------------
export const MAX_VOICE_MS = 5 * 60_000;

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = React.useState(false);
  const [ms, setMs] = React.useState(0);
  const startedAt = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [denied, setDenied] = React.useState(false);

  const clear = () => { clearInterval(timer.current); timer.current = undefined; };
  React.useEffect(() => clear, []);

  const start = async (): Promise<boolean> => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { setDenied(true); haptics.error(); return false; }
      setDenied(false);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setMs(0);
      setRecording(true);
      timer.current = setInterval(() => setMs(Date.now() - startedAt.current), 200);
      return true;
    } catch { haptics.error(); return false; }
  };

  /** Stop and return the file, or null if it was too short or failed. */
  const finish = async (): Promise<{ uri: string; durationMs: number; mimeType: string } | null> => {
    clear();
    const length = Date.now() - startedAt.current;
    setRecording(false);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (!recorder.uri || length < 800) return null;
      return { uri: recorder.uri, durationMs: Math.min(length, MAX_VOICE_MS), mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4' };
    } catch { return null; }
  };
  const cancel = async () => { await finish(); };
  return { recording, ms, denied, start, finish, cancel };
}

export function RecordingBar({ ms, onCancel, onSend }: { ms: number; onCancel: () => void; onSend: () => void }) {
  const pulse = useSharedValue(1);
  React.useEffect(() => { pulse.value = withRepeat(withSequence(withTiming(0.25, { duration: 600 }), withDelay(100, withTiming(1, { duration: 600 }))), -1); }, [pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Press haptic="tap" scaleTo={0.9} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Discard recording" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inkRaised, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="trash" size={20} color="#fff" />
      </Press>
      <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 }}>
        <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }, dot]} />
        <Text variant="bodyStrong">{fmtDuration(ms)}</Text>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>Recording…</Text>
      </View>
      <Press haptic="none" scaleTo={0.88} onPress={onSend} accessibilityRole="button" accessibilityLabel="Send voice note" style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="send" size={20} color={colors.ink} active />
      </Press>
    </View>
  );
}

export function TypingDots() {
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: 5, backgroundColor: colors.inkRaised, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 16, paddingVertical: 14, marginTop: 8 }} accessibilityLabel="Typing">
      {[0, 1, 2].map((i) => <Dot key={i} i={i} />)}
    </View>
  );
}
function Dot({ i }: { i: number }) {
  const v = useSharedValue(0.3);
  React.useEffect(() => { v.value = withDelay(i * 160, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1)); }, [i, v]);
  const s = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: -3 * (v.value - 0.3) }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' }, s]} />;
}
