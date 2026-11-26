import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from './client';
import { useChatState } from './chat';

export type Activity = {
  id: string;
  type: 'like' | 'comment' | 'reply' | 'follow' | 'message' | 'order_paid' | 'order_update' | 'sale' | 'review' | 'refund' | 'payout' | 'gift' | 'system';
  title: string; body: string | null; read: boolean; createdAt: string;
  postId: string | null; commentId: string | null; conversationId: string | null; orderId: string | null; thumbUrl: string | null;
  actor: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
};
type Page = { items: Activity[]; nextCursor: string | null; unread: number };

export function useActivity() {
  const live = useChatState((s) => s.live);
  return useInfiniteQuery({
    queryKey: ['activity'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(`/notifications?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    refetchInterval: live ? false : 20_000,
  });
}

export function useActivityUnread() {
  const live = useChatState((s) => s.live);
  return useQuery({ queryKey: ['activity-unread'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: live ? false : 20_000 });
}

export function useMarkActivityRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: (r, ids) => {
      qc.setQueryData(['activity-unread'], { unread: r.unread });
      qc.setQueryData<InfiniteData<Page>>(['activity'], (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, unread: r.unread, items: p.items.map((i) => (!ids || ids.includes(i.id) ? { ...i, read: true } : i)) })) });
    },
  });
}

export type NotifPrefs = { likes: boolean; comments: boolean; follows: boolean; messages: boolean; orders: boolean };
export const useNotifPrefs = () => useQuery({ queryKey: ['notif-prefs'], queryFn: () => api<NotifPrefs>('/me/notification-settings') });
export function useSetNotifPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Partial<NotifPrefs>) => api<NotifPrefs>('/me/notification-settings', { method: 'PUT', body: p }),
    onMutate: async (p) => { qc.setQueryData<NotifPrefs>(['notif-prefs'], (o) => (o ? { ...o, ...p } : o)); },
    onSuccess: (r) => qc.setQueryData(['notif-prefs'], r),
    onError: () => void qc.invalidateQueries({ queryKey: ['notif-prefs'] }),
  });
}
