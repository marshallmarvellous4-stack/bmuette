import React from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Row, Section, ToggleRow } from '@/components/SettingsBits';
import { confirm } from '@/lib/moderation';
import { openLegal } from '@/lib/legal';
import { useAuth } from '@/state/auth';
import { useHapticSettings } from '@/theme/haptics';

export default function Settings() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const haptic = useHapticSettings();
  if (!user) return null;
  return (
    <Page title="Settings">
      <Section title="Account">
        <Row icon="mail" label="Email" value={user.emailVerified ? `${user.email}  ·  verified` : `${user.email}  ·  not verified`} onPress={user.emailVerified ? undefined : () => router.push('/verify-email')} />
        {!user.emailVerified ? <Row icon="check" label="Verify your email" value="Needed to open a shop or check out" onPress={() => router.push('/verify-email')} /> : null}
        <Row icon="lock" label="Change password" onPress={() => router.push('/settings/password')} last />
      </Section>
      <Section title="App">
        <Row icon="bell" label="Notifications" value="Choose what can buzz your phone" onPress={() => router.push('/settings/notifications')} />
        <ToggleRow icon="play" label="Haptic feedback" hint="Small vibrations as you tap" value={haptic.enabled} onChange={haptic.setEnabled} last />
      </Section>
      <Section title="Safety">
        <Row icon="block" label="Blocked accounts" onPress={() => router.push('/settings/blocked')} last />
      </Section>
      <Section title="About">
        <Row icon="flag" label="Terms of Use" onPress={() => void openLegal('terms')} />
        <Row icon="lock" label="Privacy Policy" onPress={() => void openLegal('privacy')} />
        <Row icon="user" label="Community Rules" onPress={() => void openLegal('community')} />
        <Row icon="mail" label="Contact support" value="We reply within a day or two" onPress={() => void Linking.openURL('mailto:support@bmuette.app')} last />
      </Section>
      <Section>
        <Row icon="back" label="Log out" onPress={() => confirm('Log out?', 'You can sign back in any time.', 'Log out', () => void logout())} />
        <Row icon="trash" label="Delete account" danger onPress={() => router.push('/settings/delete')} last />
      </Section>
    </Page>
  );
}
void Platform;
