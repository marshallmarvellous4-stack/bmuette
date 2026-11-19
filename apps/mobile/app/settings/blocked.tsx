import React from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Page } from '@/components/Page';
import { Avatar, Button, Text } from '@/components/ui';
import { api } from '@/api/client';
import { useBlock } from '@/api/safety';
import type { PublicUser } from '@/api/types';

export default function Blocked() {
  const { data, isLoading } = useQuery({ queryKey: ['blocked'], queryFn: () => api<{ items: PublicUser[] }>('/me/blocked') });
  const block = useBlock();
  const items = data?.items ?? [];
  return (
    <Page title="Blocked accounts" subtitle="They cannot message you and you do not see their posts. They are not told.">
      {isLoading ? <Text tone="muted">Loading</Text> : items.length === 0 ? <Text tone="muted">You have not blocked anyone.</Text> : (
        <View style={{ gap: 14 }}>
          {items.map((u) => (
            <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={u.displayName} uri={u.avatarUrl} size={46} />
              <View style={{ flex: 1 }}><Text variant="bodyStrong">{u.displayName}</Text><Text variant="small" tone="muted">@{u.username}</Text></View>
              <Button title="Unblock" tone="ghost" style={{ height: 40, paddingHorizontal: 16 }} loading={block.isPending && block.variables?.username === u.username} onPress={() => block.mutate({ username: u.username, block: false })} />
            </View>
          ))}
        </View>
      )}
    </Page>
  );
}
