// Plain rules about orders, kept in one place so the app and the server agree.

/** Can the buyer ask for money back on this line right now? */
export function canRequestRefund(item: { fulfilment: string; delivered_at: any; refund_status?: string | null }, order: { status: string; paid_at: any }, windowDays: number, now = Date.now()): boolean {
  if (order.status !== 'paid' && order.status !== 'refunded') return false;
  if (item.fulfilment === 'cancelled') return false;
  if (item.refund_status && item.refund_status !== 'rejected') return false;
  const day = 86_400_000;
  if (item.fulfilment === 'delivered') return !!item.delivered_at && now - new Date(item.delivered_at).getTime() <= windowDays * day;
  // Never arrived: allowed a week after paying.
  return !!order.paid_at && now - new Date(order.paid_at).getTime() >= 7 * day;
}

/** Split a discount across lines in proportion to their value. The last line takes the rounding leftovers. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let i = out.length - 1; left > 0 && i >= 0; i--) { const add = Math.min(left, weights[i] - out[i]); out[i] += add; left -= add; }
  return out;
}
