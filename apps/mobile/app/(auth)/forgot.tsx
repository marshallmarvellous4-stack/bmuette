import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthScreen } from '@/components/AuthForm';
import { Button, Field, Press, Text } from '@/components/ui';
import { ApiError, api } from '@/api/client';
import { haptics } from '@/theme/haptics';

// Two steps on one screen: ask for a code by email, then type the code with a new password.
export default function Forgot() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function sendCode() {
    setError(null);
    if (!email.includes('@')) { haptics.warning(); return setError('Enter the email you signed up with.'); }
    setBusy(true);
    try { await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, auth: false }); haptics.success(); setStep('code'); setInfo(`If ${email.trim()} has an account, we have sent a 6 digit code. It works for 15 minutes.`); }
    catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not send the code.'); }
    finally { setBusy(false); }
  }
  async function reset() {
    setError(null);
    if (!/^\d{6}$/.test(code)) { haptics.warning(); return setError('The code is 6 digits.'); }
    if (password.length < 8) { haptics.warning(); return setError('Use at least 8 characters for the new password.'); }
    setBusy(true);
    try { await api('/auth/reset-password', { method: 'POST', body: { email: email.trim(), code, password }, auth: false }); haptics.success(); setDone(true); }
    catch (e) { haptics.error(); setError(e instanceof ApiError ? e.message : 'Could not reset the password.'); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <AuthScreen title="Password changed" subtitle="You can sign in with your new password. Any other phones that were signed in have been signed out.">
        <Button title="Sign in" major onPress={() => router.replace('/login')} />
      </AuthScreen>
    );
  }
  return (
    <AuthScreen title="Reset your password" subtitle={step === 'email' ? 'We will email you a 6 digit code.' : 'Enter the code from your email and choose a new password.'}>
      <View style={{ gap: 16 }}>
        <Field label="Email" value={email} onChangeText={setEmail} editable={step === 'email'} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
        {step === 'code' ? (
          <>
            {info ? <Text variant="small" tone="muted">{info}</Text> : null}
            <Field label="6 digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="123456" maxLength={6} />
            <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" />
          </>
        ) : null}
        {error ? <Text variant="small" tone="danger">{error}</Text> : null}
      </View>
      <Button title={step === 'email' ? 'Send code' : 'Change password'} major loading={busy} onPress={step === 'email' ? sendCode : reset} />
      {step === 'code' ? (
        <Press haptic="tap" onPress={() => { setStep('email'); setCode(''); setError(null); }} style={{ alignItems: 'center', padding: 8 }}>
          <Text tone="muted">Did not get it? <Text tone="ink" variant="bodyStrong">Send a new code</Text></Text>
        </Press>
      ) : null}
    </AuthScreen>
  );
}
