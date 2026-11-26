import React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Press, Text } from '@/components/ui';
import { CoinPacks } from '@/components/gifts/CoinPacks';
import { GOLD } from '@/components/gifts/giftMeta';
import { useWallet, useWalletHistory } from '@/api/gifts';
import { timeAgo } from '@/lib/money';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';

const KIND: Record<string, string> = { purchase: 'Coins bought', gift: 'Gift sent', refund: 'Refunded', adjust: 'Adjustment' };

export default function Wallet() {
  const router = useRouter();
  const wallet = useWallet();
  const history = useWalletHistory();
  return (
    <Page title="Wallet" subtitle="Coins are used to send gifts on posts.">
      <LinearGradient colors={['#2A2113', '#0E0E10']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: 'rgba(232,199,122,0.45)', gap: 4 }}>
        <Text variant="small" style={{ color: GOLD.mid }}>Your balance</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="coin" size={34} color={GOLD.mid} />
          <Text variant="title" style={{ color: GOLD.light }}>{wallet.data ? wallet.data.coins.toLocaleString() : '–'}</Text>
        </View>
      </LinearGradient>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 12 }}>
        <Text variant="heading" tone="card">Get coins</Text>
        <CoinPacks />
      </View>
      <Press haptic="tap" onPress={() => router.push('/earnings')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="wallet" size={20} color="#fff" /><Text style={{ flex: 1 }}>Gifts you received and payouts</Text><Icon name="chevron" size={18} color="#fff" />
      </Press>
      {(history.data?.items ?? []).length ? (
        <View style={{ gap: 10 }}>
          <Text variant="heading">History</Text>
          {history.data!.items.map((h) => (
            <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text tone="muted">{KIND[h.kind] ?? h.kind} · {timeAgo(h.createdAt)}</Text>
              <Text style={{ color: h.delta < 0 ? '#fff' : GOLD.mid }}>{h.delta < 0 ? '−' : '+'}{Math.abs(h.delta).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Page>
  );
}
