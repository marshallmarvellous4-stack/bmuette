import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { MenuHost, ReportHost, SaveHost } from '@/components/Hosts';
import { CoinsSheet, GiftTray } from '@/components/gifts/GiftTray';
import { GiftBurstHost } from '@/components/gifts/GiftBurst';
import { MiniPlayer } from '@/components/MiniPlayer';
import { LoadingMark } from '@/components/Illustrations';
import { useAuth } from '@/state/auth';
import { usePushRegistration } from '@/lib/push';
import { useRealtime } from '@/state/realtime';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

function Realtime() {
  useRealtime();
  usePushRegistration();
  return null;
}

function Gate() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status === 'loading') return;
    const inAuth = segments[0] === '(auth)';
    if (status === 'signedOut' && !inAuth) router.replace('/welcome');
    if (status === 'signedIn' && inAuth) router.replace('/');
  }, [status, segments, router]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  const ready = fontsLoaded && status !== 'loading';
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <LoadingMark />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ink }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Gate />
          <Realtime />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ink }, animation: 'slide_from_right' }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="new" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="comments/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="product/[id]" />
            <Stack.Screen name="checkout/[id]" />
            <Stack.Screen name="shop/[slug]" />
            <Stack.Screen name="cart" />
            <Stack.Screen name="orders/index" />
            <Stack.Screen name="orders/[id]" />
            <Stack.Screen name="shop-admin" />
            <Stack.Screen name="wallet" />
            <Stack.Screen name="earnings" />
            <Stack.Screen name="profile/[username]" />
            <Stack.Screen name="post/[id]" />
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="chat/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="send/[kind]/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="verify-email" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="search" options={{ animation: 'fade' }} />
            <Stack.Screen name="tag/[tag]" />
            <Stack.Screen name="saved/index" />
            <Stack.Screen name="saved/[id]" />
            <Stack.Screen name="compose" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="sell" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
          <MiniPlayer />
          <MenuHost />
          <ReportHost />
          <SaveHost />
          <GiftTray />
          <CoinsSheet />
          <GiftBurstHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
