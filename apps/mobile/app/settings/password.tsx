import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Button, Field, Text } from '@/components/ui';
import { ApiError, api, saveTokens } from '@/api/client';
import { haptics } from '@/theme/haptics';

export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (next.length < 8) { haptics.warning(); return setError('Use at least 8 characters for the new password.'); }
    if (next !== again) { haptics.warning(); return setError('The two new passwords are not the same.'); }
    setBusy(true);
    try {
      const t = await api<{ accessToken: string; refreshToken: string }>('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      await saveTokens({ access: t.accessToken, refresh: t.refreshToken }); // this phone stays signed in; the others are signed out
      haptics.success(); setDone(true);
    } catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not change the password.'); }
    finally { setBusy(false); }
  }
  return (
    <Page title="Change password" subtitle="Your other devices will be signed out.">
      {done ? (
        <>
          <Text>Your password has been changed.</Text>
          <Button title="Done" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="password" />
          <Field label="New password" value={next} onChangeText={setNext} secureTextEntry placeholder="At least 8 characters" />
          <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry error={error} />
          <Button title="Change password" major loading={busy} onPress={save} />
        </>
      )}
    </Page>
  );
}
