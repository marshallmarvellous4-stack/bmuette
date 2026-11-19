// Keyset pagination: the cursor encodes the last row's (created_at, id).
export function encodeCursor(createdAt: Date | string, id: string): string {
  const t = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${t}|${id}`).toString('base64url');
}
export function decodeCursor(cursor?: string): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [t, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    if (!t || !id || Number.isNaN(Date.parse(t))) return null;
    return { t, id };
  } catch {
    return null;
  }
}
export function clampLimit(raw: unknown, def = 20, max = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}
