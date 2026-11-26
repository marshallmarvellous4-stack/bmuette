import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Sheet } from '../Sheet';
import { Press, Text } from '../ui';
import { ApiError } from '@/api/client';
import { useGiftCatalog, useSendGift, useWallet, type GiftItem } from '@/api/gifts';
import { useGiftUi } from '@/state/gifts';
import { haptics } from '@/theme/haptics';
import { Icon } from '@/theme/icons';
import { colors, radius } from '@/theme/tokens';
import { CoinPacks } from './CoinPacks';
import { GiftArt } from './GiftArt';
import { GIFT_META, GOLD, metaFor } from './giftMeta';

const QTYS = [1, 5, 10, 25, 99];
const COLS = 3;
const PER_PAGE = COLS * 2;
const FALLBACK: GiftItem[] = Object.entries(GIFT_META).map(([slug, m]) => ({ slug, name: m.name, coins: m.coins, tier: m.tier }));

function Card({ g, selected, width, onPress }: { g: GiftItem; selected: boolean; width: number; onPress: () => void }) {
  const lift = useSharedValue(0);
  useEffect(() => { lift.value = withSpring(selected ? 1 : 0, { damping: 14, stiffness: 180 }); }, [selected, lift]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: 1 + lift.value * 0.045 }] }));
  const m = metaFor(g.slug);
  return (
    <Press haptic="none" scaleTo={0.95} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${g.name}, ${g.coins} coins`} outerStyle={{ width }}>
      <Animated.View style={[{ width, height: 138, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.ink, borderWidth: selected ? 1.5 : 1, borderColor: selected ? GOLD.mid : 'rgba(17,18,20,0.9)', alignItems: 'center', paddingTop: 12 }, selected ? { shadowColor: m.glow, shadowOpacity: 0.85, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : null, st]}>
        <LinearGradient pointerEvents="none" colors={selected ? [`${m.glow}55`, 'transparent'] : ['rgba(255,255,255,0.07)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 96 }} />
        <GiftArt slug={g.slug} size={66} />
        <Text variant="small" style={{ color: '#fff', marginTop: 8, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>{g.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Icon name="coin" size={13} color={GOLD.mid} />
          <Text variant="caption" style={{ color: GOLD.mid, fontFamily: 'Inter_600SemiBold' }}>{g.coins.toLocaleString()}</Text>
        </View>
      </Animated.View>
    </Press>
  );
}

export function GiftTray() {
  const { tray, closeTray, openCoins, showBurst } = useGiftUi();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const catalog = useGiftCatalog();
  const wallet = useWallet();
  const send = useSendGift(tray?.postId ?? '');
  const items = catalog.data?.items?.length ? catalog.data.items : FALLBACK;
  const [slug, setSlug] = useState<string>('rose');
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pager = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useEffect(() => { if (tray) { setQty(1); setMessage(''); setError(null); setPage(0); send.reset(); } }, [tray?.postId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = items.find((g) => g.slug === slug) ?? items[0];
  const total = sel ? sel.coins * qty : 0;
  const balance = wallet.data?.coins;
  const pages = useMemo(() => Array.from({ length: Math.ceil(items.length / PER_PAGE) }, (_, i) => items.slice(i * PER_PAGE, (i + 1) * PER_PAGE)), [items]);
  const pageW = Math.min(winW, 520);
  const gap = 10;
  const cardW = Math.floor((pageW - 40 - gap * (COLS - 1)) / COLS);

  const getCoins = () => { closeTray(); openCoins(); };

  const doSend = () => {
    if (!tray || !sel || send.isPending) return;
    if (balance !== undefined && total > balance) { haptics.warning(); return getCoins(); }
    setError(null);
    haptics.major();
    const target = tray;
    send.mutate({ gift: sel.slug, qty, ...(message.trim() ? { message: message.trim() } : {}) }, {
      onSuccess: () => {
        haptics.success();
        closeTray();
        showBurst({ slug: sel.slug, name: sel.name, qty, tier: sel.tier, creator: target.creator.username });
      },
      onError: (e) => {
        haptics.error();
        const err = e as ApiError;
        if (err.code === 'INSUFFICIENT_COINS' || err.status === 402) return getCoins();
        if (err.code === 'EMAIL_NOT_VERIFIED' || err.code === 'ADULT_ONLY') { closeTray(); router.push('/verify-email'); return; }
        setError(err.status === 429 ? 'You are sending gifts very fast. Wait a moment.' : err.message || 'Could not send the gift.');
      },
    });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / pageW);
    if (p !== page) { setPage(p); haptics.select(); }
  };

  return (
    <Sheet visible={!!tray} onClose={closeTray}>
      <KeyboardAvoidingView behavior="padding">
        <View style={{ alignSelf: 'center', width: pageW }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 }}>
            <View>
              <Text variant="heading" tone="card">Send a gift</Text>
              {tray ? <Text variant="small" tone="mutedCard">to @{tray.creator.username}</Text> : null}
            </View>
            <Press haptic="tap" scaleTo={0.95} onPress={getCoins} accessibilityRole="button" accessibilityLabel={`${balance ?? 0} coins. Get more coins`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.ink, borderRadius: radius.pill, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 }}>
              <Icon name="coin" size={18} color={GOLD.mid} />
              <Text variant="bodyStrong" style={{ color: '#fff' }}>{balance === undefined ? '–' : balance.toLocaleString()}</Text>
              <View style={{ backgroundColor: GOLD.mid, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}><Text variant="caption" style={{ color: colors.ink, fontFamily: 'Inter_700Bold' }}>+ Get coins</Text></View>
            </Press>
          </View>

          <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} scrollEventThrottle={32} style={{ flexGrow: 0 }} accessibilityRole="radiogroup">
            {pages.map((pg, i) => (
              <View key={i} style={{ width: pageW, paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap, alignContent: 'flex-start' }}>
                {pg.map((g) => <Card key={g.slug} g={g} width={cardW} selected={g.slug === slug} onPress={() => { haptics.select(); setSlug(g.slug); }} />)}
              </View>
            ))}
          </ScrollView>
          {pages.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
              {pages.map((_, i) => <View key={i} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? colors.ink : 'rgba(17,18,20,0.2)' }} />)}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 14 }} accessibilityRole="radiogroup">
            {QTYS.map((q) => (
              <Press key={q} haptic="tap" scaleTo={0.94} onPress={() => setQty(q)} accessibilityRole="radio" accessibilityState={{ selected: qty === q }} accessibilityLabel={`Send ${q}`} outerStyle={{ flex: 1 }}
                style={{ height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: qty === q ? colors.ink : colors.cardSoft, borderWidth: qty === q ? 1 : 0, borderColor: GOLD.mid }}>
                <Text variant="small" style={{ color: qty === q ? GOLD.light : colors.textOnCard, fontFamily: 'Inter_700Bold' }}>×{q}</Text>
              </Press>
            ))}
          </View>

          <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
            <View style={{ backgroundColor: colors.cardSoft, borderRadius: radius.md, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput value={message} onChangeText={setMessage} maxLength={140} placeholder="Add a message (optional)" placeholderTextColor="#8A8C93" accessibilityLabel="Gift message" returnKeyType="done"
                style={{ flex: 1, height: 44, color: colors.textOnCard, fontSize: 15, fontFamily: 'Inter_500Medium' }} />
              {message.length > 100 ? <Text variant="caption" tone="mutedCard">{140 - message.length}</Text> : null}
            </View>
          </View>

          {error ? <Text variant="small" tone="danger" accessibilityLiveRegion="polite" style={{ paddingHorizontal: 20, marginTop: 8 }}>{error}</Text> : null}

          <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
            <Press haptic="none" scaleTo={0.98} onPress={doSend} disabled={send.isPending} accessibilityRole="button" accessibilityLabel={`Send ${qty} ${sel?.name ?? 'gift'} for ${total} coins`}>
              <LinearGradient colors={[GOLD.light, GOLD.mid, GOLD.deep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: send.isPending ? 0.7 : 1 }}>
                <Icon name="gift" size={20} color={colors.ink} />
                <Text variant="bodyStrong" style={{ color: colors.ink, fontSize: 16 }}>{send.isPending ? 'Sending' : `Send  ·  ${total.toLocaleString()} coins`}</Text>
              </LinearGradient>
            </Press>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

// "Get coins" from anywhere: the four packs in a sheet.
export function CoinsSheet() {
  const { coinsOpen, closeCoins } = useGiftUi();
  const wallet = useWallet();
  const router = useRouter();
  return (
    <Sheet visible={coinsOpen} onClose={closeCoins}>
      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text variant="heading" tone="card">Get coins</Text>
            <Text variant="small" tone="mutedCard">You have {(wallet.data?.coins ?? 0).toLocaleString()} coins</Text>
          </View>
          <Press haptic="tap" onPress={() => { closeCoins(); router.push('/wallet'); }} accessibilityRole="button" accessibilityLabel="Open wallet"><Text variant="small" tone="mutedCard" style={{ textDecorationLine: 'underline' }}>Wallet</Text></Press>
        </View>
        <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}><CoinPacks onNeedVerify={closeCoins} /></ScrollView>
      </View>
    </Sheet>
  );
}
