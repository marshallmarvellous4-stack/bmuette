import React, { useRef, useState } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { colors } from '@/theme/tokens';

// A small touch slider that works the same on phones and the web. Drag, or use the accessibility increment actions.
export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, tone = 'ink' }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; label: string; tone?: 'ink' | 'card' }) {
  const [w, setW] = useState(1);
  const dragging = useRef(false);
  const pct = max === min ? 0 : (value - min) / (max - min);
  const set = (x: number) => {
    const raw = min + Math.min(1, Math.max(0, x / w)) * (max - min);
    onChange(Math.min(max, Math.max(min, Math.round(raw / step) * step)));
  };
  const on = tone === 'ink' ? '#fff' : colors.textOnCard;
  const off = tone === 'ink' ? 'rgba(255,255,255,0.18)' : 'rgba(17,18,20,0.15)';
  return (
    <View
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step))))}
      onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={(e: GestureResponderEvent) => { dragging.current = true; set(e.nativeEvent.locationX); }}
      onResponderMove={(e: GestureResponderEvent) => { if (dragging.current) set(e.nativeEvent.locationX); }}
      onResponderRelease={() => { dragging.current = false; }} onResponderTerminate={() => { dragging.current = false; }}
      style={{ height: 36, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: off }}>
        <View style={{ width: `${pct * 100}%`, height: 4, borderRadius: 2, backgroundColor: on }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${pct * 100}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: on, borderWidth: 3, borderColor: tone === 'ink' ? colors.ink : '#fff' }} />
    </View>
  );
}
