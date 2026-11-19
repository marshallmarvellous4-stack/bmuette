# BMUETTE mobile (Expo SDK 58)

White cards on polished black. Animated floating tab bar, graded haptics, video feed, market, product pages, checkout, shop, profile, upload and sell, **chat** and a **floating video player**.

## Run it
1. Start the backend first (see the root README): `docker compose up` in the project root, or in `apps/api`: `npm run migrate && npm start`.
2. In this folder:
   ```
   npm install
   copy NUL .env        (or create .env by hand)
   ```
   Put your computer's LAN address in `.env` so a real phone can reach the API:
   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
   ```
   (`ipconfig` shows it. Phone and computer must be on the same Wi-Fi.)
3. `npx expo start`, then scan the QR code with the Expo Go build that matches SDK 58.

## Where things live
- `src/theme/tokens.ts` colours, type, spacing. `haptics.ts` haptic kinds. `icons.tsx` icon set.
- `src/components/FloatingTabBar.tsx` the animated tab bar. `ui.tsx` shared building blocks.
- `src/api/` client (token refresh), React Query hooks, upload.
- `app/` screens (Expo Router): `(tabs)` Home, Chat, Market, You; `new` create sheet, `compose`, `sell`, `product/[id]`, `checkout/[id]`, `shop/[slug]`, `post/[id]`, `comments/[id]`.

## Chat
- Chat tab: list with unread counts, search, and a floating "+" that slides away as you scroll down.
- Thread: text, photos, shared products and posts, "Seen", and "Not sent. Tap to retry" on a bad network.
- "Message" on profiles and "Message seller" on products; "Send" on a video or product shares it into a chat.
- Messages arrive live over one WebSocket (`/ws`). If it drops, the app reconnects by itself and polls meanwhile.

## Floating video player
Tap the minimise button in the right rail of any video. It keeps playing in a small window above every screen: drag it anywhere (it snaps to a side), tap for controls (play/pause, mute, full screen, close). Full screen resumes at the same second.
`src/state/player.ts` holds the state; `src/components/MiniPlayer.tsx` is mounted once in `app/_layout.tsx`.
On the web, HLS (.m3u8) needs Safari or an hls.js shim; on iOS and Android it works as is.

## Not built yet
Voice notes, typing indicators, push notifications for new messages, event registration and QR tickets, merchant payouts, product animation templates, Android picture-in-picture outside the app.
