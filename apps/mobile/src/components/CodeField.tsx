import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Text } from './ui';
import { ApiError } from '@/api/client';
import { quote, type Line, type Quote } from '@/api/shop';
import { haptics } from '@/theme/haptics';

/** A discount code box that previews the new total from the server before you pay. */
export function CodeField({ lines, onQuote }: { lines: Line[]; onQuote: (code: string | undefined, q: Quote | null) => void }) {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply() {
    const c = code.trim();
    if (!c) return;
    setBusy(true); setErr(null);
    try { const q = await quote(lines, c); setApplied(q.code ?? c); onQuote(c, q); haptics.success(); }
    catch (e) { haptics.error(); setErr(e instanceof ApiError ? e.message : 'Could not check that code.'); onQuote(undefined, null); setApplied(null); }
    finally { setBusy(false); }
  }
  if (applied) return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text>Code <Text variant="bodyStrong">{applied}</Text> applied</Text>
      <View style={{ width: 110 }}><Button title="Remove" tone="ghost" onPress={() => { setApplied(null); setCode(''); onQuote(undefined, null); }} /></View>
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><Field label="Discount code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} error={err} /></View>
        <View style={{ width: 100, marginBottom: err ? 22 : 0 }}><Button title="Apply" tone="ghost" loading={busy} onPress={apply} /></View>
      </View>
    </View>
  );
}
