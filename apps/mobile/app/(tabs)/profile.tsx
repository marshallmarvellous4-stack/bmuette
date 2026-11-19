import React from 'react';
import { ProfileView } from '@/components/ProfileView';
import { useAuth } from '@/state/auth';

export default function MyProfile() {
  const user = useAuth((s) => s.user);
  return user ? <ProfileView username={user.username} own /> : null;
}
