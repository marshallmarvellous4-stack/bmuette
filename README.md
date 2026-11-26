# BMUETTE backend

Video and photo content you can shop from. This folder holds everything needed to run and deploy the server side.

```
apps/api     NestJS + TypeScript API (accounts, profiles, uploads, posts, feed, marketplace, orders, payments)
apps/ai      Python service that powers search by photo and search by meaning (OpenCLIP)
brand/       App icon files (icon.png, adaptive icon, splash) and the SVG sources
docker-compose.yml   Runs Postgres (pgvector), Redis and the API on your computer
```

## Run it (easiest way)

1. Install Docker Desktop.
2. In this folder: `docker compose up --build`
3. Open http://localhost:3000/health. You should see `{"status":"ok"}`.

Add visual and meaning search: `docker compose --profile ai up --build`, then set `AI_SERVICE_URL=http://ai:8000` for the `api` service
(the first build downloads the AI model, which is a few GB).

## Run it without Docker

You need Node 22+, PostgreSQL 16 with the `pgvector` extension, and optionally Redis.

```
cd apps/api
cp ../../.env.example .env      # fill in DATABASE_URL and JWT_ACCESS_SECRET
npm ci
npm run build
npm run migrate                 # creates the tables
npm start
```

## Admin dashboard

Open `http://localhost:3000/admin/` (or your server's address + `/admin/`). It shows signups, active people, revenue and platform fees per currency,
orders and payment status, the messages Stripe and Flutterwave send, a live activity log, server errors and system health. It is read-only.

Only accounts flagged as admin can open it. Sign up in the app first, then flag yourself:

```
docker compose exec api node dist/db/make-admin.js you@example.com     # with Docker
npm run make-admin -- you@example.com                                    # without Docker, inside apps/api
```
Add `--remove` to take the flag away again; access ends immediately.

Things worth knowing: "active people" means anyone who liked, commented, posted, messaged, ordered, followed, watched or opened the app in the period.
Errors are kept for 30 days. Shipping addresses and passwords are never sent to the dashboard. Put a firewall rule or VPN in front of `/admin` once you launch if you can.

## Check that everything works

`npm run smoke` (inside `apps/api`) starts the real API against a real database and runs the checks across sign-up, uploads,
posts, feed, comments, follows, reports, marketplace, search, orders, payments and account deletion.
It needs `DATABASE_URL` pointing at an empty throwaway database, because it wipes the tables first.

## What the API does

| Area | Endpoints |
| --- | --- |
| Accounts | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; `GET/PATCH/DELETE /me` |
| People | `GET /users/:username`, follow / unfollow, block / unblock, followers, following |
| Uploads | `POST /media/uploads` (get a signed upload slot), `POST /media/:id/complete` |
| Posts | `POST /posts`, `GET /posts/:id`, like, save, comments, view, share, download, report |
| Feed | `GET /feed` (personalised or trending), `GET /feed/following` |
| Boards | `POST/GET /collections`, `GET /collections/:id/items` |
| Marketplace | `POST /merchants`, `GET /market`, `POST/PATCH /products`, `GET /products/:id/similar`, shop pages |
| Search | `GET /search`, `GET /search/suggest`, `POST /search/visual` (search by photo) |
| Orders | `POST /orders`, `POST /orders/quote`, `GET /orders/:id` (with tracking timeline), merchant orders, shipping and tracking updates, "mark received" |
| Cart | `GET/DELETE /cart`, `POST /cart/items`, `PATCH/DELETE /cart/items/:id`, `POST /cart/checkout` |
| Shop tools | `PUT /products/:id/variants`, `/merchant/discounts`, `/merchant/refunds`, `/merchant/balance`, `/merchant/ledger`, `/merchant/payouts` |
| Returns, reviews | `POST /order-items/:id/refund`, `GET/POST /products/:id/reviews`, `PATCH /reviews/:id/reply` |
| Notifications | `GET /notifications`, `/notifications/unread-count`, `POST /notifications/read`, `/push/register`, `/me/notification-settings` |
| Safety | `/auth/verify-email*`, `/auth/forgot-password`, `/auth/reset-password`, `POST /me/delete`, `/legal/terms|privacy|community` |
| Webhooks | `POST /webhooks/stripe`, `/webhooks/flutterwave`, `/webhooks/stream` |

A post can carry an action (`buy`, `book`, `enroll`, `join_event`, `order_food`, `expert`), which is how a video turns into a purchase.

## Money

- Nigerian Naira goes through **Flutterwave**. Other currencies go through **Stripe**.
- Webhooks are checked (signature or secret hash) and every payment is re-verified with the provider before an order is marked paid.
  A repeated webhook never counts a sale twice, and a payment for the wrong amount is refused.
- The platform fee is `PLATFORM_FEE_BPS` (500 = 5%), worked out on what the buyer actually paid (after any discount code).
  BMUETTE collects the money and writes every sale, fee, refund and payout into a ledger per shop.
- **Payouts:** a sale becomes available to the shop `PAYOUT_HOLD_DAYS` after payment (default 7). The shop adds bank details and asks for a payout;
  you see it in the admin dashboard under *Payouts & refunds*, send the bank transfer yourself, then press *Mark paid* with the transfer reference.
  Nothing moves money to shops automatically. Do this only after checking the marketplace/KYC rules in your country with an adviser.
- **Virtual gifts:** people buy coins (packs in `apps/api/src/gifts/wallet.service.ts`, paid through Flutterwave or Stripe) and send gifts from the comment sheet or the gift icon on a post.
  A gift shows in the comments as a premium row. The creator earns `CREATOR_COIN_MINOR` per coin (default ₦9; a coin costs ₦15 in the base pack, so BMUETTE keeps about 40%), held `GIFT_HOLD_DAYS` (14) and then paid out like shop money.
  Gifts and coin purchases need a verified email and 18+. Coins are bought through the web payment page; if you ship on the App Store or Google Play, check their in-app purchase rules for digital goods before launch.
- **Returns and refunds:** buyers can ask within `RETURN_WINDOW_DAYS` (default 14) of delivery, or a week after paying if nothing arrived.
  The shop (or an admin) approves; the refund goes back through Flutterwave or Stripe. If the provider fails, the request stays "approved" with the error
  and an admin can retry from the dashboard. Shipping fees are not modelled yet.
- Use test keys until you have checked each country's rules for marketplaces, KYC and tax with a qualified adviser.

### Webhook addresses to register
- Stripe: `https://YOUR-API/webhooks/stripe` (events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`)
- Flutterwave: `https://YOUR-API/webhooks/flutterwave` (set the same "secret hash" as `FLW_WEBHOOK_HASH`)
- Cloudflare Stream: `https://YOUR-API/webhooks/stream`

## Deploying for real

1. **Database:** managed PostgreSQL 16 with `pgvector` (Neon, Supabase, AWS RDS, or a Docker volume on a VPS). Run `npm run migrate` on every deploy; the Dockerfile already does this on start.
2. **API:** build `apps/api/Dockerfile` and run it on Fly.io, Railway, Render, AWS or a VPS behind HTTPS. Set the variables from `.env.example`.
3. **Images:** Cloudflare R2 (set `STORAGE_DRIVER=s3` and the `S3_*` values). **Video:** Cloudflare Stream (`VIDEO_DRIVER=cloudflare`).
   The API refuses to start in production with the `local` drivers.
4. **AI service:** `apps/ai` on a machine with 2+ GB RAM. Set `AI_ALLOWED_HOSTS` to your media domain.
5. **Secrets:** never commit `.env`. Rotate `JWT_ACCESS_SECRET` if it ever leaks.

## Email, push and moderation

- `EMAIL_DRIVER=log` (development) writes emails to the `email_outbox` table; read the codes in the admin **System** tab. For production use `EMAIL_DRIVER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`.
- `PUSH_DRIVER=log` (default) only logs. `PUSH_DRIVER=expo` sends real phone notifications through Expo. They do **not** work in Expo Go on Android; use a development or production build (`eas build`). The in-app Activity tab and unread badge work everywhere.
- The Terms, Privacy Policy and Community Rules are served at `/legal/*`. They are starting drafts. **Have a lawyer review them** before launch and set `SUPPORT_EMAIL` and `LEGAL_ENTITY_NAME`.
- Moderation (hide/remove posts, ban people, resolve reports) and all payout/refund decisions are in the admin dashboard and recorded in an audit log.
- Age rule: people under `MIN_AGE` (13) cannot sign up; buying and selling need a verified email and age 18+. Only "18 or over" is stored, never the birth date.

## Honest status

Tested end to end here (about 200 checks): accounts, sessions, uploads, posts, feed, interactions, reports, marketplace, search, orders, webhooks,
the admin dashboard (its numbers are compared with the database), chat (messages, live delivery over WebSocket, read receipts, retries without duplicates, blocking), account deletion, a production-style build with Redis, and the AI service's contract and its protection against fetching private addresses.

**Not yet tested against the real thing**, because it needs your accounts: live Flutterwave and Stripe sandbox payments, Cloudflare R2 and Stream,
the real CLIP model (the checks use a stand-in), and the Docker images themselves. Expect to spend an hour on each when you connect them.

Chat runs on one WebSocket endpoint (`/ws`). With `REDIS_URL` set, live messages reach people connected to any server; without it, run a single API server.
Proxies and load balancers must allow WebSocket upgrades on `/ws`.

Also tested here (389 backend checks in total): notifications and unread counts, typing and voice notes, hashtags and trending, boards, the cart, variants and stock, discount codes,
tracking, refunds (including a provider outage and retry), reviews and ratings, payouts and the ledger, and products tagged in videos. The Stripe refund path is written but untested (no Stripe account here); the Flutterwave one runs against a fake.

Not built yet: Stories (the feed has a Following | For You switch instead), shipping fees and tax, event registration forms and QR check-in (tickets can already be sold as products), automatic bank payouts,
music licensing (the sound library ships a few generated loops; licensed music is your responsibility), video trimming that re-encodes the file (trim, filter and text are applied when playing).

The mobile app (`apps/mobile`) is built and was driven end to end in a browser against this backend; it has not been run on a physical phone yet, so haptics and animation feel are unchecked.
