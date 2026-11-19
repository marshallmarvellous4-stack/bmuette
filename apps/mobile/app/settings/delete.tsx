import React, { useState } from 'react';
import { View } from 'react-native';
import { Page } from '@/components/Page';
import { Button, Field, Text } from '@/components/ui';
import { ApiError, api } from '@/api/client';
import { confirm } from '@/lib/moderation';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';

export default function DeleteAccount() {
  const logout = useAuth((s) => s.logout);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setError(null);
    try { await api('/me/delete', { method: 'POST', body: { password } }); haptics.success(); await logout(); }
    catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not delete the account.'); }
    finally { setBusy(false); }
  };
  return (
    <Page title="Delete account" subtitle="This cannot be undone.">
      <View style={{ backgroundColor: colors.inkRaised, borderRadius: radius.lg, padding: 18, gap: 10 }}>
        <Text variant="bodyStrong">What happens</Text>
        <Text tone="muted">• Your profile, posts, comments, saves and boards are removed.</Text>
        <Text tone="muted">• Your name and email are erased. Messages you sent show as from a deleted account.</Text>
        <Text tone="muted">• We keep order and payment records for as long as the law requires.</Text>
        <Text tone="muted">• If you sell, fulfil or refund your open orders first.</Text>
      </View>
      <Field label="Enter your password to confirm" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={error} />
      <Button title="Delete my account" tone="ghost" major loading={busy} disabled={!password} onPress={() => confirm('Delete your account?', 'Everything described above will happen now.', 'Delete', () => void run())} style={{ backgroundColor: colors.danger, borderColor: colors.danger }} />
    </Page>
  );
}
