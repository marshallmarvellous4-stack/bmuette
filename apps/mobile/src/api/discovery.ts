import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Board, PersonHit, Post, Product, SavedProduct, Sound } from './types';

// ---- search, tags, trending ----
export const useTrendingTags = () => useQuery({ queryKey: ['trendingTags'], staleTime: 60_000, queryFn: () => api<{ items: { tag: string; posts: number }[] }>('/tags/trending?limit=12') });
export const useTrendingSearches = () => useQuery({ queryKey: ['trendingSearches'], staleTime: 60_000, queryFn: () => api<{ items: string[] }>('/trending/searches?limit=8') });
export type Suggestion = { type: 'tag' | 'product' | 'user'; text: string };
export const useSuggest = (q: string) => useQuery({
  queryKey: ['suggest', q], enabled: q.trim().length >= 1, staleTime: 30_000,
  queryFn: () => api<{ items: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(q.trim())}`).then((r) => r.items),
});
export function useFind(q: string, type: 'users' | 'products' | 'posts') {
  return useQuery({
    queryKey: ['find', type, q], enabled: q.trim().length >= 2,
    queryFn: () => api<{ users?: PersonHit[]; products?: Product[]; posts?: Post[] }>(`/search?q=${encodeURIComponent(q.trim())}&type=${type}&limit=24`),
  });
}
export function useTagPosts(tag: string) {
  return useInfiniteQuery({
    queryKey: ['tag', tag], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ tag: string; postCount: number; items: Post[]; nextCursor: string | null }>(`/tags/${encodeURIComponent(tag)}/posts?limit=18${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
}

// ---- boards ----
export const useBoards = () => useQuery({ queryKey: ['boards'], queryFn: () => api<{ total: number; items: Board[] }>('/collections') });
export const useSavedAll = () => useQuery({ queryKey: ['saved', 'all'], queryFn: () => api<{ posts: Post[]; products: SavedProduct[] }>('/collections/saved/items') });
export const useBoardItems = (id: string) => useQuery({ queryKey: ['saved', id], queryFn: () => api<{ posts: Post[]; products: SavedProduct[] }>(`/collections/${id}/items`) });

export function useBoardActions() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['boards'] }); void qc.invalidateQueries({ queryKey: ['saved'] }); };
  return {
    create: useMutation({ mutationFn: (name: string) => api<Board>('/collections', { method: 'POST', body: { name } }), onSuccess: refresh }),
    rename: useMutation({ mutationFn: (v: { id: string; name: string }) => api(`/collections/${v.id}`, { method: 'PATCH', body: { name: v.name } }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/collections/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

// Save (optionally into a board) or unsave a post or a product.
export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { type: 'post' | 'product'; id: string; save: boolean; collectionId?: string }) => {
      const path = `/${v.type === 'post' ? 'posts' : 'products'}/${v.id}/save`;
      return v.save ? api(path, { method: 'POST', body: v.collectionId ? { collectionId: v.collectionId } : {} }) : api(path, { method: 'DELETE' });
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['boards'] }); void qc.invalidateQueries({ queryKey: ['saved'] });
      if (v.type === 'post') {
        const set = (p: Post) => (p.id === v.id ? { ...p, viewer: { ...p.viewer, saved: v.save }, counts: { ...p.counts, saves: Math.max(0, p.counts.saves + (v.save === p.viewer.saved ? 0 : v.save ? 1 : -1)) } } : p);
        qc.setQueriesData<{ pages: { items: Post[] }[] }>({ queryKey: ['feed'] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map(set) })) });
      } else void qc.invalidateQueries({ queryKey: ['product', v.id] });
    },
  });
}

// ---- sounds ----
export const useSounds = (q: string) => useQuery({ queryKey: ['sounds', q], staleTime: 120_000, queryFn: () => api<{ items: Sound[] }>(`/sounds${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) });
