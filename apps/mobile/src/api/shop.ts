import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CheckoutResult, Product, Rating } from './types';

export type Shipping = { name: string; phone: string; line1: string; city: string; country: string };
export type Line = { productId: string; variantId?: string | null; qty: number };

// ---------------- cart ----------------
export type CartItem = {
  id: string; productId: string; variantId: string | null; qty: number; title: string; variantLabel: string | null;
  unitPriceMinor: number; currency: string; thumbUrl: string | null; issue: string | null;
  merchant: { userId: string; shopName: string; slug: string };
};
export type Cart = { items: CartItem[]; groups: { currency: string; subtotalMinor: number; count: number; ready: boolean }[]; count: number };

export const useCart = () => useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart') });
export const useCartCount = (opts?: object) => useQuery({ queryKey: ['cart-count'], queryFn: () => api<{ count: number }>('/cart/count'), staleTime: 10_000, enabled: opts !== undefined });

function useCartMutation<V>(fn: (v: V) => Promise<Cart>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (c) => { qc.setQueryData(['cart'], c); qc.setQueryData(['cart-count'], { count: c.count }); },
  });
}
export const useAddToCart = () => useCartMutation((b: { productId: string; variantId?: string | null; qty?: number }) => api<Cart>('/cart/items', { method: 'POST', body: { qty: 1, ...b } }));
export const useCartQty = () => useCartMutation((b: { id: string; qty: number }) => api<Cart>(`/cart/items/${b.id}`, { method: 'PATCH', body: { qty: b.qty } }));
export const useCartRemove = () => useCartMutation((id: string) => api<Cart>(`/cart/items/${id}`, { method: 'DELETE' }));

export type Quote = { currency: string; subtotalMinor: number; discountMinor: number; totalMinor: number; code: string | null; needsShipping: boolean };
export const quote = (items: Line[], code?: string) => api<Quote>('/orders/quote', { method: 'POST', body: { items, ...(code ? { code } : {}) } });
export const cartCheckout = (currency: string, code: string | undefined, shipping?: Shipping) =>
  api<CheckoutResult>('/cart/checkout', { method: 'POST', body: { currency, ...(code ? { code } : {}), ...(shipping ? { shipping } : {}) } });
export const buyLines = (items: Line[], code: string | undefined, shipping?: Shipping) =>
  api<CheckoutResult>('/orders', { method: 'POST', body: { items, ...(code ? { code } : {}), ...(shipping ? { shipping } : {}) } });

// ---------------- orders ----------------
export type OrderItem = {
  id: string; productId: string; title: string; variantLabel: string | null; unitPriceMinor: number; qty: number; discountMinor: number;
  fulfilment: 'pending' | 'shipped' | 'delivered' | 'cancelled'; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null;
  shippedAt: string | null; deliveredAt: string | null; refundedMinor: number; refundStatus: 'requested' | 'approved' | 'rejected' | 'refunded' | null;
  thumbUrl: string | null; reviewed: boolean; canRefund: boolean; canReview: boolean;
};
export type Order = {
  id: string; status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'; currency: string; subtotalMinor: number; discountMinor: number; feeMinor: number; totalMinor: number;
  createdAt: string; paidAt: string | null; items: OrderItem[];
  timeline?: { id: number; itemId: string | null; kind: string; note: string | null; at: string }[];
};
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: () => api<{ items: Order[] }>('/orders') });
export const useOrder = (id: string) => useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`) });

export function useOrderActions(orderId?: string) {
  const qc = useQueryClient();
  const done = () => { void qc.invalidateQueries({ queryKey: ['order'] }); void qc.invalidateQueries({ queryKey: ['orders'] }); };
  return {
    received: useMutation({ mutationFn: (itemId: string) => api(`/order-items/${itemId}/received`, { method: 'POST' }), onSuccess: done }),
    refund: useMutation({ mutationFn: (b: { itemId: string; reason: string; details?: string }) => api(`/order-items/${b.itemId}/refund`, { method: 'POST', body: { reason: b.reason, details: b.details || undefined } }), onSuccess: done }),
    review: useMutation({
      mutationFn: (b: { productId: string; orderItemId: string; rating: number; body?: string }) => api(`/products/${b.productId}/reviews`, { method: 'POST', body: { orderItemId: b.orderItemId, rating: b.rating, body: b.body || undefined } }),
      onSuccess: (_r, v) => { done(); void qc.invalidateQueries({ queryKey: ['reviews', v.productId] }); void qc.invalidateQueries({ queryKey: ['product', v.productId] }); },
    }),
    orderId,
  };
}

// ---------------- reviews ----------------
export type Review = { id: string; productId: string; rating: number; body: string; verified: boolean; reply: string | null; createdAt: string; reviewer: { id: string; username: string; displayName: string; avatarUrl: string | null } };
export type Reviews = { summary: Rating & { histogram: number[] }; items: Review[]; nextCursor: string | null };
export const useReviews = (productId: string) => useQuery({ queryKey: ['reviews', productId], queryFn: () => api<Reviews>(`/products/${productId}/reviews?limit=30`) });

// ---------------- shop tools ----------------
export type ShopItem = {
  id: string; orderId: string; title: string; variantLabel: string | null; qty: number; unitPriceMinor: number; discountMinor: number; currency: string;
  fulfilment: string; paidAt: string; buyerName: string; shipping: { name: string; phone: string; line1: string; city: string; country: string } | null;
  carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; refundStatus: string | null; refundedMinor: number;
};
export const useShopOrders = () => useQuery({ queryKey: ['shop-orders'], queryFn: () => api<{ items: ShopItem[] }>('/merchant/orders') });

export type RefundReq = { id: string; orderItemId: string; orderId: string; title: string; variantLabel: string | null; reason: string; details: string | null; amountMinor: number; currency: string; status: 'requested' | 'approved' | 'rejected' | 'refunded'; response: string | null; error: string | null; buyerName: string | null; createdAt: string };
export const useShopRefunds = () => useQuery({ queryKey: ['shop-refunds'], queryFn: () => api<{ items: RefundReq[] }>('/merchant/refunds') });

export type Discount = { id: string; code: string; kind: 'percent' | 'fixed'; value: number; currency: string | null; minSubtotalMinor: number; maxUses: number | null; usedCount: number; expiresAt: string | null; active: boolean };
export const useDiscounts = () => useQuery({ queryKey: ['shop-discounts'], queryFn: () => api<{ items: Discount[] }>('/merchant/discounts') });

export type Balance = { currency: string; earnedMinor: number; feesMinor: number; refundsMinor: number; paidOutMinor: number; availableMinor: number; pendingMinor: number };
export const useBalance = () => useQuery({ queryKey: ['shop-balance'], queryFn: () => api<{ payoutDetails: string | null; balances: Balance[] }>('/merchant/balance') });
export type LedgerRow = { id: number; kind: string; currency: string; amountMinor: number; title: string | null; availableAt: string; createdAt: string };
export const useLedger = () => useQuery({ queryKey: ['shop-ledger'], queryFn: () => api<{ items: LedgerRow[] }>('/merchant/ledger?limit=30') });
export type Payout = { id: string; currency: string; amountMinor: number; status: 'requested' | 'paid' | 'rejected'; reference: string | null; note: string | null; createdAt: string };
export const usePayouts = () => useQuery({ queryKey: ['shop-payouts'], queryFn: () => api<{ items: Payout[] }>('/merchant/payouts') });
export const useMyProducts = () => useQuery({ queryKey: ['my-products'], queryFn: () => api<{ items: Product[] }>('/me/products') });

export function useShopInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of ['shop-orders', 'shop-refunds', 'shop-discounts', 'shop-balance', 'shop-ledger', 'shop-payouts', 'my-products', 'product']) void qc.invalidateQueries({ queryKey: [k] }); };
}
