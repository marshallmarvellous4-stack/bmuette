import { create } from 'zustand';

// The gift tray, the coins sheet and the full-screen burst are mounted once at the root; any screen opens them from here.
export type GiftTarget = { postId: string; creator: { username: string; displayName: string } };
export type BurstShow = { slug: string; name: string; qty: number; tier: number; creator: string; key: number };

export const useGiftUi = create<{
  tray: GiftTarget | null;
  coinsOpen: boolean;
  burst: BurstShow | null;
  openTray: (t: GiftTarget) => void;
  closeTray: () => void;
  openCoins: () => void;
  closeCoins: () => void;
  showBurst: (b: Omit<BurstShow, 'key'>) => void;
  hideBurst: () => void;
}>((set) => ({
  tray: null,
  coinsOpen: false,
  burst: null,
  openTray: (tray) => set({ tray }),
  closeTray: () => set({ tray: null }),
  openCoins: () => set({ coinsOpen: true }),
  closeCoins: () => set({ coinsOpen: false }),
  showBurst: (b) => set({ burst: { ...b, key: Date.now() } }),
  hideBurst: () => set({ burst: null }),
}));
