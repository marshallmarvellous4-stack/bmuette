import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Press, Text } from '@/components/ui';
import { ApiError } from '@/api/client';
import { getPurchase, startPurchase, useWallet, type CoinPack } from '@/api/gifts';
import { formatMoney } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';
import { GOLD } from './giftMeta';

type Cur = 'NGN' | 'USD';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The four coin packs, the currency switch and the whole buy flow. Used by the wallet screen and by the coins sheet.
export function CoinPacks({ onNeedVerify }: { onNeedVerify?: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useWallet();
  const [cur, setCur] = useState<Cur>('NGN');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; good?: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const finish = () => { for (const k of ['wallet', 'wallet-history']) void qc.invalidateQueries({ queryKey: [k] }); };

  async function buy(p: CoinPack) {
    if (busy) return;
    haptics.press();
    setBusy(p.id); setMsg(null);
    try {
      const r = await startPurchase(p.id, cur);
      await WebBrowser.openBrowserAsync(r.checkout.url); // Flutterwave (naira) or Stripe (dollars) hosted payment page
      setMsg({ text: 'Confirming your payment' });
      // The payment page closes before the webhook lands, so ask until it is marked paid.
      for (let i = 0; i < 40 && alive.current; i++) {
        const s = await getPurchase(r.purchaseId);
        if (s.status === 'paid') { haptics.success(); finish(); setMsg({ text: `${p.coins.toLocaleString()} coins added to your wallet.`, good: true }); return; }
        if (['failed', 'expired', 'cancelled', 'canceled'].includes(s.status)) { haptics.error(); setMsg({ text: 'The payment did not go through. You have not been charged.' }); return; }
        await sleep(i < 5 ? 1500 : 3000);
      }
      if (alive.current) { finish(); setMsg({ text: 'Still waiting for the payment. Your coins appear in your wallet as soon as it clears.' }); }
    } catch (e) {
      haptics.error();
      if (e instanceof ApiError && (e.code === 'EMAIL_NOT_VERIFIED' || e.code === 'ADULT_ONLY' || e.status === 403)) { onNeedVerify?.(); router.push('/verify-email'); return; }
      if (e instanceof ApiError && e.status === 503) setMsg({ text: 'Buying coins is not switched on yet. Please check back soon.' });
      else setMsg({ text: e instanceof ApiError ? e.message : 'Could not start the payment. Try again.' });
    } finally { if (alive.current) setBusy(null); }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.cardSoft, borderRadius: radius.pill, padding: 3 }}>
        {(['NGN', 'USD'] as Cur[]).map((c) => (
          <Press key={c} haptic="select" scaleTo={0.96} onPress={() => setCur(c)} accessibilityRole="radio" accessibilityState={{ selected: cur === c }} accessibilityLabel={c === 'NGN' ? 'Pay in naira' : 'Pay in dollars'}
            style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: cur === c ? colors.ink : 'transparent' }}>
            <Text variant="small" style={{ color: cur === c ? '#fff' : colors.mutedOnCard, fontFamily: 'Inter_600SemiBold' }}>{c === 'NGN' ? '₦ Naira' : '$ Dollars'}</Text>
          </Press>
        ))}
      </View>
      {(data?.packs ?? []).map((p, i) => {
        const best = i === (data?.packs.length ?? 0) - 1;
        return (
          <Press key={p.id} haptic="none" scaleTo={0.98} onPress={() => buy(p)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Buy ${p.coins} coins for ${formatMoney(p.prices[cur], cur)}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.md, backgroundColor: colors.ink }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(232,199,122,0.14)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(232,199,122,0.5)' }}>
              <Icon name="coin" size={24} color={GOLD.mid} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" style={{ color: GOLD.light }}>{p.coins.toLocaleString()}</Text>
              <Text variant="small" tone="muted">{best ? 'Best value' : 'coins'}</Text>
            </View>
            {busy === p.id ? <ActivityIndicator color={GOLD.mid} /> : (
              <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: GOLD.mid }}>
                <Text variant="bodyStrong" style={{ color: colors.ink }}>{formatMoney(p.prices[cur], cur)}</Text>
              </View>
            )}
          </Press>
        );
      })}
      {msg ? <Text variant="small" tone={msg.good ? 'card' : 'mutedCard'} accessibilityLiveRegion="polite" style={msg.good ? { color: '#1C8F55', fontFamily: 'Inter_600SemiBold' } : undefined}>{msg.text}</Text> : null}
    </View>
  );
}
