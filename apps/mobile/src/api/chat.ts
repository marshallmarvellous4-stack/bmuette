import React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { create } from 'zustand';
import { api } from './client';

export type ChatPerson = { id: string; username: string; displayName: string; avatarUrl: string | null };
export type ChatMessage = {
  id: string; conversationId: string; senderId: string; kind: 'text' | 'image' | 'post' | 'product' | 'voice';
  body: string | null; mediaUrl: string | null; durationMs?: number | null; refId: string | null; clientId: string; createdAt: string;
  ref: null | { id: string; title?: string; priceMinor?: number; currency?: string; caption?: string; username?: string; kind?: string; thumbUrl: string | null };
  state?: 'sending' | 'failed'; // only ever set on this phone, before the server confirms
};
export type Conversation = { id: string; with: ChatPerson; lastMessage: ChatMessage | null; lastMessageAt: string; unread: number; muted: boolean };
type ThreadPage = { items: ChatMessage[]; nextCursor: string | null; peerReadAt: string | null };
type Thread = InfiniteData<ThreadPage>;

// Which chat is on screen right now, and whether the live connection is up.
export const useChatState = create<{ openId: string | null; live: boolean }>(() => ({ openId: null, live: false }));

// Who is typing right now, by chat. Entries expire by themselves after a few seconds.
export const useTyping = create<{ until: Record<string, number> }>(() => ({ until: {} }));
export const setTyping = (conversationId: string, on: boolean) => useTyping.setState((s) => ({ until: { ...s.until, [conversationId]: on ? Date.now() + 4500 : 0 } }));

export function useIsTyping(conversationId: string) {
  const until = useTyping((s) => s.until[conversationId] ?? 0);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const left = until - Date.now();
    if (left <= 0) return;
    const t = setTimeout(tick, left + 20);
    return () => clearTimeout(t);
  }, [until]);
  return until > Date.now();
}

export const newClientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function useConversations() {
  const live = useChatState((s) => s.live);
  // With the live connection up we only fetch once; without it we poll so chat still works on a bad network.
  return useQuery({ queryKey: ['conversations'], queryFn: () => api<Conversation[]>('/conversations'), refetchInterval: live ? false : 12_000 });
}
export function useUnread() {
  const live = useChatState((s) => s.live);
  return useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number }>('/conversations/unread'), refetchInterval: live ? false : 15_000 });
}
export const openChat = (userId: string) => api<Conversation>('/conversations', { method: 'POST', body: { userId } });

export function useThread(id: string) {
  const live = useChatState((s) => s.live);
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: ['thread', id],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const page = await api<ThreadPage>(`/conversations/${id}/messages?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`);
      if (pageParam) return page;
      // Messages still on their way (or failed) exist only on this phone: keep them on top of the fresh page.
      const local = (qc.getQueryData<Thread>(['thread', id])?.pages[0]?.items ?? []).filter((m) => m.state && !page.items.some((x) => x.clientId === m.clientId));
      return { ...page, items: [...local, ...page.items] };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: live ? false : 6000,
    structuralSharing: false,
  });
}

export const flatten = (d?: Thread) => {
  const seen = new Set<string>();
  return (d?.pages ?? []).flatMap((p) => p.items).filter((m) => (seen.has(m.clientId) ? false : (seen.add(m.clientId), true)));
};

function putMessage(qc: QueryClient, m: ChatMessage) {
  qc.setQueryData<Thread>(['thread', m.conversationId], (d) => {
    if (!d) return d;
    const [first, ...rest] = d.pages;
    const items = first.items.filter((x) => x.clientId !== m.clientId && x.id !== m.id);
    return { ...d, pages: [{ ...first, items: [m, ...items] }, ...rest] };
  });
}

export function useSendMessage(conversationId: string, me: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    // Try even when the phone thinks it is offline: a failed send shows "Not sent. Tap to retry" instead of hanging.
    networkMode: 'always',
    mutationFn: (m: ChatMessage & { payload: Record<string, unknown> }) => api<ChatMessage>(`/conversations/${conversationId}/messages`, { method: 'POST', body: { ...m.payload, clientId: m.clientId } }),
    onSuccess: (saved) => {
      putMessage(qc, saved);
      bumpList(qc, saved, me);
    },
    onError: (_e, m) => putMessage(qc, { ...m, state: 'failed' }),
  });
  // Show the message straight away; the server's copy replaces it when it arrives.
  const send = (payload: { kind: ChatMessage['kind']; body?: string; mediaId?: string; refId?: string; durationMs?: number }, preview: Partial<ChatMessage> = {}, clientId = newClientId()) => {
    const draft: ChatMessage & { payload: Record<string, unknown> } = {
      id: `local-${clientId}`, conversationId, senderId: me, kind: payload.kind, body: payload.body ?? null, mediaUrl: null, refId: payload.refId ?? null,
      ref: null, clientId, createdAt: new Date().toISOString(), state: 'sending', ...preview, payload,
    };
    putMessage(qc, draft);
    mutation.mutate(draft);
  };
  const retry = (m: ChatMessage & { payload?: Record<string, unknown> }) => {
    const payload = m.payload ?? (m.kind === 'text' ? { kind: 'text', body: m.body } : null);
    if (!payload) return;
    const again = { ...m, state: 'sending' as const, payload };
    putMessage(qc, again);
    mutation.mutate(again);
  };
  return { send, retry };
}

function bumpList(qc: QueryClient, m: ChatMessage, me: string, opts: { unreadDelta?: number } = {}) {
  let found = false;
  qc.setQueryData<Conversation[]>(['conversations'], (list) => {
    if (!list) return list;
    const next = list.map((c) => {
      if (c.id !== m.conversationId) return c;
      found = true;
      return { ...c, lastMessage: m, lastMessageAt: m.createdAt, unread: Math.max(0, c.unread + (opts.unreadDelta ?? 0)) };
    });
    return next.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  });
  // A chat we haven't seen yet (the first message from someone new): ask the server.
  if (!found) void qc.invalidateQueries({ queryKey: ['conversations'] });
  void me;
}

export const markRead = (qc: QueryClient, id: string) => {
  qc.setQueryData<Conversation[]>(['conversations'], (l) => l?.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  void api(`/conversations/${id}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['unread'] })).catch(() => {});
};

// Called by the live connection for everything the server pushes.
export function applyEvent(qc: QueryClient, me: string, e: any, onIncomingInOpenChat?: (id: string) => void) {
  if (e.type === 'typing') {
    setTyping(e.conversationId, true);
  } else if (e.type === 'notification') {
    qc.setQueryData(['activity-unread'], { unread: e.unread });
    void qc.invalidateQueries({ queryKey: ['activity'] });
  } else if (e.type === 'message') {
    const m = e.message as ChatMessage;
    putMessage(qc, m);
    setTyping(m.conversationId, false);
    const mine = m.senderId === me;
    const open = useChatState.getState().openId === m.conversationId;
    bumpList(qc, m, me, { unreadDelta: !mine && !open ? 1 : 0 });
    if (!mine) {
      if (open) onIncomingInOpenChat?.(m.conversationId);
      else void qc.invalidateQueries({ queryKey: ['unread'] });
    }
  } else if (e.type === 'read') {
    if (e.userId === me) {
      void qc.invalidateQueries({ queryKey: ['unread'] });
    } else {
      qc.setQueryData<Thread>(['thread', e.conversationId], (d) => d && { ...d, pages: d.pages.map((p, i) => (i === 0 ? { ...p, peerReadAt: e.at } : p)) });
    }
  }
}

// "Message" buttons: open (or create) the chat with someone, then go to it.
export function useMessageUser() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const go = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await openChat(userId);
      router.push(`/chat/${c.id}`);
    } catch { /* blocked or offline: stay put */ } finally { setBusy(false); }
  };
  return { go, busy };
}
