import { create } from 'zustand';
import type { Post } from '@/api/types';

// The floating player. One video at a time; it lives at the very top of the app, so it keeps playing
// while you browse the market, open a chat or go to a profile.
type Mini = { post: Post; startAt: number };
type PlayerState = { mini: Mini | null; open: (post: Post, startAt: number) => void; close: () => void };

export const usePlayer = create<PlayerState>((set) => ({
  mini: null,
  open: (post, startAt) => set({ mini: { post, startAt } }),
  close: () => set({ mini: null }),
}));
