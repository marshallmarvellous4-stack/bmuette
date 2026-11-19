import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthScreen } from '@/components/AuthForm';
import { Button, Field, Text, Press } from '@/components/ui';
import { ApiError } from '@/api/client';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';

export default function Login() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!email.includes('@') || !password) { haptics.warning(); return setError('Enter your email and password.'); }
    setBusy(true);
    try { await login(email, password); haptics.success(); } catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not sign in.'); } finally { setBusy(false); }
  }
  return (
    <AuthScreen title="Welcome back" subtitle="Sign in to pick up where you left off.">
      <View style={{ gap: 16 }}>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Your password" error={error} />
      </View>
      <Press haptic="tap" onPress={() => router.push('/forgot')} accessibilityRole="link" style={{ alignSelf: 'flex-end', paddingVertical: 4 }}>
        <Text variant="small" tone="muted">Forgot password?</Text>
      </Press>
      <Press haptic="tap" onPress={() => router.push('/forgot')} accessibilityRole="link" style={{ alignSelf: 'flex-end', paddingVertical: 4 }}>
        <Text variant="small" tone="muted">Forgot password?</Text>
      </Press>
      <Button title="Sign in" major loading={busy} onPress={submit} />
      <Press haptic="tap" onPress={() => router.replace('/register')} style={{ alignItems: 'center', padding: 8 }}>
        <Text tone="muted">New here? <Text tone="ink" variant="bodyStrong">Create an account</Text></Text>
      </Press>
    </AuthScreen>
  );
}
