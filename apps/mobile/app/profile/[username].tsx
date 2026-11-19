import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ProfileView } from '@/components/ProfileView';
import { useAuth } from '@/state/auth';

export default function PublicProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const me = useAuth((s) => s.user);
  return <ProfileView username={username} own={me?.username === username} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
