// What the app knows about each gift without asking the server: its tier, a fallback price and the colour of its glow.
export type GiftSlug = 'spark' | 'rose' | 'gem' | 'crown' | 'rocket' | 'trophy' | 'supernova' | 'orbit';

export const GOLD = { light: '#FFF1C2', mid: '#E8C77A', deep: '#B88A3E', dark: '#6E4A17' } as const;

export const GIFT_META: Record<GiftSlug, { name: string; coins: number; tier: 1 | 2 | 3 | 4; glow: string }> = {
  spark: { name: 'Spark', coins: 1, tier: 1, glow: '#F3D58A' },
  rose: { name: 'Rose', coins: 5, tier: 1, glow: '#E2456B' },
  gem: { name: 'Gem', coins: 20, tier: 2, glow: '#7FD6FF' },
  crown: { name: 'Crown', coins: 50, tier: 2, glow: '#F0C45C' },
  rocket: { name: 'Rocket', coins: 100, tier: 3, glow: '#FF8A4C' },
  trophy: { name: 'Trophy', coins: 200, tier: 3, glow: '#F5CE6B' },
  supernova: { name: 'Supernova', coins: 500, tier: 4, glow: '#FF7AD1' },
  orbit: { name: 'Orbit', coins: 1000, tier: 4, glow: '#9B8CFF' },
};

export const metaFor = (slug: string) => GIFT_META[(slug in GIFT_META ? slug : 'spark') as GiftSlug];
