import React from 'react';
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, animation: 'shift', sceneStyle: { backgroundColor: colors.ink } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="market" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
