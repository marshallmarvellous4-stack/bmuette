// The text of the legal pages served at /legal/terms, /legal/privacy and /legal/community.
// This is a working draft for launch. Have a lawyer in your country review it before you publish the app.
export const TERMS_VERSION = '2026-11-16';

type Ctx = { entity: string; support: string };

const page = (title: string, body: string, c: Ctx) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · BMUETTE</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; margin: 0; background: #0b0b0d; color: #e9e9ee; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 30px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 19px; margin: 32px 0 6px; }
  p, li { color: #c9c9d1; }
  .meta { color: #8b8b96; font-size: 14px; margin-bottom: 24px; }
  a { color: #fff; }
  nav a { margin-right: 16px; font-size: 14px; }
  @media (prefers-color-scheme: light) { body { background: #fff; color: #111; } p, li { color: #333; } a { color: #000; } .meta { color: #666; } }
</style></head><body><main>
<nav><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="/legal/community">Community rules</a></nav>
<h1>${title}</h1>
<div class="meta">Version ${TERMS_VERSION} · ${c.entity}</div>
${body}
</main></body></html>`;

export function termsPage(c: Ctx) {
  return page('Terms of Use', `
<p>These terms are an agreement between you and ${c.entity} ("we", "us"), the maker of BMUETTE. By creating an account you agree to them and to our <a href="/legal/privacy">Privacy Policy</a> and <a href="/legal/community">Community Rules</a>.</p>
<h2>Who can use BMUETTE</h2>
<p>You must be old enough to use the app where you live, and never younger than the minimum age shown when you sign up. You must be 18 or over to open a shop or buy things. You are responsible for your account and for keeping your password safe.</p>
<h2>Your content</h2>
<p>You keep ownership of the videos, photos, comments and messages you post. You give us a worldwide licence to host, show, resize and deliver them so the app works, including showing them to other people on BMUETTE. Only post what you have the right to post. We can remove content that breaks these terms or the Community Rules.</p>
<h2>Buying and selling</h2>
<p>When you buy, you pay the seller through our payment partners (Stripe or Flutterwave). Sellers are responsible for what they list, for delivering it, and for their local taxes and laws. We charge sellers a platform fee on each sale, shown before they list. Refund and return requests follow the policy shown on the order screen. Payouts to sellers are released after delivery and a short holding period.</p>
<h2>What you must not do</h2>
<p>Do not break the law, harass others, post counterfeit or dangerous goods, scam buyers or sellers, spread malware, scrape the app, or try to get into accounts or systems that are not yours.</p>
<h2>Suspension and deletion</h2>
<p>We may suspend or remove accounts that break these terms. You can delete your account at any time in Settings. Deleting removes your profile and posts from public view and erases your personal details. We keep order and payment records for as long as the law requires.</p>
<h2>Our responsibility</h2>
<p>BMUETTE is provided "as is". To the extent the law allows, we are not responsible for what users post, for transactions between buyers and sellers beyond the protections described in the app, or for losses from things outside our control. Nothing in these terms limits rights you have under consumer law that cannot be waived.</p>
<h2>Changes and contact</h2>
<p>We may update these terms. When we make a big change we will tell you in the app. Questions: <a href="mailto:${c.support}">${c.support}</a>.</p>`, c);
}

export function privacyPage(c: Ctx) {
  return page('Privacy Policy', `
<p>This explains what ${c.entity} collects when you use BMUETTE, why, and what you can do about it.</p>
<h2>What we collect</h2>
<ul>
<li><b>Account details:</b> email, username, display name, country, password (stored only as a one-way hash), and whether you are 18 or over. We do not store your birth date.</li>
<li><b>Your content:</b> posts, photos, videos, comments, likes, saves, follows, messages and voice notes.</li>
<li><b>Shopping:</b> orders, delivery addresses, reviews, and payout details if you sell. Card details go straight to Stripe or Flutterwave; we never see or store full card numbers.</li>
<li><b>Using the app:</b> what you watch and search so we can personalise your feed, notification settings, a device token to send push notifications, and technical logs for security and fixing errors.</li>
</ul>
<h2>Why we use it</h2>
<p>To run the app, show you relevant content, process orders and payouts, send the codes and notifications you ask for, keep people safe, and meet legal duties. We do not sell your personal information.</p>
<h2>Who we share it with</h2>
<p>Service providers who help us run BMUETTE, under contract: hosting and video delivery (Cloudflare), payments (Stripe, Flutterwave), email (Resend), and push notifications (Expo). Sellers receive the name, phone number and address needed to deliver your order. Your public profile and posts are visible to other users.</p>
<h2>Your choices and rights</h2>
<p>You can edit your profile, change notification settings, block and report people, and delete your account in Settings. Where the law gives you the right to access, correct, export or delete your data (including under the Nigeria Data Protection Act 2023 and similar laws), email us at <a href="mailto:${c.support}">${c.support}</a>.</p>
<h2>How long we keep data</h2>
<p>Account data until you delete your account. After deletion we erase personal details and keep order and payment records only as long as tax and fraud rules require.</p>
<h2>Children</h2>
<p>BMUETTE is not for children under the minimum age. If you think a child has signed up, tell us and we will remove the account.</p>
<h2>Contact</h2>
<p>${c.entity} · <a href="mailto:${c.support}">${c.support}</a></p>`, c);
}

export function communityPage(c: Ctx) {
  return page('Community Rules', `
<p>BMUETTE is for sharing and shopping. Keep it safe and honest.</p>
<h2>Not allowed</h2>
<ul>
<li>Sexual content involving anyone under 18, or any sexual content that is not clearly adult and consensual. Nudity is not allowed.</li>
<li>Threats, hate, harassment, bullying, or encouraging violence or self-harm.</li>
<li>Scams, fake or counterfeit products, stolen goods, weapons, illegal drugs, and anything illegal to sell where you or the buyer live.</li>
<li>Spam, fake reviews, and impersonating other people or brands.</li>
<li>Posting other people's private information or content you do not have the right to share.</li>
</ul>
<h2>Reporting and blocking</h2>
<p>Use the menu on any post, product, comment or profile to report it or block the person. Blocking is private. We review reports and may remove content, limit accounts, or suspend repeat offenders.</p>
<h2>Sellers</h2>
<p>Describe items honestly, ship what you sold, answer buyers, and honour refunds you have agreed to. Accounts with many valid complaints can lose selling rights.</p>
<p>Questions or appeals: <a href="mailto:${c.support}">${c.support}</a></p>`, c);
}
