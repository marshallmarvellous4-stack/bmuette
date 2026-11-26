import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { patchPostEverywhere } from './hooks';
import type { Comment } from './types';

type Page<T> = { items: T[]; nextCursor?: string | null };

export type GiftItem = { slug: string; name: string; coins: number; tier: number };
export const useGiftCatalog = () => useQuery({ queryKey: ['gift-catalog'], queryFn: () => api<{ items: GiftItem[] }>('/gifts'), staleTime: 10 * 60_000 });

export type CoinPack = { id: string; coins: number; prices: { NGN: number; USD: number } };
export type Wallet = { coins: number; packs: CoinPack[] };
export const useWallet = () => useQuery({ queryKey: ['wallet'], queryFn: () => api<Wallet>('/wallet') });

export type WalletRow = { id: string; delta: number; kind: 'purchase' | 'gift' | 'refund' | 'adjust'; createdAt: string };
export const useWalletHistory = () => useQuery({ queryKey: ['wallet-history'], queryFn: () => api<{ items: WalletRow[] }>('/wallet/history') });

export type Purchase = { id: string; packCoins: number; currency: string; amountMinor: number; status: string; createdAt: string; paidAt: string | null; coins: number };
export type StartedPurchase = { purchaseId: string; coins: number; checkout: { provider: string; url: string } };
export const startPurchase = (packId: string, currency: 'NGN' | 'USD') => api<StartedPurchase>('/wallet/purchases', { method: 'POST', body: { packId, currency } });
export const getPurchase = (id: string) => api<Purchase>(`/wallet/purchases/${id}`);

export type Gifter = { id: string; username: string; displayName: string; avatarUrl: string | null; coins: number };
export const useTopGifters = (postId: string) => useQuery({ queryKey: ['gift-top', postId], queryFn: () => api<{ totalCoins: number; top: Gifter[] }>(`/posts/${postId}/gifts`) });

export type Earnings = {
  coinsReceived: number; earnedMinor: number; earnedThisMonthMinor: number; gifts: number; currency: string; holdDays: number;
  recent: { id: string; gift: string; name: string; qty: number; coins: number; createdAt: string; from: { username: string; displayName: string; avatarUrl: string | null } }[];
};
export const useEarnings = () => useQuery({ queryKey: ['earnings'], queryFn: () => api<Earnings>('/me/earnings') });

export function useSendGift(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { gift: string; qty: number; message?: string }) => api<{ comment: Comment; coins: number }>(`/posts/${postId}/gifts`, { method: 'POST', body: v }),
    onSuccess: ({ comment, coins }) => {
      qc.setQueryData<Page<Comment>>(['comments', postId], (d) => (d ? { ...d, items: [...d.items, comment] } : d));
      qc.setQueryData<Wallet>(['wallet'], (w) => (w ? { ...w, coins } : w));
      patchPostEverywhere(qc, postId, (p) => ({ ...p, counts: { ...p.counts, comments: p.counts.comments + 1, giftCoins: (p.counts.giftCoins ?? 0) + (comment.gift?.coins ?? 0) } }));
      void qc.invalidateQueries({ queryKey: ['gift-top', postId] });
      void qc.invalidateQueries({ queryKey: ['wallet-history'] });
      void qc.invalidateQueries({ queryKey: ['post', postId] });
    },
  });
}
