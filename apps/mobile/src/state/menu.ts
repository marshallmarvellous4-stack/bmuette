import { create } from 'zustand';
import type { MenuAction } from '@/components/Sheet';

// Any screen can open a small action menu or a report form without owning the UI for it.
type Menu = { title?: string; actions: MenuAction[] } | null;
export const useMenu = create<{ menu: Menu; show: (m: NonNullable<Menu>) => void; hide: () => void }>((set) => ({
  menu: null,
  show: (menu) => set({ menu }),
  hide: () => set({ menu: null }),
}));

export type ReportTarget = { type: 'post' | 'product' | 'user' | 'comment'; id: string; label: string };
export const useReport = create<{ target: ReportTarget | null; start: (t: ReportTarget) => void; close: () => void }>((set) => ({
  target: null,
  start: (target) => set({ target }),
  close: () => set({ target: null }),
}));
