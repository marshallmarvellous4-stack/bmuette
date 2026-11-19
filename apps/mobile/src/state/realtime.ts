import React from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL, api, getAccessToken } from '@/api/client';
import { applyEvent, markRead, useChatState } from '@/api/chat';
import { useAuth } from '@/state/auth';
import { haptics } from '@/theme/haptics';

const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

let socket: WebSocket | null = null;
/** Tell the other person we are typing. Does nothing when the live connection is down. */
export function sendTyping(conversationId: string) {
  try { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'typing', conversationId })); } catch {}
}

// One live connection for the whole app. It reconnects by itself, and when it is down the chat
// screens fall back to polling (see api/chat.ts), so a flaky network never leaves a chat frozen.
export function useRealtime() {
  const qc = useQueryClient();
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.user?.id);

  React.useEffect(() => {
    if (status !== 'signedIn' || !me) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let readTimer: ReturnType<typeof setTimeout> | undefined;

    const resync = () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      void qc.invalidateQueries({ queryKey: ['activity-unread'] });
      const open = useChatState.getState().openId;
      if (open) void qc.invalidateQueries({ queryKey: ['thread', open] });
    };
    const markOpenRead = (id: string) => {
      clearTimeout(readTimer);
      readTimer = setTimeout(() => markRead(qc, id), 350);
    };

    const connect = () => {
      if (stopped || ws) return;
      const token = getAccessToken();
      if (!token) return;
      const sock = new WebSocket(WS_URL);
      ws = sock;
      socket = sock;
      sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token }));
      sock.onmessage = (ev) => {
        let data: any;
        try { data = JSON.parse(String(ev.data)); } catch { return; }
        if (data.type === 'ready') {
          tries = 0;
          useChatState.setState({ live: true });
          resync(); // anything that arrived while we were away
          return;
        }
        if (data.type === 'message' && data.message?.senderId !== me && useChatState.getState().openId === data.message?.conversationId) haptics.select();
        applyEvent(qc, me, data, markOpenRead);
      };
      sock.onclose = async (ev) => {
        ws = null;
        if (socket === sock) socket = null;
        useChatState.setState({ live: false });
        if (stopped) return;
        // 4401 = our access token ran out. Any normal request renews it; then we try again.
        if ((ev as { code?: number }).code === 4401) await api('/me').catch(() => {});
        tries += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(tries, 4), 15_000) + Math.random() * 500);
      };
      sock.onerror = () => {};
    };

    connect();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        if (!ws) { tries = 0; clearTimeout(timer); connect(); }
        resync();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(readTimer);
      sub.remove();
      ws?.close();
      useChatState.setState({ live: false });
    };
  }, [status, me, qc]);
}
