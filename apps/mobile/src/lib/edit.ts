import type { FilterName, PostEdit } from '@/api/types';

// Editing never changes the uploaded file. Trim, filter and text are stored with the post and applied while it plays.
export const FILTERS: { id: FilterName; label: string; fn: { [k: string]: number }[]; tint?: { color: string; opacity: number } }[] = [
  { id: 'none', label: 'Normal', fn: [] },
  { id: 'warm', label: 'Warm', fn: [{ saturate: 1.1 }], tint: { color: '#FF9A3C', opacity: 0.16 } },
  { id: 'cool', label: 'Cool', fn: [{ saturate: 1.05 }], tint: { color: '#3C8CFF', opacity: 0.16 } },
  { id: 'mono', label: 'Mono', fn: [{ grayscale: 1 }] },
  { id: 'vivid', label: 'Vivid', fn: [{ saturate: 1.5 }, { contrast: 1.08 }] },
  { id: 'fade', label: 'Fade', fn: [{ contrast: 0.88 }, { saturate: 0.85 }], tint: { color: '#FFFFFF', opacity: 0.12 } },
  { id: 'noir', label: 'Noir', fn: [{ grayscale: 1 }, { contrast: 1.3 }], tint: { color: '#000000', opacity: 0.1 } },
];
export const filterOf = (n: FilterName | undefined) => FILTERS.find((f) => f.id === (n ?? 'none')) ?? FILTERS[0];

export const TEXT_COLORS = ['#FFFFFF', '#FFD166', '#FF4D6A', '#7CE0A3', '#6EC1FF', '#111214'];
export const TEXT_POSITIONS = [{ id: 'top', label: 'Top', x: 0.08, y: 0.12 }, { id: 'middle', label: 'Middle', x: 0.08, y: 0.45 }, { id: 'bottom', label: 'Bottom', x: 0.08, y: 0.72 }] as const;

export const isEdited = (e: PostEdit | null | undefined) => !!e && (e.filter !== 'none' || e.texts.length > 0 || e.trimStartMs !== undefined || e.trimEndMs !== undefined);
