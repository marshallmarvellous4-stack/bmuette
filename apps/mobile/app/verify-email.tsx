import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, IconButton, Press, Text } from '@/components/ui';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { colors } from '@/theme/tokens';

export default function VerifyEmail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cool, setCool] = useState(0);
  const [sentOnce, setSentOnce] = useState(false);

  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool((c) => c - 1), 1000); return () => clearTimeout(t); }, [cool]);

  async function send() {
    setError(null); setInfo(null);
    try {
      const r = await api<{ sent: boolean; alreadyVerified: boolean }>('/auth/verify-email/send', { method: 'POST' });
      if (r.alreadyVerified) { await refreshMe(); return router.back(); }
      setSentOnce(true); setCool(60); setInfo(`We emailed a 6 digit code to ${user?.email}. It works for 15 minutes.`); haptics.success();
    } catch (e) {
      // A code was sent when you signed up, and the server allows one a minute. That is not a problem.
      if (e instanceof ApiError && e.status === 429) { setCool(60); setSentOnce(true); setInfo(`A code was just sent to ${user?.email}. Check your inbox, or wait a minute to send another.`); }
      else { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not send the code.'); }
    }
  }
  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code)) { haptics.warning(); return setError('The code is 6 digits.'); }
    setBusy(true);
    try { await api('/auth/verify-email', { method: 'POST', body: { code } }); haptics.success(); await refreshMe(); router.back(); }
    catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not verify.'); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, gap: 22 }}>
        <View style={{ alignSelf: 'flex-start' }}><IconButton icon="close" tone="ink" label="Close" onPress={() => router.back()} /></View>
        <View style={{ gap: 8 }}>
          <Text variant="title">Verify your email</Text>
          <Text tone="muted">You need a verified email to open a shop or check out. It also lets you get back in if you forget your password.</Text>
        </View>
        {info ? <Text variant="small" tone="muted">{info}</Text> : null}
        <Field label="6 digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" maxLength={6} error={error} />
        <Button title="Verify" major loading={busy} onPress={verify} />
        <Press haptic="tap" disabled={cool > 0} onPress={send} style={{ alignItems: 'center', padding: 8, opacity: cool > 0 ? 0.5 : 1 }}>
          <Text tone="muted">{sentOnce ? 'Did not get it? ' : 'Send me a code. '}<Text tone="ink" variant="bodyStrong">{cool > 0 ? `Send again in ${cool}s` : sentOnce ? 'Send again' : 'Send code'}</Text></Text>
        </Press>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
