import React, { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './ui';
import { filterOf } from '@/lib/edit';
import type { PostEdit } from '@/api/types';

// Draws the filter and the text overlays on top of whatever media is passed in. Used by the post player and by the editor preview.
export function EditLayer({ edit, children, style }: { edit: PostEdit | null | undefined; children: React.ReactNode; style?: ViewStyle }) {
  const [w, setW] = useState(360);
  const f = filterOf(edit?.filter);
  const scale = w / 360;
  return (
    <View style={[StyleSheet.absoluteFill, style]} onLayout={(e) => setW(e.nativeEvent.layout.width || 360)}>
      <View style={[StyleSheet.absoluteFill, f.fn.length ? ({ filter: f.fn } as unknown as ViewStyle) : null]}>{children}</View>
      {f.tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: f.tint.color, opacity: f.tint.opacity }]} /> : null}
      {(edit?.texts ?? []).map((t, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', left: `${t.x * 100}%`, top: `${t.y * 100}%`, maxWidth: `${(1 - t.x) * 100}%` }}>
          <Text accessibilityLabel={t.text} style={{ color: t.color, fontSize: t.size * scale, lineHeight: t.size * scale * 1.2, fontFamily: 'Inter_800ExtraBold', textShadowColor: t.color === '#111214' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}
