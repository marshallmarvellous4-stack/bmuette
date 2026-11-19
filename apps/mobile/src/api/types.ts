export type PublicUser = { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null; country: string | null; isMerchant: boolean; followerCount: number; followingCount: number };
export type Me = PublicUser & { email: string; isAdmin: boolean; emailVerified: boolean; isAdult: boolean; merchant: { shopName: string; slug: string; verified: boolean } | null };
export type Profile = PublicUser & { postCount: number; merchant: { shopName: string; slug: string; verified: boolean } | null; viewer: { following: boolean; followsYou: boolean; blocked: boolean } | null };
export type AuthResult = { user: Me; accessToken: string; refreshToken: string };

export type Media = { id: string; kind: 'image' | 'video'; url: string | null; thumbUrl: string | null; width: number | null; height: number | null; durationMs: number | null };
export type CtaKind = 'buy' | 'book' | 'enroll' | 'join_event' | 'order_food' | 'expert';
export type Cta = { kind: CtaKind; productId?: string; label?: string };

export type Post = {
  id: string; kind: 'video' | 'photo'; caption: string; tags: string[]; cta: Cta | null; allowDownload: boolean; status: string; createdAt: string;
  counts: { likes: number; comments: number; saves: number; shares: number; views: number };
  author: { id: string; username: string; displayName: string; avatarUrl: string | null; isMerchant: boolean };
  media: Media[];
  viewer: { liked: boolean; saved: boolean; following: boolean };
  sound: Sound | null; soundVolume: number; originalVolume: number; edit: PostEdit | null;
  products?: TaggedProduct[];
};
export type TaggedProduct = { id: string; title: string; priceMinor: number; currency: string; atMs: number | null; inStock: boolean; hasVariants: boolean; thumbUrl: string | null };
export type Sound = { id: string; title: string; artist: string; url: string; durationMs: number; color: string | null; mood?: string | null; bpm?: number | null; uses?: number };
export type FilterName = 'none' | 'warm' | 'cool' | 'mono' | 'vivid' | 'fade' | 'noir';
export type TextOverlay = { text: string; x: number; y: number; color: string; size: number };
export type PostEdit = { trimStartMs?: number; trimEndMs?: number; filter: FilterName; texts: TextOverlay[] };
export type Board = { id: string; name: string; itemCount: number; covers: string[] };
export type SavedProduct = { id: string; title: string; priceMinor: number; currency: string; image: string | null };
export type PersonHit = { id: string; username: string; displayName: string; avatarUrl: string | null; isMerchant: boolean; followerCount: number };

export type Rating = { avg: number; count: number };
export type Variant = { id: string; label: string; options: Record<string, string>; priceMinor: number | null; stock: number | null; inStock: boolean };
export type Money = { amountMinor: number; currency: string };
export type Product = {
  id: string; title: string; description: string; kind: 'physical' | 'digital' | 'service' | 'course' | 'ticket' | 'food'; price: Money;
  stock: number | null; inStock: boolean; category: string; tags: string[]; status: string; postId: string | null;
  counts: { likes: number; saves: number; sold: number };
  merchant: { userId: string; shopName: string; slug: string; verified: boolean; country: string | null; avatarUrl: string | null; rating?: Rating };
  media: Media[];
  viewer: { saved: boolean };
  variants?: Variant[]; rating?: Rating;
};

export type Comment = { id: string; parentId: string | null; body: string; createdAt: string; author: { id: string; username: string; displayName: string; avatarUrl: string | null } };
export type Page<T> = { items: T[]; nextCursor?: string | null };
export type CheckoutResult = { order: { id: string; status: string }; checkout: { provider: string; url: string } };
