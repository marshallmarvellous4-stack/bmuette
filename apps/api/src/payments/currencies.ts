// Only currencies with two decimal places for now, so "minor units" always means cents/kobo/pesewas.
// Zero- and three-decimal currencies (UGX, JPY, KWD...) need their own handling before they are added here.
export const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

// Local African payments (cards, bank transfer, USSD, mobile money) go through Flutterwave. Everything else is Stripe.
const FLUTTERWAVE: Currency[] = ['NGN', 'GHS', 'KES', 'ZAR'];
export const providerFor = (currency: string): 'flutterwave' | 'stripe' =>
  FLUTTERWAVE.includes(currency as Currency) ? 'flutterwave' : 'stripe';
