import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { ReportTarget } from '@/state/menu';

export const REASONS: { id: string; label: string; hint?: string }[] = [
  { id: 'spam', label: 'Spam or misleading' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'counterfeit', label: 'Fake or counterfeit item' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'violence', label: 'Violence or threats' },
  { id: 'nudity', label: 'Nudity or sexual content' },
  { id: 'copyright', label: 'Copyright or stolen content' },
  { id: 'child_safety', label: 'Child safety' },
  { id: 'other', label: 'Something else' },
];

export function useSendReport() {
  return useMutation({
    mutationFn: (v: { target: ReportTarget; reason: string; details?: string }) => {
      const key = { post: 'postId', product: 'productId', user: 'userId', comment: 'commentId' }[v.target.type];
      return api('/reports', { method: 'POST', body: { [key]: v.target.id, reason: v.reason, ...(v.details ? { details: v.details } : {}) } });
    },
  });
}

export function useBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, block }: { username: string; block: boolean }) => api(`/users/${username}/block`, { method: block ? 'POST' : 'DELETE' }),
    onSuccess: () => {
      // Their posts and messages should vanish everywhere straight away.
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['blocked'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['feed'] }); qc.invalidateQueries({ queryKey: ['userPosts'] }); qc.invalidateQueries({ queryKey: ['profile'] }); },
  });
}
