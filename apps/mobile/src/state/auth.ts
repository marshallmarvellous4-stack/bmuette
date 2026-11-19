import { create } from 'zustand';
import { api, hasTokens, loadTokens, saveTokens, setSignedOutHandler } from '@/api/client';
import { pushToken } from '@/state/pushToken';
import type { AuthResult, Me, PublicUser } from '@/api/types';

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: (PublicUser & Partial<Me>) | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (v: { email: string; password: string; username: string; displayName: string; birthDate: string; acceptTerms: true }) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => {
  setSignedOutHandler(() => set({ status: 'signedOut', user: null }));
  const accept = async (r: AuthResult) => {
    await saveTokens({ access: r.accessToken, refresh: r.refreshToken });
    set({ status: 'signedIn', user: r.user });
    void api<Me>('/me').then((me) => set({ user: me })).catch(() => {});
  };
  return {
    status: 'loading',
    user: null,
    async bootstrap() {
      await loadTokens();
      if (!hasTokens()) return set({ status: 'signedOut' });
      try {
        const me = await api<Me>('/me');
        set({ status: 'signedIn', user: me });
      } catch (e: any) {
        // A network error should not sign you out; only a real "not allowed" does.
        if (e?.status === 401 || e?.status === 403) { await saveTokens(null); set({ status: 'signedOut', user: null }); }
        else set({ status: 'signedOut' });
      }
    },
    adopt: accept,
    async login(email, password) { await accept(await api<AuthResult>('/auth/login', { method: 'POST', body: { email: email.trim(), password }, auth: false })); },
    async register(v) { await accept(await api<AuthResult>('/auth/register', { method: 'POST', body: { ...v, email: v.email.trim(), username: v.username.trim(), displayName: v.displayName.trim() }, auth: false })); },
    async refreshMe() { try { set({ user: await api<Me>('/me') }); } catch { /* keep the old copy */ } },
    async changePassword(currentPassword, newPassword) {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      await saveTokens({ access: r.accessToken, refresh: r.refreshToken });
    },
    async deleteAccount(password) {
      await api('/me/delete', { method: 'POST', body: { password } });
      await saveTokens(null);
      set({ status: 'signedOut', user: null });
    },
    async logout() {
      if (pushToken.value) { await api('/push/unregister', { method: 'POST', body: { token: pushToken.value } }).catch(() => {}); pushToken.value = null; }
      const t = await loadTokens();
      if (t) api('/auth/logout', { method: 'POST', body: { refreshToken: t.refresh }, auth: false }).catch(() => {});
      await saveTokens(null);
      set({ status: 'signedOut', user: null });
    },
  };
});
