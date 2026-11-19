import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from './client';
import type { CheckoutResult, Comment, Page, Post, Product, Profile } from './types';

// ---------------- feed ----------------
// The For You feed hands out a fresh batch on every call (and remembers what you have seen), so "next page" is just "call again".
export function useFeed(kind: 'forYou' | 'following') {
  return useInfiniteQuery({
    queryKey: ['feed', kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      kind === 'forYou' ? api<Page<Post>>('/feed?limit=8') : api<Page<Post>>(`/feed/following?limit=8${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (kind === 'forYou' ? (last.items.length ? 'more' : undefined) : last.nextCursor ?? undefined),
    select: (d) => {
      const seen = new Set<string>();
      return d.pages.flatMap((p) => p.items).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    },
  });
}

type FeedCache = InfiniteData<Page<Post>>;
function patchPostEverywhere(qc: ReturnType<typeof useQueryClient>, id: string, fn: (p: Post) => Post) {
  qc.setQueriesData<FeedCache>({ queryKey: ['feed'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === id ? fn(p) : p)) })) });
  qc.setQueriesData<FeedCache>({ queryKey: ['userPosts'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.id === id ? fn(p) : p)) })) });
}

export function useLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post, like }: { post: Post; like: boolean }) => api(`/posts/${post.id}/like`, { method: like ? 'POST' : 'DELETE' }),
    onMutate: ({ post, like }) => {
      patchPostEverywhere(qc, post.id, (p) => ({ ...p, viewer: { ...p.viewer, liked: like }, counts: { ...p.counts, likes: Math.max(0, p.counts.likes + (like ? 1 : -1)) } }));
    },
    onError: (_e, { post, like }) => {
      patchPostEverywhere(qc, post.id, (p) => ({ ...p, viewer: { ...p.viewer, liked: !like }, counts: { ...p.counts, likes: Math.max(0, p.counts.likes + (like ? -1 : 1)) } }));
    },
  });
}

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, follow }: { username: string; follow: boolean; authorId: string }) => api(`/users/${username}/follow`, { method: follow ? 'POST' : 'DELETE' }),
    onMutate: ({ authorId, follow }) => {
      const set = (v: boolean) => qc.setQueriesData<FeedCache>({ queryKey: ['feed'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.author.id === authorId ? { ...p, viewer: { ...p.viewer, following: v } } : p)) })) });
      set(follow);
    },
    onError: (_e, { authorId, follow }) => {
      qc.setQueriesData<FeedCache>({ queryKey: ['feed'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((p) => (p.author.id === authorId ? { ...p, viewer: { ...p.viewer, following: !follow } } : p)) })) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); },
  });
}

export const recordView = (id: string, watchMs: number, completion: number, replays = 0) =>
  api(`/posts/${id}/view`, { method: 'POST', body: { watchMs: Math.round(watchMs), completion: Math.min(1, Math.max(0, completion)), replays } }).catch(() => {});

export const downloadLink = (id: string) => api<{ url: string }>(`/posts/${id}/download`, { method: 'POST' });

export function useComments(postId: string) {
  return useQuery({ queryKey: ['comments', postId], queryFn: () => api<Page<Comment>>(`/posts/${postId}/comments?limit=50`) });
}
export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<Comment>(`/posts/${postId}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (c) => {
      qc.setQueryData<Page<Comment>>(['comments', postId], (d) => (d ? { ...d, items: [...d.items, c] } : d));
      patchPostEverywhere(qc, postId, (p) => ({ ...p, counts: { ...p.counts, comments: p.counts.comments + 1 } }));
    },
  });
}

// ---------------- marketplace ----------------
export function useMarket(category: string | null) {
  return useInfiniteQuery({
    queryKey: ['market', category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Product>>(`/market?limit=20${category ? `&category=${encodeURIComponent(category)}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  });
}
export const useProduct = (id: string) => useQuery({ queryKey: ['product', id], queryFn: () => api<Product>(`/products/${id}`) });
export const useSimilar = (id: string) => useQuery({ queryKey: ['similar', id], queryFn: () => api<{ items: Product[] }>(`/products/${id}/similar`).catch(() => ({ items: [] as Product[] })) });

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    enabled: q.trim().length >= 2,
    queryFn: () => api<{ products: Product[]; posts: Post[]; users: unknown[] }>(`/search?q=${encodeURIComponent(q.trim())}`),
  });
}

export const buyNow = (productId: string, qty: number, shipping?: unknown) =>
  api<CheckoutResult>('/orders', { method: 'POST', body: { items: [{ productId, qty }], ...(shipping ? { shipping } : {}) } });

// ---------------- people ----------------
export const useProfile = (username: string | undefined) => useQuery({ queryKey: ['profile', username], enabled: !!username, queryFn: () => api<Profile>(`/users/${username}`) });
export function useUserPosts(username: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['userPosts', username],
    enabled: !!username,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Post>>(`/users/${username}/posts?limit=18${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  });
}
