import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { create } from 'zustand';

// Haptics are on by default. Every action has its own weight, and the rules below stop them piling up:
// a minimum gap between two buzzes, and nothing at all on platforms without a motor.
//
//   select   a gentle tick: scrolling a picker, snapping to the next video
//   tap      light: small buttons, chips, toggles
//   press    medium: normal actions (follow, save, add to bag)
//   tab      medium and a little firmer than tap: changing tab
//   major    heavy: the main action of a screen (Buy, Post, Pay)
//   like     a quick two-beat "heartbeat"
//   send     one crisp rigid click: sending a message
//   record   heavy press-in when a voice note starts, soft release when it ends
//   success / warning / error   system patterns

type Settings = { enabled: boolean; setEnabled: (v: boolean) => void };
export const useHapticSettings = create<Settings>((set) => ({ enabled: true, setEnabled: (enabled) => set({ enabled }) }));

const supported = Platform.OS === 'ios' || Platform.OS === 'android';
let last = 0;

function fire(run: () => Promise<void>, minGapMs = 35) {
  if (!supported || !useHapticSettings.getState().enabled) return;
  const now = Date.now();
  if (now - last < minGapMs) return;
  last = now;
  run().catch(() => {});
}

const impact = (s: Haptics.ImpactFeedbackStyle) => () => Haptics.impactAsync(s);
const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

export const haptics = {
  select: () => fire(() => Haptics.selectionAsync(), 60),
  tap: () => fire(impact(Haptics.ImpactFeedbackStyle.Light)),
  press: () => fire(impact(Haptics.ImpactFeedbackStyle.Medium)),
  tab: () => fire(impact(Haptics.ImpactFeedbackStyle.Medium)),
  major: () => fire(impact(Haptics.ImpactFeedbackStyle.Heavy)),
  like: () => {
    fire(impact(Haptics.ImpactFeedbackStyle.Light));
    later(85, () => fire(impact(Haptics.ImpactFeedbackStyle.Medium), 0));
  },
  send: () => fire(impact(Haptics.ImpactFeedbackStyle.Rigid)),
  recordStart: () => fire(impact(Haptics.ImpactFeedbackStyle.Heavy)),
  recordEnd: () => fire(impact(Haptics.ImpactFeedbackStyle.Soft)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 120),
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), 120),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error), 120),
};

export type HapticKind = 'none' | 'select' | 'tap' | 'press' | 'tab' | 'major';
export const triggerHaptic = (kind: HapticKind) => {
  if (kind !== 'none') haptics[kind]();
};
