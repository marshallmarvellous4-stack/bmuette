import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Page } from '@/components/Page';
import { Sheet } from '@/components/Sheet';
import { Stars } from '@/components/Stars';
import { Button, Chip, Field, Press, Text } from '@/components/ui';
import { ApiError, api } from '@/api/client';
import { useBalance, useDiscounts, useLedger, useMyProducts, usePayouts, useShopInvalidate, useShopOrders, useShopRefunds, type Discount, type RefundReq, type Reviews, type ShopItem } from '@/api/shop';
import type { Product } from '@/api/types';
import { formatMoney, timeAgo } from '@/lib/money';
import { haptics } from '@/theme/haptics';
import { colors, radius } from '@/theme/tokens';

const TABS = [['orders', 'Orders'], ['returns', 'Returns'], ['products', 'Products'], ['codes', 'Codes'], ['money', 'Money'], ['reviews', 'Reviews']] as const;
type Tab = (typeof TABS)[number][0];
const minor = (s: string) => Math.round((Number(s.replace(',', '.')) || 0) * 100);

function Card({ children }: { children: React.ReactNode }) { return <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, gap: 8 }}>{children}</View>; }
function Row({ a, b, strong }: { a: string; b: string; strong?: boolean }) { return <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text tone="mutedCard" variant={strong ? 'bodyStrong' : 'body'}>{a}</Text><Text tone="card" variant="bodyStrong">{b}</Text></View>; }
const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

// ---------- orders ----------
function Orders() {
  const q = useShopOrders();
  const inv = useShopInvalidate();
  const [sel, setSel] = useState<ShopItem | null>(null);
  const [f, setF] = useState({ carrier: '', trackingNumber: '', trackingUrl: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (status: 'shipped' | 'delivered') => {
    setBusy(true); setErr(null);
    try {
      await api(`/merchant/order-items/${sel!.id}`, { method: 'PATCH', body: { status, ...(status === 'shipped' ? Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())) : {}) } });
      haptics.success(); setSel(null); inv();
    } catch (e) { haptics.error(); setErr(errText(e)); } finally { setBusy(false); }
  };
  const items = q.data?.items ?? [];
  if (!items.length) return <Text tone="muted">Paid orders will show up here.</Text>;
  return (
    <>
      {items.map((i) => (
        <Card key={i.id}>
          <Text variant="bodyStrong" tone="card">{i.qty} × {i.title}{i.variantLabel ? ` (${i.variantLabel})` : ''}</Text>
          <Text variant="small" tone="mutedCard">{i.buyerName} · {timeAgo(i.paidAt)} · {formatMoney(i.unitPriceMinor * i.qty - i.discountMinor, i.currency)}</Text>
          {i.shipping ? <Text variant="small" tone="card">{i.shipping.name}, {i.shipping.line1}, {i.shipping.city} {i.shipping.country} · {i.shipping.phone}</Text> : null}
          <Text variant="bodyStrong" tone="card">{i.refundStatus === 'refunded' ? 'Refunded' : i.fulfilment[0].toUpperCase() + i.fulfilment.slice(1)}{i.trackingNumber ? ` · ${i.carrier ?? ''} ${i.trackingNumber}` : ''}</Text>
          {i.fulfilment !== 'delivered' && i.refundStatus !== 'refunded' ? <Button title={i.fulfilment === 'shipped' ? 'Update tracking' : 'Add tracking and ship'} tone="dark" onPress={() => { setErr(null); setF({ carrier: i.carrier ?? '', trackingNumber: i.trackingNumber ?? '', trackingUrl: i.trackingUrl ?? '', note: '' }); setSel(i); }} /> : null}
        </Card>
      ))}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title="Ship this order">
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Field onCard label="Courier (for example GIG Logistics)" value={f.carrier} onChangeText={(v) => setF({ ...f, carrier: v })} autoCapitalize="words" />
          <Field onCard label="Tracking number" value={f.trackingNumber} onChangeText={(v) => setF({ ...f, trackingNumber: v })} />
          <Field onCard label="Tracking link (optional)" value={f.trackingUrl} onChangeText={(v) => setF({ ...f, trackingUrl: v })} keyboardType="url" />
          <Field onCard label="Note to the buyer (optional)" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} autoCapitalize="sentences" />
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Mark as shipped" tone="dark" major loading={busy} onPress={() => send('shipped')} />
          <Button title="Mark as delivered" tone="ghost" onPress={() => send('delivered')} />
        </ScrollView>
      </Sheet>
    </>
  );
}

// ---------- returns ----------
function Returns() {
  const q = useShopRefunds();
  const inv = useShopInvalidate();
  const [sel, setSel] = useState<RefundReq | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true); setErr(null);
    try { await api(`/merchant/refunds/${sel!.id}/decide`, { method: 'POST', body: { decision, ...(note.trim() ? { response: note.trim() } : {}) } }); haptics.success(); setSel(null); setNote(''); inv(); }
    catch (e) { haptics.error(); setErr(errText(e)); } finally { setBusy(false); }
  };
  const items = q.data?.items ?? [];
  if (!items.length) return <Text tone="muted">No return requests.</Text>;
  return (
    <>
      {items.map((r) => (
        <Card key={r.id}>
          <Text variant="bodyStrong" tone="card">{r.title}{r.variantLabel ? ` (${r.variantLabel})` : ''}</Text>
          <Text variant="small" tone="mutedCard">{r.buyerName} · {timeAgo(r.createdAt)} · {formatMoney(r.amountMinor, r.currency)}</Text>
          <Text tone="card">{r.reason}{r.details ? `: ${r.details}` : ''}</Text>
          <Text variant="bodyStrong" tone="card">{{ requested: 'Waiting for you', approved: 'Approved, refund not sent yet', rejected: 'Declined', refunded: 'Refunded' }[r.status]}</Text>
          {r.error ? <Text variant="small" tone="danger">The payment provider said: {r.error}</Text> : null}
          {r.status === 'requested' || r.status === 'approved' ? <Button title={r.status === 'approved' ? 'Retry the refund' : 'Review request'} tone="dark" onPress={() => { setErr(null); setSel(r); }} /> : null}
        </Card>
      ))}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title="Return request">
        <View style={{ padding: 20, gap: 12 }}>
          {sel ? <Text tone="card">{sel.reason}{sel.details ? `: ${sel.details}` : ''}</Text> : null}
          {sel ? <Text variant="small" tone="mutedCard">Approving pays {formatMoney(sel.amountMinor, sel.currency)} back to the buyer. It comes out of your balance.</Text> : null}
          <Field onCard label="Message to the buyer (optional)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Approve and refund" tone="dark" major loading={busy} onPress={() => decide('approve')} />
          {sel?.status === 'requested' ? <Button title="Decline" tone="ghost" onPress={() => decide('reject')} /> : null}
        </View>
      </Sheet>
    </>
  );
}

// ---------- products: options and stock ----------
type VRow = { id?: string; label: string; price: string; stock: string };
function Products() {
  const q = useMyProducts();
  const inv = useShopInvalidate();
  const [sel, setSel] = useState<Product | null>(null);
  const [rows, setRows] = useState<VRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (p: Product) => {
    setErr(null); setSel(p);
    setRows((p.variants ?? []).map((v) => ({ id: v.id, label: v.label, price: v.priceMinor === null ? '' : String(v.priceMinor / 100), stock: v.stock === null ? '' : String(v.stock) })));
  };
  const save = async () => {
    if (rows.some((r) => !r.label.trim())) return setErr('Every option needs a name.');
    setBusy(true); setErr(null);
    try {
      await api(`/products/${sel!.id}/variants`, { method: 'PUT', body: { variants: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label.trim(), options: {}, priceMinor: r.price.trim() ? minor(r.price) : null, stock: r.stock.trim() ? Math.max(0, Math.floor(Number(r.stock) || 0)) : null })) } });
      haptics.success(); setSel(null); inv();
    } catch (e) { haptics.error(); setErr(errText(e)); } finally { setBusy(false); }
  };
  const items = q.data?.items ?? [];
  if (!items.length) return <Text tone="muted">List a product first, then add sizes and colours here.</Text>;
  const set = (i: number, k: keyof VRow) => (v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <>
      {items.map((p) => (
        <Card key={p.id}>
          <Text variant="bodyStrong" tone="card">{p.title}</Text>
          <Text variant="small" tone="mutedCard">{formatMoney(p.price.amountMinor, p.price.currency)} · {p.variants?.length ? `${p.variants.length} options` : p.stock === null ? 'Unlimited stock' : `${p.stock} in stock`} · {p.counts.sold} sold</Text>
          <Button title="Options and stock" tone="dark" onPress={() => open(p)} />
        </Card>
      ))}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel ? `Options for ${sel.title}` : 'Options'}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text variant="small" tone="mutedCard">Sizes, colours or any choice. Leave price empty to use the product price, and stock empty for unlimited. With no options, the product's own stock is used.</Text>
          {rows.map((r, i) => (
            <View key={i} style={{ gap: 8, borderBottomWidth: 1, borderColor: colors.cardSoft, paddingBottom: 12 }}>
              <Field onCard label="Name (for example M / Black)" value={r.label} onChangeText={set(i, 'label')} autoCapitalize="words" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Field onCard label="Price (optional)" value={r.price} onChangeText={set(i, 'price')} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field onCard label="Stock (optional)" value={r.stock} onChangeText={set(i, 'stock')} keyboardType="number-pad" /></View>
              </View>
              <Press haptic="tap" onPress={() => setRows((x) => x.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Remove this option"><Text variant="small" tone="danger">Remove option</Text></Press>
            </View>
          ))}
          <Button title="Add an option" tone="ghost" onPress={() => setRows((x) => [...x, { label: '', price: '', stock: '' }])} />
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Save options" tone="dark" major loading={busy} onPress={save} />
        </ScrollView>
      </Sheet>
    </>
  );
}

// ---------- discount codes ----------
function Codes() {
  const q = useDiscounts();
  const inv = useShopInvalidate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', kind: 'percent' as 'percent' | 'fixed', value: '10', currency: 'NGN', min: '', max: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/merchant/discounts', { method: 'POST', body: { code: f.code.trim(), kind: f.kind, value: f.kind === 'percent' ? Math.round(Number(f.value) || 0) : minor(f.value), ...(f.kind === 'fixed' ? { currency: f.currency } : {}), ...(f.min.trim() ? { minSubtotalMinor: minor(f.min) } : {}), ...(f.max.trim() ? { maxUses: Math.max(1, Math.floor(Number(f.max) || 1)) } : {}) } });
      haptics.success(); setOpen(false); setF({ ...f, code: '' }); inv();
    } catch (e) { haptics.error(); setErr(errText(e)); } finally { setBusy(false); }
  };
  const toggle = async (d: Discount) => { haptics.select(); await api(`/merchant/discounts/${d.id}`, { method: 'PATCH', body: { active: !d.active } }).catch(() => {}); inv(); };
  const items = q.data?.items ?? [];
  return (
    <>
      <Button title="New discount code" onPress={() => { setErr(null); setOpen(true); }} />
      {items.map((d) => (
        <Card key={d.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodyStrong" tone="card">{d.code}</Text><Text variant="bodyStrong" tone="card">{d.kind === 'percent' ? `${d.value}% off` : `${formatMoney(d.value, d.currency!)} off`}</Text></View>
          <Text variant="small" tone="mutedCard">Used {d.usedCount}{d.maxUses ? ` of ${d.maxUses}` : ''} times{d.minSubtotalMinor ? ` · min spend ${(d.minSubtotalMinor / 100).toLocaleString()}` : ''}</Text>
          <Button title={d.active ? 'Switch off' : 'Switch on'} tone="dark" onPress={() => toggle(d)} />
        </Card>
      ))}
      <Sheet visible={open} onClose={() => setOpen(false)} title="New discount code">
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Field onCard label="Code (letters and numbers)" value={f.code} onChangeText={(v) => setF({ ...f, code: v.replace(/[^A-Za-z0-9]/g, '') })} autoCapitalize="characters" maxLength={20} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Chip onCard label="Percent off" selected={f.kind === 'percent'} onPress={() => setF({ ...f, kind: 'percent' })} /><Chip onCard label="Fixed amount" selected={f.kind === 'fixed'} onPress={() => setF({ ...f, kind: 'fixed' })} /></View>
          <Field onCard label={f.kind === 'percent' ? 'Percent (1 to 90)' : 'Amount off'} value={f.value} onChangeText={(v) => setF({ ...f, value: v })} keyboardType="decimal-pad" />
          {f.kind === 'fixed' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR'].map((c) => <Chip onCard key={c} label={c} selected={f.currency === c} onPress={() => setF({ ...f, currency: c })} />)}</View> : null}
          <Field onCard label="Minimum spend (optional)" value={f.min} onChangeText={(v) => setF({ ...f, min: v })} keyboardType="decimal-pad" />
          <Field onCard label="Maximum uses (optional)" value={f.max} onChangeText={(v) => setF({ ...f, max: v })} keyboardType="number-pad" />
          <Text variant="small" tone="mutedCard">A code only reduces the price of your own products, and each buyer can use it once.</Text>
          {err ? <Text tone="danger" accessibilityLiveRegion="polite">{err}</Text> : null}
          <Button title="Create code" tone="dark" major loading={busy} disabled={f.code.length < 3} onPress={create} />
        </ScrollView>
      </Sheet>
    </>
  );
}

// ---------- money ----------
function Money() {
  const bal = useBalance();
  const ledger = useLedger();
  const payouts = usePayouts();
  const inv = useShopInvalidate();
  const [details, setDetails] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setMsg(null); try { await fn(); haptics.success(); setMsg(ok); inv(); } catch (e) { haptics.error(); setMsg(errText(e)); } };
  const d = details ?? bal.data?.payoutDetails ?? '';
  return (
    <>
      {(bal.data?.balances ?? []).length === 0 ? <Text tone="muted">Your balance appears after your first paid order.</Text> : null}
      {(bal.data?.balances ?? []).map((b) => (
        <Card key={b.currency}>
          <Text variant="title" tone="card">{formatMoney(b.availableMinor, b.currency)}</Text>
          <Text variant="small" tone="mutedCard">Available to pay out</Text>
          <Row a="Waiting (held a few days)" b={formatMoney(b.pendingMinor, b.currency)} />
          <Row a="Sales" b={formatMoney(b.earnedMinor, b.currency)} />
          <Row a="BMUETTE fee" b={`−${formatMoney(b.feesMinor, b.currency)}`} />
          <Row a="Refunds" b={`−${formatMoney(b.refundsMinor, b.currency)}`} />
          <Row a="Paid out" b={formatMoney(b.paidOutMinor, b.currency)} />
          <Button title="Request payout" tone="dark" disabled={b.availableMinor <= 0} onPress={() => { setAsking(b.currency); setAmount(''); setMsg(null); }} />
        </Card>
      ))}
      <View style={{ gap: 10 }}>
        <Text variant="heading">Bank details</Text>
        <Field label="Where should we send your money?" value={d} onChangeText={setDetails} multiline autoCapitalize="words" placeholder="Bank, account number, account name" style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }} />
        <Button title="Save bank details" tone="ghost" onPress={() => run(() => api('/merchant/payout-details', { method: 'PUT', body: { details: d } }), 'Bank details saved.')} />
      </View>
      {asking ? (
        <Card>
          <Text variant="bodyStrong" tone="card">Payout in {asking}</Text>
          <Field onCard label="Amount (leave empty for everything available)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Button title="Send request" tone="dark" major onPress={() => run(async () => { await api('/merchant/payouts', { method: 'POST', body: { currency: asking, ...(amount.trim() ? { amountMinor: minor(amount) } : {}) } }); setAsking(null); }, 'Payout requested. We will send it and mark it paid.')} />
        </Card>
      ) : null}
      {msg ? <Text tone="muted" accessibilityLiveRegion="polite">{msg}</Text> : null}
      {(payouts.data?.items ?? []).length ? (
        <View style={{ gap: 8 }}>
          <Text variant="heading">Payouts</Text>
          {payouts.data!.items.map((p) => <Row key={p.id} a={`${timeAgo(p.createdAt)} · ${p.status}${p.reference ? ` · ${p.reference}` : ''}${p.note ? ` · ${p.note}` : ''}`} b={formatMoney(p.amountMinor, p.currency)} />)}
        </View>
      ) : null}
      {(ledger.data?.items ?? []).length ? (
        <View style={{ gap: 8 }}>
          <Text variant="heading">Recent activity</Text>
          {ledger.data!.items.map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text tone="muted" style={{ flex: 1 }} numberOfLines={1}>{{ sale: 'Sale', fee: 'BMUETTE fee', refund: 'Refund', fee_refund: 'Fee returned', payout: 'Payout', payout_reversal: 'Payout returned' }[l.kind] ?? l.kind}{l.title ? ` · ${l.title}` : ''}</Text>
              <Text>{l.amountMinor < 0 ? '−' : '+'}{formatMoney(Math.abs(l.amountMinor), l.currency)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

// ---------- reviews ----------
function ProductReviews({ p }: { p: Product }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reviews', p.id], queryFn: () => api<Reviews>(`/products/${p.id}/reviews?limit=30`) });
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    try { await api(`/reviews/${reply!.id}/reply`, { method: 'PATCH', body: { reply: reply!.text.trim() } }); haptics.success(); setReply(null); void qc.invalidateQueries({ queryKey: ['reviews', p.id] }); }
    catch (e) { haptics.error(); setErr(errText(e)); }
  };
  if (!q.data?.items.length) return null;
  return (
    <Card>
      <Text variant="bodyStrong" tone="card">{p.title}</Text>
      {q.data.items.map((r) => (
        <View key={r.id} style={{ gap: 4, borderTopWidth: 1, borderColor: colors.cardSoft, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="small" tone="mutedCard">{r.reviewer.displayName} · {timeAgo(r.createdAt)}</Text><Stars value={r.rating} size={13} /></View>
          {r.body ? <Text tone="card">{r.body}</Text> : null}
          {r.reply ? <Text variant="small" tone="mutedCard">Your reply: {r.reply}</Text> : <Press haptic="tap" onPress={() => { setErr(null); setReply({ id: r.id, text: '' }); }} accessibilityRole="button" accessibilityLabel="Reply to this review"><Text variant="small" tone="card" style={{ textDecorationLine: 'underline' }}>Reply</Text></Press>}
        </View>
      ))}
      <Sheet visible={!!reply} onClose={() => setReply(null)} title="Reply to review">
        <View style={{ padding: 20, gap: 12 }}>
          <Field onCard label="Your reply (public)" value={reply?.text ?? ''} onChangeText={(t) => setReply((r) => r && { ...r, text: t })} multiline maxLength={600} autoCapitalize="sentences" style={{ height: 90, paddingTop: 12, textAlignVertical: 'top' }} />
          {err ? <Text tone="danger">{err}</Text> : null}
          <Button title="Post reply" tone="dark" major disabled={!reply?.text.trim()} onPress={send} />
        </View>
      </Sheet>
    </Card>
  );
}
function Reviews_() {
  const q = useMyProducts();
  const items = (q.data?.items ?? []).filter((p) => (p.rating?.count ?? 0) > 0);
  if (!items.length) return <Text tone="muted">Reviews from buyers will show up here so you can reply.</Text>;
  return <>{items.map((p) => <ProductReviews key={p.id} p={p} />)}</>;
}

export default function ShopAdmin() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((TABS.find((t) => t[0] === params.tab)?.[0]) ?? 'orders');
  return (
    <Page title="Shop tools" subtitle="Orders, returns, products, codes and your money.">
      <View style={{ gap: 14 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(([id, label]) => <Chip key={id} label={label} selected={tab === id} onPress={() => setTab(id)} />)}
        </ScrollView>
        {tab === 'orders' ? <Orders /> : tab === 'returns' ? <Returns /> : tab === 'products' ? <Products /> : tab === 'codes' ? <Codes /> : tab === 'money' ? <Money /> : <Reviews_ />}
        <Button title="Add a product" tone="ghost" onPress={() => router.push('/sell')} />
      </View>
    </Page>
  );
}
void Linking;
