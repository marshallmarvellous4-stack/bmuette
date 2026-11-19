const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'UGX', 'RWF', 'XAF', 'XOF']);
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const value = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: digits, minimumFractionDigits: value % 1 === 0 ? 0 : digits }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}
export const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));
export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
