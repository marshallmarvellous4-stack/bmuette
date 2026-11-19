import React from 'react';
import { Platform } from 'react-native';
import { Page } from '@/components/Page';
import { Section, ToggleRow } from '@/components/SettingsBits';
import { Text } from '@/components/ui';
import { useNotifPrefs, useSetNotifPrefs, type NotifPrefs } from '@/api/notifications';

const ITEMS: { key: keyof NotifPrefs; icon: 'heart' | 'comment' | 'user' | 'chat' | 'bag'; label: string; hint: string }[] = [
  { key: 'messages', icon: 'chat', label: 'Messages', hint: 'New chat messages and voice notes' },
  { key: 'likes', icon: 'heart', label: 'Likes', hint: 'When someone likes your post' },
  { key: 'comments', icon: 'comment', label: 'Comments and replies', hint: 'On your posts and your comments' },
  { key: 'follows', icon: 'user', label: 'New followers', hint: 'When someone follows you' },
  { key: 'orders', icon: 'bag', label: 'Orders and sales', hint: 'Payments, shipping and delivery updates' },
];

export default function NotificationSettings() {
  const prefs = useNotifPrefs();
  const set = useSetNotifPrefs();
  return (
    <Page title="Notifications">
      <Text tone="muted" style={{ marginBottom: 14 }}>
        Choose what can buzz your phone. Everything still appears in your Inbox under Activity.
        {Platform.OS === 'web' ? ' Push notifications work in the phone app.' : ''}
      </Text>
      <Section title="Push notifications">
        {ITEMS.map((it, i) => (
          <ToggleRow key={it.key} icon={it.icon} label={it.label} hint={it.hint} value={prefs.data?.[it.key] ?? true} onChange={(v) => set.mutate({ [it.key]: v })} last={i === ITEMS.length - 1} />
        ))}
      </Section>
    </Page>
  );
}
