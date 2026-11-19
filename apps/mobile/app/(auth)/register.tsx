import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthScreen } from '@/components/AuthForm';
import { Button, Field, Text, Press } from '@/components/ui';
import { ApiError } from '@/api/client';
import { openLegal } from '@/lib/legal';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, fonts, radius } from '@/theme/tokens';

const MIN_AGE = 13;
type InputRef = React.RefObject<React.ComponentRef<typeof TextInput> | null>;

function DateBox({ label, value, onChange, width, max, placeholder, error, next, innerRef }: { label: string; value: string; onChange: (v: string) => void; width: number | string; max: number; placeholder: string; error?: boolean; next?: InputRef; innerRef?: InputRef }) {
  return (
    <View style={{ gap: 8, width: width as number }}>
      <Text variant="small" tone="muted">{label}</Text>
      <TextInput
        ref={innerRef}
        value={value}
        onChangeText={(t) => { const v = t.replace(/\D/g, '').slice(0, max); onChange(v); if (v.length === max) next?.current?.focus(); }}
        keyboardType="number-pad" keyboardAppearance="dark" placeholder={placeholder} placeholderTextColor="#5E6068" maxLength={max}
        accessibilityLabel={label}
        style={{ height: 54, borderRadius: radius.md, textAlign: 'center', color: colors.textOnInk, fontFamily: fonts.medium, fontSize: 16, backgroundColor: colors.inkRaised, borderWidth: 1.5, borderColor: error ? colors.danger : colors.line }}
      />
    </View>
  );
}

/** Whole years between a date and today. The birth date is checked here and on the server, and never stored. */
function ageOf(y: number, m: number, d: number) {
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}

export default function Register() {
  const router = useRouter();
  const register = useAuth((s) => s.register);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dd, setDd] = useState(''); const [mm, setMm] = useState(''); const [yyyy, setYyyy] = useState('');
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const mmRef = useRef<React.ComponentRef<typeof TextInput> | null>(null); const yyRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);

  async function submit() {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = 'Tell us your name.';
    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username.trim())) e.username = '3 to 20 letters, numbers, dots or underscores.';
    if (!email.includes('@')) e.email = 'Enter a valid email.';
    if (password.length < 8) e.password = 'Use at least 8 characters.';
    const d = Number(dd), m = Number(mm), y = Number(yyyy);
    const realDate = yyyy.length === 4 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() && y > 1900;
    if (!realDate) e.birth = 'Enter your birth date as day, month and year.';
    else if (ageOf(y, m, d) < MIN_AGE) e.birth = `BMUETTE is for people ${MIN_AGE} and over.`;
    if (!agree) e.agree = 'Please accept the Terms and Privacy Policy to continue.';
    setErrors(e);
    if (Object.keys(e).length) return haptics.warning();
    setBusy(true);
    try {
      await register({ email, password, username, displayName, birthDate: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, acceptTerms: true });
      haptics.success();
    } catch (err) {
      haptics.error();
      const msg = err instanceof ApiError ? err.message : 'Could not create your account.';
      setErrors({ [/username/i.test(msg) ? 'username' : /email/i.test(msg) ? 'email' : /born|birth|age|over/i.test(msg) ? 'birth' : 'form']: msg });
    } finally { setBusy(false); }
  }
  return (
    <AuthScreen title="Create your account" subtitle="Join to watch, post and shop.">
      <View style={{ gap: 16 }}>
        <Field label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" placeholder="Ada Okafor" error={errors.displayName} />
        <Field label="Username" value={username} onChangeText={setUsername} placeholder="ada.o" error={errors.username} />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" error={errors.email} />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 8 characters" error={errors.password} />
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <DateBox label="Day" value={dd} onChange={setDd} width={84} max={2} placeholder="DD" next={mmRef} error={!!errors.birth} />
            <DateBox label="Month" value={mm} onChange={setMm} width={84} max={2} placeholder="MM" innerRef={mmRef} next={yyRef} error={!!errors.birth} />
            <View style={{ flex: 1 }}><DateBox label="Year" value={yyyy} onChange={setYyyy} width="100%" max={4} placeholder="YYYY" innerRef={yyRef} error={!!errors.birth} /></View>
          </View>
          {errors.birth ? <Text variant="small" tone="danger">{errors.birth}</Text> : <Text variant="small" tone="muted">Used only to check your age. We do not keep your birth date.</Text>}
        </View>
        <View style={{ gap: 8 }}>
          <Press haptic="select" scaleTo={0.99} onPress={() => setAgree((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: agree }} accessibilityLabel="I accept the Terms and Privacy Policy" style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: errors.agree ? colors.danger : agree ? '#fff' : 'rgba(255,255,255,0.3)', backgroundColor: agree ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {agree ? <Icon name="check" size={16} color={colors.ink} strokeWidth={3} /> : null}
            </View>
            <Text style={{ flex: 1 }} tone="muted">
              I accept the <Text tone="ink" variant="bodyStrong" onPress={() => void openLegal('terms')}>Terms of Use</Text>, the <Text tone="ink" variant="bodyStrong" onPress={() => void openLegal('privacy')}>Privacy Policy</Text> and the <Text tone="ink" variant="bodyStrong" onPress={() => void openLegal('community')}>Community Rules</Text>.
            </Text>
          </Press>
          {errors.agree ? <Text variant="small" tone="danger">{errors.agree}</Text> : null}
        </View>
        {errors.form ? <Text variant="small" tone="danger">{errors.form}</Text> : null}
      </View>
      <Button title="Create account" major loading={busy} onPress={submit} />
      <Press haptic="tap" onPress={() => router.replace('/login')} style={{ alignItems: 'center', padding: 8 }}>
        <Text tone="muted">Already have an account? <Text tone="ink" variant="bodyStrong">Sign in</Text></Text>
      </Press>
    </AuthScreen>
  );
}
