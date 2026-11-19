import React from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { api } from '@/api/client';
import { useAuth } from '@/state/auth';

// While the app is open, notifications show as a banner and the live badge also updates.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

import { pushToken } from '@/state/pushToken';

/** Where a tap on a notification should go. Used for both push taps and Activity rows. */
export function routeFor(d: { type?: string; title?: string | null; postId?: string | null; conversationId?: string | null; orderId?: string | null; username?: string | null }): string | null {
  if (d.conversationId) return `/chat/${d.conversationId}`;
  // Shop-side events open the shop tools; buyer-side ones open the order.
  if (d.type === 'sale') return '/shop-admin?tab=orders';
  if (d.type === 'refund' && d.title?.startsWith('Return requested')) return '/shop-admin?tab=returns';
  if (d.type === 'payout') return '/shop-admin?tab=money';
  if (d.type === 'review') return '/shop-admin?tab=reviews';
  if (d.orderId) return `/orders/${d.orderId}`;
  if (d.postId) return `/post/${d.postId}`;
  if (d.type === 'follow' && d.username) return `/profile/${d.username}`;
  return null;
}

// Real push needs a development or production build. Expo Go on Android cannot receive remote push (since SDK 53),
// so there we quietly skip and the Activity tab with live badges still works.
async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'BMUETTE', importance: Notifications.AndroidImportance.HIGH });
    }
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== 'granted' && perm.canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return t.data;
  } catch {
    return null;
  }
}

/** Registers this phone for push once signed in, and forgets it on sign-out. Also routes taps on a notification. */
export function usePushRegistration() {
  const status = useAuth((s) => s.status);
  const router = useRouter();

  React.useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    void getToken().then(async (t) => {
      if (!t || cancelled) return;
      pushToken.value = t;
      await api('/push/register', { method: 'POST', body: { token: t, platform: Platform.OS } }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [status]);

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse) => {
      const c = r.notification.request.content;
      const to = routeFor({ ...((c.data ?? {}) as any), title: c.title });
      if (to) router.push(to as any);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
}
