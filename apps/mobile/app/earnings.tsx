import React, { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Page } from '@/components/Page';
import { Avatar, Button, Field, Text } from '@/components/ui';
import { GiftArt } from '@/components/gifts/GiftArt';
import { GOLD } from '@/components/gifts/giftMeta';
import { ApiError, api } from '@/api/client';
import { useEarnings } from '@/api/gifts';
import { useBalance, usePayouts } from '@/api/shop';
import { formatMoney, timeAgo } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';

export default function Earnings() {
  const router = useRouter();
  const qc = useQueryClient();
  const e = useEarnings();
  const bal = useBalance();
  const payouts = usePayouts();
  const [details, setDetails] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const d = details ?? bal.data?.payoutDetails ?? '';
  const ngn = bal.data?.balances.find((b) => b.currency === 'NGN') ?? bal.data?.balances[0];
  const refresh = () => { for (const k of ['shop-balance', 'shop-payouts', 'earnings']) void qc.invalidateQueries({ queryKey: [k] }); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); haptics.success(); setMsg(ok); refresh(); } catch (err) {
      haptics.error();
      if (err instanceof ApiError && (err.code === 'EMAIL_NOT_VERIFIED' || err.code === 'ADULT_ONLY')) { router.push('/verify-email'); return; }
      setMsg(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  };
  return (
    <Page title="Earnings" subtitle={`Gifts are held ${e.data?.holdDays ?? 14} days, then you can request a payout.`}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, gap: 4 }}>
        <Text variant="title" tone="card">{formatMoney(ngn?.availableMinor ?? 0, ngn?.currency ?? 'NGN')}</Text>
        <Text variant="small" tone="mutedCard">Available to pay out</Text>
        <Text variant="small" tone="mutedCard">Waiting: {formatMoney(ngn?.pendingMinor ?? 0, ngn?.currency ?? 'NGN')}  ·  This month: {formatMoney(e.data?.earnedThisMonthMinor ?? 0, 'NGN')}</Text>
        <Text variant="small" tone="mutedCard">{(e.data?.coinsReceived ?? 0).toLocaleString()} coins from {e.data?.gifts ?? 0} gifts</Text>
        <Button title="Request payout" tone="dark" disabled={!ngn || ngn.availableMinor <= 0} onPress={() => run(() => api('/merchant/payouts', { method: 'POST', body: { currency: ngn!.currency } }), 'Payout requested. We will send it and mark it paid.')} />
      </View>
      <View style={{ gap: 10 }}>
        <Text variant="heading">Bank details</Text>
        <Field label="Where should we send your money?" value={d} onChangeText={setDetails} multiline autoCapitalize="words" placeholder="Bank, account number, account name" style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }} />
        <Button title="Save bank details" tone="ghost" onPress={() => run(() => api('/merchant/payout-details', { method: 'PUT', body: { details: d } }), 'Bank details saved.')} />
      </View>
      {msg ? <Text tone="muted" accessibilityLiveRegion="polite">{msg}</Text> : null}
      {(e.data?.recent ?? []).length ? (
        <View style={{ gap: 12 }}>
          <Text variant="heading">Recent gifts</Text>
          {e.data!.recent.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <GiftArt slug={r.gift} size={40} ambient={false} />
              <View style={{ flex: 1 }}>
                <Text>{r.qty > 1 ? `${r.qty} × ` : ''}{r.name} from @{r.from.username}</Text>
                <Text variant="small" tone="muted">{timeAgo(r.createdAt)}</Text>
              </View>
              <Text style={{ color: GOLD.mid }}>{r.coins.toLocaleString()} coins</Text>
            </View>
          ))}
        </View>
      ) : <Text tone="muted">Gifts people send you will show up here.</Text>}
      {(payouts.data?.items ?? []).length ? (
        <View style={{ gap: 8 }}>
          <Text variant="heading">Payouts</Text>
          {payouts.data!.items.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text tone="muted">{timeAgo(p.createdAt)} · {p.status}</Text><Text>{formatMoney(p.amountMinor, p.currency)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Page>
  );
}
