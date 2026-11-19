import { create } from 'zustand';

// Any screen can open the "save to a board" sheet for a post or product.
export type SaveTarget = { type: 'post' | 'product'; id: string; saved: boolean };
export const useSaveSheet = create<{ target: SaveTarget | null; open: (t: SaveTarget) => void; close: () => void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
