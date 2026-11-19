// End-to-end smoke test: boots the real API against a real Postgres and walks the main user journeys.
// Fake Flutterwave and AI servers stand in for the outside world. Run: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import Stripe from 'stripe';

const DB = process.env.DATABASE_URL!;
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
const fail = (m: string): never => { console.error(`  FAIL  ${m}`); process.exit(1); };
const ok = (cond: unknown, name: string) => { if (!cond) fail(name); passed++; console.log(`  ok    ${name}`); };
const section = (s: string) => console.log(`\n${s}`);

async function call(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: Buffer | string } = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  let body: any;
  if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.body); }
  const res = await fetch(BASE + path, { method, headers, body });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// ---- fake outside world ----
const flwTx = new Map<string, { status: string; tx_ref: string; amount: number; currency: string }>();
const flw = createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v3/payments') {
      const p = JSON.parse(b);
      flwTx.set(p.tx_ref, { status: 'pending', tx_ref: p.tx_ref, amount: p.amount, currency: p.currency });
      return res.end(JSON.stringify({ status: 'success', data: { link: `https://checkout.fake/${p.tx_ref}` } }));
    }
    const m = req.url?.match(/^\/v3\/transactions\/(\d+)\/verify/);
    if (m) {
      const tx = [...flwTx.values()].find((t) => (t as any).id === m[1]);
      return res.end(JSON.stringify(tx ? { status: 'success', data: { id: m[1], ...tx } } : { status: 'error' }));
    }
    if (req.method === 'GET' && req.url?.startsWith('/v3/transactions/verify_by_reference')) {
      const ref = new URL(req.url, 'http://x').searchParams.get('tx_ref')!;
      const tx = flwTx.get(ref) as any;
      return res.end(JSON.stringify(tx?.id ? { status: 'success', data: { id: Number(tx.id), ...tx } } : { status: 'error' }));
    }
    const rf = req.url?.match(/^\/v3\/transactions\/(\d+)\/refund/);
    if (rf && req.method === 'POST') {
      if (flwRefundFail) { res.statusCode = 500; return res.end(JSON.stringify({ status: 'error', message: 'provider down' })); }
      flwRefunds.push({ id: rf[1], amount: JSON.parse(b).amount });
      return res.end(JSON.stringify({ status: 'success' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
let flwRefundFail = false;
const flwRefunds: { id: string; amount: number }[] = [];
// Deterministic fake "CLIP": words hash into a 512-number vector, so similar words land close together.
const embedWords = (s: string) => {
  const v = new Array(512).fill(0);
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 7; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 512] += 1; v[(h >>> 9) % 512] += 0.5;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};
const ai = createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', async () => {
    const p = JSON.parse(b || '{}');
    res.setHeader('content-type', 'application/json');
    // The fake "image model" reads the uploaded file's bytes: a file labelled SNEAKER looks like a sneaker.
    let text = p.text;
    if (req.url !== '/embed/text') {
      const body = await fetch(String(p.url)).then((r) => r.text()).catch(() => '');
      text = body.includes('SNEAKER') ? 'sneakers shoes' : 'generic';
    }
    res.end(JSON.stringify({ embedding: embedWords(text) }));
  });
});
const listen = (s: ReturnType<typeof createServer>, port: number) => new Promise<void>((r) => s.listen(port, r));

let o3 = '';
async function main() {
  await listen(flw, 3102); await listen(ai, 3101);
  const pool = new Pool({ connectionString: DB });
  await pool.query('truncate users, media_assets, payment_events, searches, email_outbox, admin_actions, error_log restart identity cascade');
  await pool.query('update sounds set use_count = 0');

  const env = {
    ...process.env, NODE_ENV: 'test', PORT: String(PORT), DATABASE_URL: DB, JWT_ACCESS_SECRET: 'x'.repeat(40),
    PAYOUT_HOLD_DAYS: '0', PUBLIC_BASE_URL: BASE, STORAGE_DRIVER: 'local', VIDEO_DRIVER: 'local',
    AI_SERVICE_URL: 'http://localhost:3101', FLW_SECRET_KEY: 'flw_test', FLW_WEBHOOK_HASH: 'whash', FLW_BASE_URL: 'http://localhost:3102',
    STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_testsecret', CHECKOUT_RETURN_URL: 'bmuette://checkout',
    CF_STREAM_WEBHOOK_SECRET: 'cfsecret',
  };
  const server = spawn('node', ['dist/main.js'], { env: env as any, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', (d) => (logs += d)); server.stderr.on('data', (d) => (logs += d));
  const stop = async () => { server.kill(); flw.close(); ai.close(); await pool.end(); };
  process.on('exit', () => server.kill());
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); if (i === 59) fail('API did not start:\n' + logs); }

  try {
    // ---------------------------------------------------------------- auth
    section('Auth');
    const mk = async (name: string) => {
      const r = await call('POST', '/auth/register', { body: { email: `${name}@test.dev`, password: 'correct horse', username: name, displayName: name.toUpperCase(), country: 'NG', birthDate: '1995-05-05', acceptTerms: true } });
      if (r.status !== 201) fail(`register ${name}: ${r.status} ${r.text}`);
      // Buying and selling need a verified email. The real verification flow is tested in "Accounts and safety".
      await pool.query('update users set email_verified_at = now() where lower(username) = $1', [name]);
      return r.json as { user: any; accessToken: string; refreshToken: string };
    };
    const A = await mk('ada'); const B = await mk('bola'); const C = await mk('chi');
    const tc2 = () => C.accessToken;
    ok(A.accessToken && A.refreshToken, 'register returns tokens');
    ok((await call('POST', '/auth/register', { body: { email: 'ADA@test.dev', password: 'correct horse', username: 'ada2', displayName: 'x', birthDate: '1995-05-05', acceptTerms: true } })).status === 409, 'duplicate email (any case) is rejected');
    ok((await call('POST', '/auth/register', { body: { email: 'z@test.dev', password: 'short', username: 'zed', displayName: 'x', birthDate: '1995-05-05', acceptTerms: true } })).status === 400, 'short password is rejected');
    ok((await call('POST', '/auth/login', { body: { email: 'ada@test.dev', password: 'wrong password' } })).status === 401, 'wrong password is rejected');
    ok((await call('GET', '/me')).status === 401, 'protected route needs a token');
    const rf = await call('POST', '/auth/refresh', { body: { refreshToken: A.refreshToken } });
    ok(rf.status === 200 && rf.json.refreshToken !== A.refreshToken, 'refresh rotates the token');
    ok((await call('POST', '/auth/refresh', { body: { refreshToken: A.refreshToken } })).status === 401, 'reusing an old refresh token fails');
    ok((await call('POST', '/auth/refresh', { body: { refreshToken: rf.json.refreshToken } })).status === 401, '...and ends the whole session family');
    const a = (await call('POST', '/auth/login', { body: { email: 'ada@test.dev', password: 'correct horse' } })).json;
    const ta = a.accessToken, tb = B.accessToken, tc = C.accessToken;
    ok((await call('GET', '/me', { token: ta })).json.username === 'ada', 'GET /me');
    ok((await call('PATCH', '/me', { token: ta, body: { bio: 'Shoe plug' } })).json.bio === 'Shoe plug', 'update profile');

    // ---------------------------------------------------------------- media
    section('Uploads');
    const upload = async (token: string, kind: 'image' | 'video' | 'audio', label = 'x', finish = true) => {
      const mime = kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/mp4' : 'video/mp4';
      const bytes = Buffer.from(`${label}-${randomBytes(6).toString('hex')}`);
      const slot = await call('POST', '/media/uploads', { token, body: { kind, mime, bytes: bytes.length, width: 1080, height: 1350 } });
      if (slot.status !== 201) fail(`upload slot: ${slot.status} ${slot.text}`);
      const put = async () => (await fetch(slot.json.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: bytes })).status;
      if (finish) {
        if ((await put()) !== 200) fail('PUT upload');
        const done = await call('POST', `/media/${slot.json.id}/complete`, { token });
        if (done.json?.status !== 'ready') fail('complete: ' + done.text);
      }
      return { id: slot.json.id as string, put };
    };
    ok((await call('POST', '/media/uploads', { token: ta, body: { kind: 'image', mime: 'application/pdf', bytes: 10 } })).status === 400, 'rejects unsupported file types');
    ok((await call('POST', '/media/uploads', { token: ta, body: { kind: 'image', mime: 'image/png', bytes: 99_000_000 } })).status === 400, 'rejects oversized files');
    const img1 = await upload(ta, 'image', 'SNEAKER-photo');
    const slotOnly = await call('POST', `/media/${img1.id}/complete`, { token: tb });
    ok(slotOnly.status === 403, "someone else cannot complete your upload");
    const vid1 = await upload(ta, 'video', 'clip');
    const early = await upload(ta, 'image', 'late', false);
    const leaked = await call('POST', `/media/${early.id}/complete`, { token: ta });
    ok(leaked.status === 400, 'complete before the file arrives is refused');

    // ---------------------------------------------------------------- posts
    section('Posts');
    const p1 = await call('POST', '/posts', { token: ta, body: { kind: 'photo', caption: 'Fresh white sneakers drop', tags: ['#Sneakers', 'fashion'], mediaIds: [img1.id] } });
    ok(p1.status === 201 && p1.json.status === 'published' && p1.json.tags.includes('sneakers'), 'photo post is published, tags normalised');
    const p2 = await call('POST', '/posts', { token: ta, body: { kind: 'video', caption: 'Unboxing day', tags: ['sneakers'], mediaIds: [vid1.id] } });
    ok(p2.status === 201, 'video post');
    ok((await call('POST', '/posts', { token: ta, body: { kind: 'photo', mediaIds: [img1.id] } })).status === 400, 'a file cannot be used in two posts');
    ok((await call('POST', '/posts', { token: tb, body: { kind: 'photo', mediaIds: [early.id] } })).status === 400, "cannot post someone else's file");
    const pending = await call('POST', '/posts', { token: ta, body: { kind: 'photo', caption: 'waiting for upload', tags: ['wait'], mediaIds: [early.id] } });
    ok(pending.json.status === 'pending', 'post waits as pending while media is not ready');
    ok((await call('GET', `/posts/${pending.json.id}`, { token: tb })).status === 404, '...and is hidden from others');
    ok(await early.put() === 200, 'late upload arrives');
    await call('POST', `/media/${early.id}/complete`, { token: ta });
    ok((await call('GET', `/posts/${pending.json.id}`, { token: tb })).json.status === 'published', '...then publishes by itself');

    // ---------------------------------------------------------------- shop
    section('Marketplace');
    ok((await call('POST', '/products', { token: ta, body: {} })).status === 400, 'validation on product body');
    const shop = await call('POST', '/merchants', { token: ta, body: { shopName: 'Ada Kicks', slug: 'ada-kicks', description: 'Clean pairs', country: 'ng' } });
    ok(shop.status === 201 && shop.json.slug === 'ada-kicks', 'open a shop');
    ok((await call('POST', '/merchants', { token: tb, body: { shopName: 'Dup', slug: 'ada-kicks', country: 'NG' } })).status === 409, 'shop link must be unique');
    ok((await call('POST', '/products', { token: tb, body: { title: 'Nope', kind: 'physical', priceMinor: 100, currency: 'NGN', mediaIds: [img1.id] } })).status === 403, 'only merchants can list products');
    const pimg = await upload(ta, 'image', 'SNEAKER-product');
    const prod = await call('POST', '/products', { token: ta, body: { title: 'White Court Sneakers', description: 'Leather, size 38 to 45', kind: 'physical', priceMinor: 4500000, currency: 'NGN', stock: 3, category: 'Fashion', tags: ['sneakers', 'shoes'], mediaIds: [pimg.id] } });
    ok(prod.status === 201 && prod.json.price.amountMinor === 4500000, 'create product');
    const mug = await call('POST', '/products', { token: ta, body: { title: 'Ceramic Mug', kind: 'physical', priceMinor: 250000, currency: 'NGN', stock: 10, category: 'Home', tags: ['kitchen'], mediaIds: [(await upload(ta, 'image', 'mug')).id] } });
    ok(mug.status === 201, 'second product');
    ok((await call('POST', '/products', { token: ta, body: { title: 'Yen Thing', kind: 'physical', priceMinor: 100, currency: 'JPY', mediaIds: [pimg.id] } })).status === 400, 'unsupported currency rejected');
    const cta = await call('POST', '/posts', { token: ta, body: { kind: 'photo', caption: 'Shop the look', tags: ['sneakers'], mediaIds: [(await upload(ta, 'image', 'look')).id], cta: { kind: 'buy', productId: prod.json.id, label: 'Buy now' } } });
    ok(cta.status === 201 && cta.json.cta.productId === prod.json.id, 'post with a Buy action');
    ok((await call('POST', '/posts', { token: ta, body: { kind: 'photo', mediaIds: [(await upload(ta, 'image', 'look2')).id], cta: { kind: 'book', productId: prod.json.id } } })).status === 400, 'a Book action cannot point at a physical product');
    ok((await call('GET', `/products/${prod.json.id}`)).json.postId === cta.json.id, 'product links to the video that sells it');
    const grid = await call('GET', '/market', { token: tb });
    ok(grid.json.items.length === 2, 'marketplace grid lists active products');
    ok((await call('GET', '/market?category=home')).json.items.length === 1, 'category filter');
    ok((await call('GET', '/shops/ada-kicks')).json.products.length === 2, 'public shop page');
    ok((await call('POST', `/products/${prod.json.id}/save`, { token: tb })).json.saved === true, 'save product');

    // ---------------------------------------------------------------- feed + interactions
    section('Feed and interactions');
    ok((await call('POST', '/users/ada/follow', { token: tb })).json.following === true, 'follow');
    ok((await call('GET', '/users/ada')).json.followerCount === 1, 'follower count');
    ok((await call('POST', '/users/bola/follow', { token: tb })).status === 400, 'cannot follow yourself');
    const feed1 = await call('GET', '/feed?limit=10', { token: tb });
    const ids1 = feed1.json.items.map((x: any) => x.id);
    ok(ids1.length >= 4 && ids1.includes(p1.json.id) && ids1.includes(p2.json.id), 'feed returns the followed creator’s posts');
    ok(!ids1.some((id: string) => feed1.json.items.find((x: any) => x.id === id).author.username === 'bola'), 'feed never shows your own posts');
    const seen = await pool.query('select count(*)::int n from impressions where user_id = $1', [B.user.id]);
    ok(seen.rows[0].n === ids1.length, 'every post shown is recorded as an impression');
    const feed2 = await call('GET', '/feed?limit=10', { token: tb });
    ok(feed2.status === 200 && feed2.json.items.length > 0, 'feed never comes back empty (recycles seen posts)');
    ok((await call('GET', '/feed')).json.items.length > 0, 'signed-out visitors get a trending feed');
    const like = await call('POST', `/posts/${p1.json.id}/like`, { token: tb });
    ok(like.json.likes === 1, 'like');
    ok((await call('POST', `/posts/${p1.json.id}/like`, { token: tb })).json.likes === 1, 'liking twice does not double count');
    const interest = await pool.query(`select weight from user_interests where user_id = $1 and tag = 'sneakers'`, [B.user.id]);
    ok(interest.rows[0]?.weight >= 1, 'a like teaches the interest profile');
    ok((await call('DELETE', `/posts/${p1.json.id}/like`, { token: tb })).json.likes === 0, 'unlike');
    ok((await call('POST', `/posts/${p1.json.id}/save`, { token: tb, body: {} })).json.saved, 'save post');
    const board = await call('POST', '/collections', { token: tb, body: { name: 'Style' } });
    await call('POST', `/posts/${p2.json.id}/save`, { token: tb, body: { collectionId: board.json.id } });
    ok((await call('GET', `/collections/${board.json.id}/items`, { token: tb })).json.posts.length === 1, 'boards hold saved posts');
    const c1 = await call('POST', `/posts/${p1.json.id}/comments`, { token: tb, body: { body: 'These are clean!' } });
    ok(c1.status === 201 && c1.json.author.username === 'bola', 'comment');
    const r1 = await call('POST', `/posts/${p1.json.id}/comments`, { token: ta, body: { body: 'Thank you', parentId: c1.json.id } });
    ok(r1.status === 201 && r1.json.parentId === c1.json.id, 'reply');
    ok((await call('GET', `/posts/${p1.json.id}`)).json.counts.comments === 2, 'comment count');
    ok((await call('DELETE', `/comments/${c1.json.id}`, { token: tc })).status === 403, "cannot delete someone else's comment");
    ok((await call('DELETE', `/comments/${c1.json.id}`, { token: tb })).status === 204, 'delete own comment');
    ok((await call('GET', `/posts/${p1.json.id}`)).json.counts.comments === 0, 'replies go with their parent');
    const before = (await call('GET', `/posts/${p2.json.id}`)).json.counts.views;
    await call('POST', `/posts/${p2.json.id}/view`, { token: tb, body: { watchMs: 9000, completion: 0.95, replays: 1 } });
    ok((await call('GET', `/posts/${p2.json.id}`)).json.counts.views === before + 1, 'watch event counts a view');
    ok((await call('POST', `/posts/${p1.json.id}/download`, { token: tb })).status === 403, 'downloads are off unless the creator allows them');
    ok((await call('GET', '/feed/following', { token: tb })).json.items.length >= 3, 'following feed');

    // ---------------------------------------------------------------- moderation
    section('Reports and blocking');
    const spam = await call('POST', '/posts', { token: tc, body: { kind: 'photo', caption: 'buy followers', tags: ['spam'], mediaIds: [(await upload(tc, 'image', 'spam')).id] } });
    const reporters = [A, B, ...(await Promise.all(['dee1', 'dee2', 'dee3'].map(mk)))];
    for (const r of reporters) await call('POST', '/reports', { token: r.accessToken, body: { postId: spam.json.id, reason: 'spam' } });
    await call('POST', '/reports', { token: reporters[0].accessToken, body: { postId: spam.json.id, reason: 'spam' } });
    const held = await pool.query('select status, report_count from posts where id = $1', [spam.json.id]);
    ok(held.rows[0].report_count === 5 && held.rows[0].status === 'held', 'five different reporters hold a post (a repeat report does not count)');
    ok((await call('GET', `/posts/${spam.json.id}`, { token: tb })).status === 404, 'held posts disappear');
    ok((await call('POST', '/users/chi/block', { token: tb })).json.blocked, 'block a user');

    // ---------------------------------------------------------------- search
    section('Search');
    await new Promise((r) => setTimeout(r, 1500)); // let background embedding finish
    const emb = await pool.query('select count(*)::int n from products where embedding is not null');
    ok(emb.rows[0].n === 2, 'products were embedded by the AI service');
    const s1 = await call('GET', '/search?q=sneakers', { token: tb });
    ok(s1.json.semantic === true && s1.json.products[0]?.title === 'White Court Sneakers', 'text + meaning search finds the sneaker first');
    ok(s1.json.posts.length >= 2, '...and the matching posts');
    ok((await call('GET', '/search?q=ada&type=users')).json.users[0].username === 'ada', 'people search');
    ok((await call('GET', '/search/suggest?q=sne')).json.items.some((i: any) => i.text === 'sneakers'), 'suggestions');
    ok((await call('GET', '/search?q=a')).status === 400, 'too-short query rejected');
    const photo = await upload(tb, 'image', 'SNEAKER-from-camera');
    const vs = await call('POST', '/search/visual', { token: tb, body: { mediaId: photo.id } });
    ok(vs.status === 200 && vs.json.products[0]?.title === 'White Court Sneakers', 'search by photo returns the matching product');
    const sim = await call('GET', `/products/${prod.json.id}/similar`);
    ok(sim.status === 200 && sim.json.items.every((i: any) => i.id !== prod.json.id), 'similar products never include itself');

    // ---------------------------------------------------------------- orders
    section('Orders and payments');
    const ship = { name: 'Bola A', phone: '+2348000000000', line1: '12 Allen Ave', city: 'Ikeja', country: 'NG' };
    ok((await call('POST', '/orders', { token: tb, body: { items: [{ productId: prod.json.id, qty: 1 }] } })).status === 400, 'physical goods need an address');
    ok((await call('POST', '/orders', { token: ta, body: { items: [{ productId: prod.json.id, qty: 1 }], shipping: ship } })).status === 400, 'cannot buy your own product');
    ok((await call('POST', '/orders', { token: tb, body: { items: [{ productId: prod.json.id, qty: 5 }], shipping: ship } })).status === 400, 'cannot order more than the stock');
    const o1 = await call('POST', '/orders', { token: tb, body: { items: [{ productId: prod.json.id, qty: 2 }], shipping: ship } });
    ok(o1.status === 201 && o1.json.checkout.provider === 'flutterwave' && o1.json.order.totalMinor === 9000000, 'NGN order goes to Flutterwave');
    ok(o1.json.order.feeMinor === 450000, 'platform fee is 5%');
    const stock = async () => (await pool.query('select stock, sold_count from products where id = $1', [prod.json.id])).rows[0];
    ok((await stock()).stock === 1, 'stock is held while payment is pending');
    ok((await call('POST', '/orders', { token: tc, body: { items: [{ productId: prod.json.id, qty: 2 }], shipping: ship } })).status === 400, 'held stock cannot be bought by someone else');
    const ref = `bmuette-${o1.json.order.id}`;
    const hook = (id: number, hash = 'whash') => call('POST', '/webhooks/flutterwave', { headers: { 'verif-hash': hash }, body: { event: 'charge.completed', data: { id, tx_ref: ref } } });
    ok((await hook(555, 'forged')).status === 400, 'forged Flutterwave webhook is rejected');
    flwTx.set(ref, { ...(flwTx.get(ref) as any), id: '555', status: 'successful', amount: 90000, currency: 'NGN' } as any);
    ok((await hook(555)).status === 200, 'genuine webhook accepted');
    ok((await call('GET', `/orders/${o1.json.order.id}`, { token: tb })).json.status === 'paid', 'order is paid after verification');
    await hook(555);
    ok((await stock()).sold_count === 2, 'a repeated webhook does not count the sale twice');
    ok((await call('GET', '/merchant/orders', { token: ta })).json.items.length === 1, 'merchant sees the paid order');
    const item = (await call('GET', '/merchant/orders', { token: ta })).json.items[0];
    ok((await call('PATCH', `/merchant/order-items/${item.id}`, { token: ta, body: { status: 'shipped' } })).status === 200, 'merchant marks it shipped');
    ok((await call('PATCH', `/merchant/order-items/${item.id}`, { token: tb, body: { status: 'shipped' } })).status === 404, "buyers cannot change fulfilment");

    const o2 = await call('POST', '/orders', { token: tc, body: { items: [{ productId: prod.json.id, qty: 1 }], shipping: ship } });
    ok(o2.status === 201 && (await stock()).stock === 0, 'second order takes the last item');
    const ref2 = `bmuette-${o2.json.order.id}`;
    flwTx.set(ref2, { ...(flwTx.get(ref2) as any), id: '556', status: 'failed', amount: 45000, currency: 'NGN' } as any);
    await call('POST', '/webhooks/flutterwave', { headers: { 'verif-hash': 'whash' }, body: { event: 'charge.completed', data: { id: 556, tx_ref: ref2 } } });
    ok((await stock()).stock === 1, 'a failed payment returns the stock');
    const wrong = await call('POST', '/orders', { token: tc, body: { items: [{ productId: prod.json.id, qty: 1 }], shipping: ship } });
    const ref3 = `bmuette-${wrong.json.order.id}`;
    flwTx.set(ref3, { ...(flwTx.get(ref3) as any), id: '557', status: 'successful', amount: 1, currency: 'NGN' } as any);
    const mismatch = await call('POST', '/webhooks/flutterwave', { headers: { 'verif-hash': 'whash' }, body: { event: 'charge.completed', data: { id: 557, tx_ref: ref3 } } });
    ok(mismatch.status >= 400 && (await call('GET', `/orders/${wrong.json.order.id}`, { token: tc })).json.status === 'pending', 'a payment for the wrong amount does not mark the order paid');

    // Stripe: no outside call possible here, so create the order row directly and test the signed webhook.
    const so = await pool.query(
      `insert into orders (buyer_id, currency, subtotal_minor, fee_minor, total_minor, provider, provider_ref) values ($1,'USD',5000,250,5000,'stripe','cs_test_123') returning id`, [B.user.id]);
    await pool.query(`insert into order_items (order_id, product_id, merchant_id, title, unit_price_minor, qty) values ($1,$2,$3,'x',5000,1)`, [so.rows[0].id, mug.json.id, A.user.id]);
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', object: 'checkout.session', payment_status: 'paid', amount_total: 5000, currency: 'usd' } } });
    const stripeSig = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_testsecret' });
    ok((await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' } })).status === 400, 'forged Stripe webhook is rejected');
    ok((await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSig } })).status === 200, 'signed Stripe webhook accepted');
    ok((await pool.query('select status from orders where id = $1', [so.rows[0].id])).rows[0].status === 'paid', 'Stripe order is paid');
    const bad = await call('POST', '/orders', { token: tb, body: { items: [{ productId: mug.json.id, qty: 1 }], shipping: ship } });
    ok(bad.status === 201, 'checkout works while Stripe is only needed for non-African currencies');

    // Cloudflare Stream webhook signature
    const body = JSON.stringify({ uid: 'abc', readyToStream: true });
    const t = Math.floor(Date.now() / 1000);
    const sigGood = createHmac('sha256', 'cfsecret').update(`${t}.${body}`).digest('hex');
    ok((await call('POST', '/webhooks/stream', { raw: body, headers: { 'content-type': 'application/json', 'webhook-signature': `time=${t},sig1=${sigGood}` } })).status === 200, 'Cloudflare Stream webhook with a valid signature');
    ok((await call('POST', '/webhooks/stream', { raw: body, headers: { 'content-type': 'application/json', 'webhook-signature': `time=${t},sig1=${'0'.repeat(64)}` } })).status === 400, '...and a forged one is rejected');

    // ---------------------------------------------------------------- chat
    section('Chat');
    const wsUrl = BASE.replace('http', 'ws') + '/ws';
    const listen = (token: string) => new Promise<{ events: any[]; close: () => void; closed: Promise<number> }>((resolve, reject) => {
      const sock = new WebSocket(wsUrl); const events: any[] = [];
      const closed = new Promise<number>((r) => sock.addEventListener('close', (e) => r(e.code)));
      sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'auth', token })));
      sock.addEventListener('message', (m) => { const d = JSON.parse(String(m.data)); if (d.type === 'ready') resolve({ events, close: () => sock.close(), closed }); else events.push(d); });
      sock.addEventListener('error', () => reject(new Error('ws error')));
      setTimeout(() => reject(new Error('ws timeout')), 4000);
    });
    const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 40 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); return cond(); };

    const bolaLive = await listen(tb);
    const badSock = new WebSocket(wsUrl);
    badSock.addEventListener('open', () => badSock.send(JSON.stringify({ type: 'auth', token: 'nonsense' })));
    ok(await new Promise<number>((r) => badSock.addEventListener('close', (e) => r(e.code))) === 4401, 'a socket with a bad token is closed');

    ok((await call('POST', '/conversations', { token: ta, body: { userId: A.user.id } })).status === 400, "can't message yourself");
    ok((await call('POST', '/conversations')).status === 401, 'chat needs sign-in');
    const conv = await call('POST', '/conversations', { token: ta, body: { userId: B.user.id } });
    ok(conv.status === 200 && conv.json.with.username === 'bola', 'open a chat with someone');
    ok((await call('POST', '/conversations', { token: tb, body: { userId: A.user.id } })).json.id === conv.json.id, 'the other person opening it gets the same chat');
    ok((await call('GET', '/conversations', { token: ta })).json.length === 0, 'a chat with no messages is not listed yet');
    const cid = conv.json.id;
    ok((await call('GET', `/conversations/${cid}`, { token: tb })).json.with.username === 'ada', 'fetch one chat');
    ok((await call('GET', `/conversations/${cid}`, { token: tc })).status === 404, '...an outsider cannot');

    const m1 = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'text', body: '  hey, is the hoodie still available?  ', clientId: 'client-aaaaaaaa' } });
    ok(m1.status === 201 && m1.json.body === 'hey, is the hoodie still available?', 'send a text (trimmed)');
    const again = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'text', body: 'hey, is the hoodie still available?', clientId: 'client-aaaaaaaa' } });
    ok(again.json.id === m1.json.id, 'retrying the same message does not duplicate it');
    ok((await pool.query('select count(*)::int n from messages where conversation_id = $1', [cid])).rows[0].n === 1, '...only one row exists');
    ok(await waitFor(() => bolaLive.events.some((e) => e.type === 'message' && e.message.id === m1.json.id)), 'the other person receives it live');
    ok(bolaLive.events.filter((e) => e.type === 'message').length === 1, '...exactly once');

    ok((await call('GET', '/conversations/unread', { token: tb })).json.unread === 1, 'unread count for the receiver');
    ok((await call('GET', '/conversations/unread', { token: ta })).json.unread === 0, '...and none for the sender');
    const lb = await call('GET', '/conversations', { token: tb });
    ok(lb.json.length === 1 && lb.json[0].unread === 1 && lb.json[0].lastMessage.body.startsWith('hey') && lb.json[0].with.username === 'ada', 'chat list shows the last message and unread');

    const adaLive = await listen(ta);
    ok((await call('POST', `/conversations/${cid}/read`, { token: tb })).status === 200, 'mark as read');
    ok((await call('GET', '/conversations/unread', { token: tb })).json.unread === 0, 'unread drops to zero');
    ok(await waitFor(() => adaLive.events.some((e) => e.type === 'read')), 'the sender is told it was read');

    const myImg = await upload(ta, 'image', 'chatpic');
    const theirImg = await upload(tb, 'image', 'theirpic');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'image', mediaId: theirImg.id, clientId: 'client-img-bad1' } })).status === 400, "can't send someone else's photo");
    const im = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'image', mediaId: myImg.id, clientId: 'client-img-ok01' } });
    ok(im.status === 201 && im.json.mediaUrl, 'send a photo');
    const share = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'product', refId: mug.json.id, body: 'look at this', clientId: 'client-prod-001' } });
    ok(share.status === 201 && share.json.ref.title === 'Ceramic Mug' && share.json.ref.priceMinor === 250000, 'share a product with a preview card');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'product', refId: '00000000-0000-4000-8000-000000000000', clientId: 'client-prod-002' } })).status === 400, "can't share a product that doesn't exist");
    const sharePost = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'post', refId: p1.json.id, clientId: 'client-post-001' } });
    ok(sharePost.status === 201 && sharePost.json.ref.username === 'ada', 'share a post with a preview card');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'text', body: '', clientId: 'client-empty-01' } })).status === 400, 'empty message is rejected');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'text', body: 'x'.repeat(4001), clientId: 'client-long-001' } })).status === 400, 'overlong message is rejected');

    const page1 = await call('GET', `/conversations/${cid}/messages?limit=2`, { token: tb });
    ok(page1.json.items.length === 2 && page1.json.nextCursor && page1.json.items[0].id === sharePost.json.id, 'history comes newest first');
    const page2 = await call('GET', `/conversations/${cid}/messages?limit=2&cursor=${page1.json.nextCursor}`, { token: tb });
    ok(page2.json.items.length === 2 && !page2.json.nextCursor, 'next page continues to the end');
    const all = [...page1.json.items, ...page2.json.items];
    ok(new Set(all.map((x: any) => x.id)).size === 4, '...with no repeats');
    ok(page1.json.peerReadAt, 'thread says when the other person last read');

    ok((await call('GET', `/conversations/${cid}/messages`, { token: tc })).status === 404, 'an outsider cannot read the thread');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: tc, body: { kind: 'text', body: 'hi', clientId: 'client-intru-01' } })).status === 404, '...or write in it');
    ok((await call('POST', `/conversations/${cid}/read`, { token: tc })).status === 404, '...or mark it read');
    ok((await call('POST', '/conversations', { token: tc, body: { userId: B.user.id } })).status === 403, 'a blocked pair cannot open a chat');
    await call('POST', '/users/ada/block', { token: tb });
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'text', body: 'still there?', clientId: 'client-blocked-1' } })).status === 403, 'blocking stops messages in an existing chat');
    await call('DELETE', '/users/ada/block', { token: tb });
    bolaLive.close(); adaLive.close();

    // ---------------------------------------------------------------- admin dashboard
    section('Admin dashboard');
    await call('POST', `/posts/${p1.json.id}/comments`, { token: tb, body: { body: 'Love these' } });
    ok((await call('GET', '/admin/api/overview')).status === 401, 'dashboard data needs sign-in');
    ok((await call('GET', '/admin/api/overview', { token: tb })).status === 403, 'a normal account is refused');
    ok((await call('GET', '/admin/api/system', { token: tb })).status === 403, '...on every admin endpoint');
    await pool.query('update users set is_admin = true where id = $1', [A.user.id]);
    const ov = await call('GET', '/admin/api/overview?days=30&tz=Africa/Lagos', { token: ta });
    ok(ov.status === 200, 'an admin gets the overview');
    const dbUsers = (await pool.query('select count(*)::int n from users where deleted_at is null')).rows[0].n;
    ok(ov.json.kpis.users.total === dbUsers, 'total users matches the database');
    ok(ov.json.kpis.users.newUsers.cur === dbUsers, 'new users in the window counts everyone just created');
    ok(ov.json.kpis.users.active.cur >= 2, 'active users counts people who did things');
    const dbPaid = (await pool.query(`select currency, sum(total_minor)::bigint gmv, sum(fee_minor)::bigint fee, count(*)::int n from orders where status = 'paid' group by currency`)).rows;
    ok(ov.json.kpis.orders.money.length === dbPaid.length && dbPaid.every((d: any) => { const m = ov.json.kpis.orders.money.find((x: any) => x.currency === d.currency); return m && m.gmvMinor === Number(d.gmv) && m.feeMinor === Number(d.fee) && m.orders === d.n; }), 'revenue, platform fee and order count match the database, per currency');
    ok(dbPaid.length > 0, '...and there is paid revenue to check');
    const dbOrders = (await pool.query('select count(*)::int n from orders')).rows[0].n;
    ok(ov.json.kpis.orders.created.cur === dbOrders, 'orders created matches the database');
    ok(ov.json.kpis.content.comments.cur === (await pool.query('select count(*)::int n from comments where deleted_at is null')).rows[0].n, 'comments match the database');
    ok(ov.json.kpis.content.posts.cur === (await pool.query('select count(*)::int n from posts')).rows[0].n, 'posts match the database');
    ok(ov.json.kpis.content.messages.cur === (await pool.query('select count(*)::int n from messages')).rows[0].n, 'messages match the database');
    ok(ov.json.series.signups.length === 30 && ov.json.series.signups.reduce((a: number, p: any) => a + p.v, 0) === dbUsers, 'the signup chart has 30 days and adds up to the total');
    const cur0 = Object.keys(ov.json.series.revenue)[0];
    ok(cur0 && ov.json.series.revenue[cur0].reduce((a: number, p: any) => a + p.v, 0) === ov.json.kpis.orders.money.find((m: any) => m.currency === cur0).gmvMinor, 'the revenue chart adds up to the revenue figure');
    ok((await call('GET', '/admin/api/overview?days=1&tz=UTC', { token: ta })).json.series.signups.length === 24, 'one-day view is hourly');
    ok((await call('GET', '/admin/api/overview?tz=Mars/Base', { token: ta })).status === 400, 'an unknown time zone is rejected');
    ok(Array.isArray(ov.json.breakdowns.topProducts) && ov.json.breakdowns.topProducts[0]?.units >= 1, 'top products are listed');

    const pe = await call('GET', '/admin/api/people?limit=2', { token: ta });
    ok(pe.json.items.length === 2 && pe.json.total === dbUsers && pe.json.items[0].email && pe.json.nextCursor, 'people list pages and shows emails');
    ok(!JSON.stringify(pe.json).includes('password'), '...and never password data');
    ok((await call('GET', '/admin/api/people?q=BOLA', { token: ta })).json.items.some((x: any) => x.username === 'bola'), 'people search is case-insensitive');
    const od = await call('GET', '/admin/api/orders?limit=50', { token: ta });
    ok(od.json.items.length === dbOrders && od.json.items.every((x: any) => x.buyer.email && !('shipping' in x)), 'orders list shows buyers and omits shipping addresses');
    ok((await call('GET', '/admin/api/orders?status=paid', { token: ta })).json.items.every((x: any) => x.status === 'paid'), 'orders filter by status');
    ok(Array.isArray((await call('GET', '/admin/api/payment-events', { token: ta })).json), 'payment events list');
    const act = await call('GET', '/admin/api/activity?limit=200', { token: ta });
    const kinds = new Set(act.json.items.map((x: any) => x.kind));
    ok(['signup', 'session', 'post', 'comment', 'order', 'payment', 'product', 'merchant'].every((k) => kinds.has(k)), 'the activity log covers signups, sessions, posts, comments, orders, payments, products and shops');
    ok(act.json.items.every((x: any, i: number, a: any[]) => i === 0 || new Date(a[i - 1].at) >= new Date(x.at)), '...newest first');
    ok((await call('GET', '/admin/api/activity?kinds=signup', { token: ta })).json.items.every((x: any) => x.kind === 'signup'), 'activity filters by kind');
    for (const k of ['signup', 'session', 'post', 'comment', 'merchant', 'product', 'order', 'payment', 'report', 'webhook', 'error']) {
      const r = await call('GET', `/admin/api/activity?kinds=${k}&limit=5`, { token: ta });
      ok(r.status === 200 && r.json.items.every((x: any) => x.kind === k), `activity kind "${k}" works on its own`);
    }
    ok((await call('GET', '/admin/api/activity?kinds=payment,order', { token: ta })).status === 200, '...and in combination');
    const pg1 = await call('GET', '/admin/api/activity?limit=5', { token: ta });
    const pg2 = await call('GET', `/admin/api/activity?limit=5&before=${encodeURIComponent(pg1.json.nextBefore)}`, { token: ta });
    ok(pg1.json.nextBefore && pg2.json.items.every((x: any) => new Date(x.at) <= new Date(pg1.json.nextBefore)), 'activity pages backwards in time');
    ok((await call('GET', '/admin/api/activity?kinds=nonsense', { token: ta })).status === 400, 'unknown activity kinds are rejected');
    await pool.query(`insert into error_log (method, path, status, message) values ('POST', '/orders', 500, 'test failure')`);
    ok((await call('GET', '/admin/api/errors', { token: ta })).json[0]?.message === 'test failure', 'errors list shows recorded server errors');
    ok((await call('GET', '/admin/api/overview?days=1', { token: ta })).json.attention.serverErrors24h >= 1, '...and the attention strip counts them');
    const sys = await call('GET', '/admin/api/system', { token: ta });
    ok(sys.json.ok && sys.json.migrations.includes('004_admin.sql') && Array.isArray(sys.json.warnings) && sys.json.counts.users === dbUsers, 'system page reports health, migrations and counts');
    ok(!JSON.stringify(sys.json).match(/sk_|whsec|secret/i), '...and never leaks keys');
    ok((await fetch(BASE + '/admin/')).status === 200 && (await fetch(BASE + '/admin/app.js')).status === 200, 'the dashboard page itself is served');
    ok((await fetch(BASE + '/admin/api/overview')).headers.get('cache-control') === 'no-store', 'admin responses are never cached');
    await pool.query('update users set is_admin = false where id = $1', [A.user.id]);
    ok((await call('GET', '/admin/api/overview', { token: ta })).status === 403, 'removing the admin flag locks the account out immediately');

    // ---------------------------------------------------------------- account deletion
    section('Accounts and safety');
    await pool.query('update users set is_admin = true where id = $1', [A.user.id]);
    const emails = async (to: string) => (await pool.query(`select body from email_outbox where to_email = $1 order by id desc`, [to])).rows.map((r: any) => r.body as string);
    const codeIn = (body: string) => body.match(/\b(\d{6})\b/)![1];
    // --- age and terms
    const reg = (o: object) => call('POST', '/auth/register', { body: { email: 'new@test.dev', password: 'correct horse', username: 'newbie', displayName: 'New', birthDate: '1995-05-05', acceptTerms: true, ...o } });
    ok((await reg({ acceptTerms: false })).status === 400, 'sign-up needs the terms accepted');
    ok((await reg({ birthDate: undefined })).status === 400, 'sign-up needs a birth date');
    ok((await reg({ birthDate: new Date(Date.now() - 10 * 365.25 * 864e5).toISOString().slice(0, 10) })).status === 403, 'under the minimum age cannot sign up');
    const teen = await reg({ email: 'teen@test.dev', username: 'teen', birthDate: new Date(Date.now() - 15 * 365.25 * 864e5).toISOString().slice(0, 10) });
    ok(teen.status === 201 && (await pool.query(`select is_adult from users where username = 'teen'`)).rows[0].is_adult === false, '15 year olds can join but are not adults');
    ok(!('birth_date' in ((await pool.query(`select * from users where username = 'teen'`)).fields.reduce((o: any, f: any) => ({ ...o, [f.name]: 1 }), {}))), 'the birth date itself is never stored');
    ok((await call('POST', '/merchants', { token: teen.json.accessToken, body: { shopName: 'Teen Shop', slug: 'teen-shop', country: 'NG' } })).status === 403, 'a minor cannot open a shop');
    // --- email verification
    const nu = await reg({});
    ok(nu.status === 201 && nu.json.user.id, 'new account registers');
    // The email goes out in the background after sign-up, so wait for it.
    let nuEmail: string[] = [];
    for (let i = 0; i < 30 && nuEmail.length === 0; i++) { nuEmail = await emails('new@test.dev'); if (!nuEmail.length) await new Promise((r) => setTimeout(r, 100)); }
    ok(nuEmail.length === 1 && /verification code/.test(nuEmail[0]), 'a verification code was emailed');
    ok((await call('GET', '/me', { token: nu.json.accessToken })).json.emailVerified === false, 'email starts unverified');
    const shopTry = await call('POST', '/merchants', { token: nu.json.accessToken, body: { shopName: 'New Shop', slug: 'new-shop', country: 'NG' } });
    ok(shopTry.status === 403 && shopTry.json.code === 'EMAIL_NOT_VERIFIED', 'an unverified email cannot open a shop');
    ok((await call('POST', '/auth/verify-email', { token: nu.json.accessToken, body: { code: '000000' } })).status === 400, 'a wrong code is refused');
    ok((await call('POST', '/auth/verify-email/send', { token: nu.json.accessToken })).status === 429, 'a second code within a minute is refused');
    const vr = await call('POST', '/auth/verify-email', { token: nu.json.accessToken, body: { code: codeIn(nuEmail[0]) } });
    ok(vr.json.verified === true, 'the right code verifies the email');
    ok((await call('GET', '/me', { token: nu.json.accessToken })).json.emailVerified === true, '...and /me shows it');
    ok((await call('POST', '/auth/verify-email', { token: nu.json.accessToken, body: { code: codeIn(nuEmail[0]) } })).status === 400, 'a code cannot be used twice');
    // five wrong tries burn a code
    await pool.query(`update auth_codes set created_at = created_at - interval '5 minutes'`);
    await pool.query(`update users set email_verified_at = null where username = 'newbie'`);
    await call('POST', '/auth/verify-email/send', { token: nu.json.accessToken });
    const fresh = codeIn((await emails('new@test.dev'))[0]);
    for (let i = 0; i < 5; i++) await call('POST', '/auth/verify-email', { token: nu.json.accessToken, body: { code: '111111' === fresh ? '222222' : '111111' } });
    ok((await call('POST', '/auth/verify-email', { token: nu.json.accessToken, body: { code: fresh } })).status === 400, 'five wrong guesses burn the code');
    // --- password reset
    const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'nobody@test.dev' } });
    const known = await call('POST', '/auth/forgot-password', { body: { email: 'bola@test.dev' } });
    ok(unknown.status === 200 && known.status === 200 && JSON.stringify(unknown.json) === JSON.stringify(known.json), 'forgot-password answers the same for unknown and known emails');
    ok((await emails('nobody@test.dev')).length === 0, '...and sends nothing to unknown emails');
    const bolaCode = codeIn((await emails('bola@test.dev'))[0]);
    ok((await call('POST', '/auth/reset-password', { body: { email: 'bola@test.dev', code: '123456' === bolaCode ? '654321' : '123456', password: 'brand new pass' } })).status === 400, 'reset with a wrong code fails');
    ok((await call('POST', '/auth/reset-password', { body: { email: 'bola@test.dev', code: bolaCode, password: 'short' } })).status === 400, 'reset with a weak password fails');
    ok((await call('POST', '/auth/reset-password', { body: { email: 'bola@test.dev', code: bolaCode, password: 'brand new pass' } })).status === 200, 'reset with the right code works');
    ok((await call('POST', '/auth/login', { body: { email: 'bola@test.dev', password: 'correct horse' } })).status === 401, 'the old password stops working');
    const bolaNew = await call('POST', '/auth/login', { body: { email: 'bola@test.dev', password: 'brand new pass' } });
    ok(bolaNew.status === 200, 'the new password works');
    ok((await call('POST', '/auth/refresh', { body: { refreshToken: B.refreshToken } })).status === 401, 'resetting signs out every old session');
    ok((await call('POST', '/auth/reset-password', { body: { email: 'bola@test.dev', code: bolaCode, password: 'another pass 1' } })).status === 400, 'a reset code works once');
    // --- change password
    ok((await call('POST', '/auth/change-password', { token: bolaNew.json.accessToken, body: { currentPassword: 'nope nope', newPassword: 'third password' } })).status === 401, 'changing a password needs the current one');
    const chg = await call('POST', '/auth/change-password', { token: bolaNew.json.accessToken, body: { currentPassword: 'brand new pass', newPassword: 'third password' } });
    ok(chg.status === 200 && chg.json.accessToken, 'change password returns a fresh session');
    ok((await call('POST', '/auth/login', { body: { email: 'bola@test.dev', password: 'third password' } })).status === 200, '...and the new password works');
    // --- legal pages
    for (const [path, word] of [['terms', 'Terms of Use'], ['privacy', 'Privacy Policy'], ['community', 'Community Rules']]) {
      const r = await call('GET', `/legal/${path}`);
      ok(r.status === 200 && r.text.includes(word), `/legal/${path} is served`);
    }
    // --- reports on comments and moderation
    const cmt = (await call('POST', `/posts/${p1.json.id}/comments`, { token: tb, body: { body: 'buy cheap watches at spam.example' } })).json;
    ok((await call('POST', '/reports', { token: tc2(), body: { commentId: cmt.id, reason: 'spam' } })).status === 201, 'a comment can be reported');
    ok((await call('POST', '/reports', { token: ta, body: { userId: A.user.id, reason: 'spam' } })).status === 400, 'you cannot report yourself');
    ok((await call('POST', '/reports', { token: ta, body: { postId: '00000000-0000-4000-8000-000000000000', reason: 'spam' } })).status === 404, 'reporting something that does not exist is refused');
    const q = await call('GET', '/admin/api/reports?status=open', { token: ta });
    ok(q.status === 200 && q.json.items.length >= 6 && q.json.counts.open === q.json.items.length, 'the report queue lists open reports');
    ok((await call('GET', '/admin/api/reports', { token: tb })).status === 403, 'only admins see the queue');
    const rc = q.json.items.find((r: any) => r.target.type === 'comment');
    ok(rc && rc.target.label.includes('spam.example') && rc.target.owner === 'bola', 'a comment report shows the comment and its author');
    ok((await call('POST', `/admin/api/reports/${rc.id}/resolve`, { token: ta, body: { action: 'remove', note: 'spam link' } })).json.closed === 1, 'removing a reported comment closes the report');
    ok((await pool.query(`select deleted_at from comments where id = $1`, [cmt.id])).rows[0].deleted_at !== null, '...and the comment is gone');
    const rp = (await call('GET', '/admin/api/reports?status=open', { token: ta })).json.items.find((r: any) => r.target.type === 'post' && r.target.id === spam.json.id);
    ok(rp && rp.openOnTarget === 5, 'five reports on one post show as one decision to make');
    ok((await call('POST', `/admin/api/reports/${rp.id}/resolve`, { token: ta, body: { action: 'remove' } })).json.closed === 5, 'one decision closes all five reports');
    ok((await pool.query(`select status from posts where id = $1`, [spam.json.id])).rows[0].status === 'removed', '...and the post is removed');
    ok((await call('POST', `/admin/api/reports/${rp.id}/resolve`, { token: ta, body: { action: 'dismiss' } })).json.closed === 0, 'deciding on an already closed report changes nothing');
    // dismiss
    const dm = await call('POST', '/reports', { token: tb, body: { userId: C.user.id, reason: 'harassment', details: 'rude in chat' } });
    ok(dm.status === 201, 'a person can be reported with details');
    const dmRow = (await call('GET', '/admin/api/reports', { token: ta })).json.items.find((r: any) => r.target.type === 'user');
    ok(dmRow.details === 'rude in chat', 'the details reach the admin');
    ok((await call('POST', `/admin/api/reports/${dmRow.id}/resolve`, { token: ta, body: { action: 'dismiss' } })).status === 200, 'dismiss closes a report without touching the person');
    ok((await call('GET', '/admin/api/reports?status=dismissed', { token: ta })).json.items.length >= 1, 'dismissed reports are listed');
    // --- ban
    const vic = await mk('vic');
    const vicPost = await call('POST', '/posts', { token: vic.accessToken, body: { kind: 'photo', caption: 'hello', tags: [], mediaIds: [(await upload(vic.accessToken, 'image', 'vic')).id] } });
    ok((await call('GET', `/posts/${vicPost.json.id}`, { token: tb })).status === 200, 'a normal account can be seen');
    ok((await call('POST', `/admin/api/users/${vic.user.id}/ban`, { token: tb, body: { reason: 'abuse of rules' } })).status === 403, 'a normal account cannot ban');
    ok((await call('POST', `/admin/api/users/${A.user.id}/ban`, { token: ta, body: { reason: 'oops oops' } })).status === 409, 'an admin cannot ban themselves');
    ok((await call('POST', `/admin/api/users/${vic.user.id}/ban`, { token: ta, body: { reason: 'abuse of rules' } })).status === 200, 'an admin can ban');
    ok((await call('GET', '/me', { token: vic.accessToken })).status === 401, 'a banned account is cut off at once, even with a valid token');
    ok((await call('POST', '/auth/refresh', { body: { refreshToken: vic.refreshToken } })).status === 401, '...cannot refresh');
    const bl = await call('POST', '/auth/login', { body: { email: 'vic@test.dev', password: 'correct horse' } });
    ok(bl.status === 403 && /suspended/.test(bl.json.message), '...and cannot sign in, with a clear message');
    ok((await call('GET', `/posts/${vicPost.json.id}`, { token: tb })).status === 404, 'their posts disappear');
    ok((await call('POST', `/admin/api/users/${vic.user.id}/unban`, { token: ta })).status === 200, 'an admin can lift a ban');
    ok((await call('POST', '/auth/login', { body: { email: 'vic@test.dev', password: 'correct horse' } })).status === 200, 'they can sign in again');
    ok((await call('GET', `/posts/${vicPost.json.id}`, { token: tb })).status === 200, '...and their posts return');
    const audit = await call('GET', '/admin/api/audit', { token: ta });
    ok(audit.json.items.some((a: any) => a.action === 'ban') && audit.json.items.some((a: any) => a.action === 'unban') && audit.json.items.some((a: any) => a.action === 'report:remove'), 'every admin action is in the audit log');
    ok((await call('GET', '/admin/api/emails', { token: ta })).json.items.some((e: any) => e.to === 'bola@test.dev'), 'the admin can read the email outbox');
    // --- delete with an open order as a seller
    const open = await pool.query(`select merchant_id from order_items i join orders o on o.id = i.order_id where o.status = 'paid' and i.fulfilment = 'pending' limit 1`);
    if (open.rows[0]) {
      const m = await pool.query(`select id from users where id = $1`, [open.rows[0].merchant_id]);
      const tk = (await call('POST', '/auth/login', { body: { email: (await pool.query(`select email from users where id = $1`, [m.rows[0].id])).rows[0].email, password: 'correct horse' } })).json;
      if (tk?.accessToken) ok((await call('POST', '/me/delete', { token: tk.accessToken, body: { password: 'correct horse' } })).status === 409, 'a seller with open orders cannot delete their account');
    }


    section('Hashtags, search, sounds and boards');
    const ht = await call('POST', '/posts', { token: tb, body: { kind: 'photo', caption: 'Sunday vibes #Sunday #lagos_life', tags: ['style'], mediaIds: [(await upload(tb, 'image', 'sunday')).id] } });
    ok(ht.status === 201 && ['sunday', 'lagos_life', 'style'].every((t) => ht.json.tags.includes(t)), '#hashtags in a caption become tags');
    const tr = await call('GET', '/tags/trending');
    ok(tr.status === 200 && tr.json.items.some((t: any) => t.tag === 'sunday') && tr.json.items[0].posts >= 1, 'trending tags lists what people are posting about');
    const tp = await call('GET', '/tags/%23Sunday/posts', { token: ta });
    ok(tp.json.tag === 'sunday' && tp.json.postCount === 1 && tp.json.items[0].id === ht.json.id, 'posts for a tag (case and # ignored)');
    ok((await call('GET', '/tags/nothingtobefound/posts')).json.items.length === 0, 'an unused tag is just empty');
    ok((await call('GET', '/search?q=%23sunday&type=posts')).json.posts.some((x: any) => x.id === ht.json.id), 'searching "#sunday" finds the tag');
    ok((await call('GET', '/search?q=ada&type=users')).json.users.some((u: any) => u.username === 'ada'), 'people search');
    ok((await call('GET', '/search?q=sneakers')).json.products.length >= 1, 'product search');
    
    ok(Array.isArray((await call('GET', '/trending/searches')).json.items), '...and returns a list');

    // sounds
    const snd = await call('GET', '/sounds');
    ok(snd.json.items.length === 6 && snd.json.items[0].url.endsWith('.mp3'), 'the sound library has the starter tracks');
    const sres = await fetch(snd.json.items[0].url);
    ok(sres.status === 200 && (sres.headers.get('content-type') ?? '').includes('audio') && (await sres.arrayBuffer()).byteLength > 10_000, 'a sound file is served');
    ok((await call('GET', '/sounds?q=calm')).json.items.length === 1, 'search sounds by mood');
    const sid = snd.json.items[0].id;
    const vid2 = await upload(ta, 'video', 'edited');
    const edited = await call('POST', '/posts', { token: ta, body: { kind: 'video', caption: 'edited clip', mediaIds: [vid2.id], soundId: sid, soundVolume: 55, originalVolume: 30,
      edit: { trimStartMs: 1000, trimEndMs: 6000, filter: 'warm', texts: [{ text: 'New drop', x: 0.5, y: 0.3, color: '#FFFFFF', size: 32 }] } } });
    ok(edited.status === 201 && edited.json.sound?.id === sid && edited.json.soundVolume === 55 && edited.json.originalVolume === 30, 'post with a sound and volumes');
    ok(edited.json.edit.filter === 'warm' && edited.json.edit.trimEndMs === 6000 && edited.json.edit.texts[0].text === 'New drop', 'trim, filter and text are saved with the post');
    ok((await call('GET', `/posts/${edited.json.id}`)).json.sound.title, '...and come back when it is loaded');
    ok((await call('GET', `/sounds/${sid}`)).json.uses === 1, 'a sound counts its uses');
    const vid3 = await upload(ta, 'video', 'badEdit');
    const badEdit = (edit: unknown, extra: object = {}) => call('POST', '/posts', { token: ta, body: { kind: 'video', mediaIds: [vid3.id], edit, ...extra } });
    ok((await badEdit({ filter: 'bogus', texts: [] })).status === 400, 'an unknown filter is refused');
    ok((await badEdit({ trimStartMs: 5000, trimEndMs: 5200, filter: 'none', texts: [] })).status === 400, 'a trim under one second is refused');
    ok((await badEdit({ filter: 'none', texts: [{ text: 'x', x: 2, y: 0.5, color: '#fff', size: 20 }] })).status === 400, 'badEdit text overlay is refused');
    ok((await badEdit({ filter: 'none', texts: [] }, { soundId: '00000000-0000-0000-0000-000000000000' })).status === 400, 'an unknown sound is refused');
    ok((await call('POST', '/posts', { token: ta, body: { kind: 'photo', mediaIds: [(await upload(ta, 'image', 'trim')).id], edit: { trimStartMs: 0, trimEndMs: 3000, filter: 'none', texts: [] } } })).status === 400, 'a photo cannot be trimmed');
    const okPhoto = await call('POST', '/posts', { token: ta, body: { kind: 'photo', caption: 'filtered', mediaIds: [(await upload(ta, 'image', 'filt')).id], edit: { filter: 'noir', texts: [] } } });
    ok(okPhoto.status === 201 && okPhoto.json.edit.filter === 'noir', 'a photo can have a filter');

    // boards
    await pool.query('delete from collections'); // earlier sections made some
    ok((await call('GET', '/collections', { token: tb })).json.items.length === 0, 'no boards at first');
    const bd = await call('POST', '/collections', { token: tb, body: { name: 'Outfit ideas' } });
    ok(bd.status === 201, 'create a board');
    ok((await call('POST', `/posts/${p1.json.id}/save`, { token: tb, body: { collectionId: bd.json.id } })).json.saved === true, 'save a post into a board');
    ok((await call('POST', `/products/${mug.json.id}/save`, { token: tb, body: { collectionId: bd.json.id } })).json.saved === true, 'save a product into a board');
    ok((await call('POST', `/products/${prod.json.id}/save`, { token: tb })).json.saved === true, 'save a product with no board');
    const bi = await call('GET', `/collections/${bd.json.id}/items`, { token: tb });
    ok(bi.json.posts.length === 1 && bi.json.products.length === 1 && bi.json.products[0].id === mug.json.id, 'a board holds both posts and products');
    const boardList = await call('GET', '/collections', { token: tb });
    ok(boardList.json.items[0].itemCount === 2 && boardList.json.items[0].covers.length === 2 && boardList.json.total >= 3, 'boards show their count and cover pictures');
    ok((await call('POST', `/posts/${p2.json.id}/save`, { token: tc, body: { collectionId: bd.json.id } })).status === 400, "cannot file into someone else's board");
    ok((await call('GET', `/collections/${bd.json.id}/items`, { token: tc })).status === 404, "cannot open someone else's board");
    ok((await call('PATCH', `/collections/${bd.json.id}`, { token: tb, body: { name: 'Summer fits' } })).json.name === 'Summer fits', 'rename a board');
    ok((await call('PATCH', `/collections/${bd.json.id}`, { token: tc, body: { name: 'Mine now' } })).status === 404, "cannot rename someone else's board");
    const savedAll = await call('GET', '/collections/saved/items', { token: tb });
    ok(savedAll.json.posts.length >= 1 && savedAll.json.products.length === 2, 'the Saved page lists everything saved');
    ok((await call('DELETE', `/collections/${bd.json.id}`, { token: tb })).status === 204, 'delete a board');
    const after = await call('GET', '/collections/saved/items', { token: tb });
    ok(after.json.posts.length === savedAll.json.posts.length && after.json.products.length === 2, '...what was saved in it stays saved');
    ok((await call('GET', '/collections', { token: tb })).json.items.length === 0, '...and the board is gone');


    section('Notifications, typing and voice notes');
    const adaPost = (await pool.query(`select id from posts where author_id = $1 and status = 'published' order by created_at limit 1`, [A.user.id])).rows[0].id;
    await pool.query(`delete from notifications`);
    await pool.query(`delete from blocks`); // earlier sections left bola blocking chi
    const adaNow = await listen(ta);
    ok((await call('GET', '/notifications')).status === 401, 'notifications need sign-in');
    ok((await call('GET', '/notifications/unread-count', { token: ta })).json.unread === 0, 'starts with nothing unread');
    await call('DELETE', `/posts/${adaPost}/like`, { token: tb });
    await call('POST', `/posts/${adaPost}/like`, { token: tb });
    await call('DELETE', `/posts/${adaPost}/like`, { token: tb });
    await call('POST', `/posts/${adaPost}/like`, { token: tb });
    ok(await waitFor(() => adaNow.events.some((e) => e.type === 'notification' && e.unread === 1)), 'a like arrives live as a badge update');
    let nl = (await call('GET', '/notifications', { token: ta })).json;
    ok(nl.items.length === 1 && nl.items[0].type === 'like' && nl.items[0].actor.username === 'bola' && nl.items[0].postId === adaPost && nl.unread === 1, 'a like shows in the list, once even after like/unlike/like');
    await call('POST', `/posts/${adaPost}/like`, { token: ta });
    ok((await call('GET', '/notifications/unread-count', { token: ta })).json.unread === 1, 'liking your own post notifies nobody');
    const cm = await call('POST', `/posts/${adaPost}/comments`, { token: tb, body: { body: 'love this colour' } });
    ok(cm.status === 201, 'bola comments');
    const rply = await call('POST', `/posts/${adaPost}/comments`, { token: tc, body: { body: 'agreed!', parentId: cm.json.id } });
    ok(rply.status === 201, 'chi replies to bola');
    nl = (await call('GET', '/notifications', { token: ta })).json;
    ok(nl.items.some((i: any) => i.type === 'comment' && i.body === 'love this colour'), 'the post owner is told about a comment');
    const nb = (await call('GET', '/notifications', { token: tb })).json;
    ok(nb.items.some((i: any) => i.type === 'reply' && i.actor.username === 'chi'), 'the comment owner is told about a reply');
    await call('POST', '/users/ada/follow', { token: tc });
    await call('DELETE', '/users/ada/follow', { token: tc });
    await call('POST', '/users/ada/follow', { token: tc });
    nl = (await call('GET', '/notifications', { token: ta })).json;
    ok(nl.items.filter((i: any) => i.type === 'follow' && i.actor.username === 'chi').length === 1, 'a follow is listed once');
    ok(nl.unread === 4 && nl.items.length === 4, 'unread count matches the list');
    const one = await call('POST', '/notifications/read', { token: ta, body: { ids: [nl.items[0].id] } });
    ok(one.json.unread === 3, 'mark one as read');
    ok((await call('POST', '/notifications/read', { token: tb, body: { ids: [nl.items[1].id] } })).json.unread === 1, 'someone else marking your ids does nothing');
    ok((await call('GET', '/notifications/unread-count', { token: ta })).json.unread === 3, '...your count is untouched');
    ok((await call('POST', '/notifications/read', { token: ta, body: {} })).json.unread === 0, 'mark all as read');
    const pg = await call('GET', '/notifications?limit=2', { token: ta });
    ok(pg.json.items.length === 2 && pg.json.nextCursor, 'notifications page');
    ok((await call('GET', `/notifications?limit=2&cursor=${encodeURIComponent(pg.json.nextCursor)}`, { token: ta })).json.items.length === 2, '...and the next page');

    // settings and device tokens
    ok((await call('GET', '/me/notification-settings', { token: ta })).json.likes === true, 'everything is on by default');
    ok((await call('PUT', '/me/notification-settings', { token: ta, body: { likes: false } })).json.likes === false, 'turn likes off');
    ok((await call('GET', '/me/notification-settings', { token: ta })).json.comments === true, '...the others stay on');
    await call('PUT', '/me/notification-settings', { token: ta, body: { likes: true } });
    const tok = 'ExponentPushToken[abcdefghijklmnop12345]';
    ok((await call('POST', '/push/register', { token: ta, body: { token: tok, platform: 'android' } })).status === 200, 'register a device');
    await call('POST', '/push/register', { token: tb, body: { token: tok, platform: 'android' } });
    ok((await pool.query(`select user_id from push_tokens where token = $1`, [tok])).rows[0].user_id === B.user.id, 'a phone that signs in as someone else moves the token to them');
    ok((await call('POST', '/push/register', { token: ta, body: { token: 'short' } })).status === 400, 'rejects junk tokens');
    await call('POST', '/push/unregister', { token: tb, body: { token: tok } });
    ok((await pool.query(`select count(*)::int n from push_tokens`)).rows[0].n === 0, 'sign-out removes the device');

    // typing
    const bolaNow = await listen(tb);
    const chiNow = await listen(tc);
    const sockA = new WebSocket(wsUrl);
    await new Promise<void>((r) => { sockA.addEventListener('open', () => sockA.send(JSON.stringify({ type: 'auth', token: ta }))); sockA.addEventListener('message', () => r(), { once: true }); });
    sockA.send(JSON.stringify({ type: 'typing', conversationId: cid }));
    ok(await waitFor(() => bolaNow.events.some((e) => e.type === 'typing' && e.conversationId === cid && e.userId === A.user.id)), 'the other person sees "typing"');
    ok(!chiNow.events.some((e) => e.type === 'typing'), '...and nobody else does');
    sockA.send(JSON.stringify({ type: 'typing', conversationId: '00000000-0000-0000-0000-000000000000' }));
    sockA.send(JSON.stringify({ type: 'garbage' }));
    await new Promise((r) => setTimeout(r, 300));
    ok(bolaNow.events.filter((e) => e.type === 'typing').length === 1, 'typing in a chat that is not yours, or junk, is ignored');
    sockA.close();

    // voice notes
    const voice = await upload(ta, 'audio', 'voice');
    const vmsg = await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'voice', mediaId: voice.id, durationMs: 4200, clientId: 'voice-aaaaaaaa' } });
    ok(vmsg.status === 201 && vmsg.json.kind === 'voice' && vmsg.json.durationMs === 4200 && vmsg.json.mediaUrl, 'send a voice note');
    ok(await waitFor(() => bolaNow.events.some((e) => e.type === 'message' && e.message.kind === 'voice')), 'it arrives live');
    ok((await call('GET', '/conversations', { token: tb })).json[0].lastMessage.kind === 'voice', 'the chat list shows it as the last message');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'voice', mediaId: img1.id, durationMs: 4000, clientId: 'voice-bbbbbbbb' } })).status === 400, 'a photo cannot be sent as a voice note');
    ok((await call('POST', `/conversations/${cid}/messages`, { token: tb, body: { kind: 'voice', mediaId: voice.id, durationMs: 4000, clientId: 'voice-cccccccc' } })).status === 400, "you cannot send someone else's recording");
    ok((await call('POST', `/conversations/${cid}/messages`, { token: ta, body: { kind: 'voice', mediaId: voice.id, durationMs: 20, clientId: 'voice-dddddddd' } })).status === 400, 'a voice note must have a sensible length');
    ok((await call('POST', '/media/uploads', { token: ta, body: { kind: 'audio', mime: 'video/mp4', bytes: 100 } })).status === 400, 'audio uploads reject other file types');
    for (const l of [adaNow, bolaNow, chiNow]) l.close();

    section('Shopping: variants, cart, codes, tracking, refunds, reviews, payouts');
    const D = await mk('dee');
    const td = D.accessToken;
    const shopRes = await call('POST', '/merchants', { token: td, body: { shopName: 'Dee Threads', slug: 'dee-threads', description: 'Tees', country: 'NG' } });
    ok(shopRes.status === 201, 'open a second shop');
    const tee = await call('POST', '/products', { token: td, body: { title: 'Logo Tee', kind: 'physical', priceMinor: 1000000, currency: 'NGN', stock: null, category: 'Fashion', tags: ['tee'], mediaIds: [(await upload(td, 'image', 'tee')).id] } });
    const cap = await call('POST', '/products', { token: td, body: { title: 'Dad Cap', kind: 'physical', priceMinor: 500000, currency: 'NGN', stock: 5, category: 'Fashion', tags: ['cap'], mediaIds: [(await upload(td, 'image', 'cap')).id] } });
    ok(tee.status === 201 && cap.status === 201, 'create two products');
    ok((await call('PUT', `/products/${tee.json.id}/variants`, { token: tb, body: { variants: [{ label: 'S' }] } })).status === 404, "others cannot change a product's options");
    ok((await call('PUT', `/products/${tee.json.id}/variants`, { token: td, body: { variants: [{ label: 'S', stock: 1 }, { label: 's', stock: 1 }] } })).status === 400, 'two options cannot share a name');
    const withV = await call('PUT', `/products/${tee.json.id}/variants`, { token: td, body: { variants: [{ label: 'S', options: { size: 'S' }, stock: 2 }, { label: 'M', options: { size: 'M' }, priceMinor: 1200000, stock: 1 }] } });
    ok(withV.status === 200 && withV.json.variants.length === 2 && withV.json.inStock === true, 'set sizes with their own stock and price');
    const [vS, vM] = withV.json.variants;
    ok(vM.priceMinor === 1200000, 'an option can have its own price');

    // cart
    ok((await call('POST', '/cart/items', { token: tb, body: { productId: tee.json.id, qty: 1 } })).status === 400, 'a product with sizes needs a size');
    ok((await call('POST', '/cart/items', { token: td, body: { productId: cap.json.id, qty: 1 } })).status === 400, 'you cannot put your own product in your cart');
    ok((await call('POST', '/cart/items', { token: tb, body: { productId: tee.json.id, variantId: vS.id, qty: 3 } })).status === 400, 'cannot add more than the stock');
    await call('POST', '/cart/items', { token: tb, body: { productId: tee.json.id, variantId: vS.id, qty: 2 } });
    const cart = await call('POST', '/cart/items', { token: tb, body: { productId: cap.json.id, qty: 2 } });
    ok(cart.json.count === 4 && cart.json.groups[0].subtotalMinor === 3000000 && cart.json.groups[0].ready, 'cart holds several items with a subtotal');
    ok((await call('GET', '/cart/count', { token: tb })).json.count === 4, 'cart badge count');
    const capLine = cart.json.items.find((i: any) => i.productId === cap.json.id);
    ok((await call('PATCH', `/cart/items/${capLine.id}`, { token: tb, body: { qty: 3 } })).json.count === 5, 'change a quantity');
    ok((await call('PATCH', `/cart/items/${capLine.id}`, { token: tc, body: { qty: 1 } })).status === 404, "cannot change someone else's cart");
    await call('PATCH', `/cart/items/${capLine.id}`, { token: tb, body: { qty: 2 } });

    // discount codes
    ok((await call('POST', '/merchant/discounts', { token: td, body: { code: 'BIG', kind: 'percent', value: 95 } })).status === 400, 'a percentage above 90 is refused');
    ok((await call('POST', '/merchant/discounts', { token: tb, body: { code: 'NOPE10', kind: 'percent', value: 10 } })).status === 400, 'only shops can make codes');
    const code = await call('POST', '/merchant/discounts', { token: td, body: { code: 'save10', kind: 'percent', value: 10, minSubtotalMinor: 1000000 } });
    ok(code.status === 201 && code.json.code === 'SAVE10', 'create a code (stored upper case)');
    ok((await call('POST', '/merchant/discounts', { token: td, body: { code: 'SAVE10', kind: 'percent', value: 5 } })).status === 409, 'a code name cannot repeat');
    const items = cart.json.items.map((i: any) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty }));
    const quote = await call('POST', '/orders/quote', { token: tb, body: { items, code: 'Save10' } });
    ok(quote.status === 200 && quote.json.subtotalMinor === 3000000 && quote.json.discountMinor === 300000 && quote.json.totalMinor === 2700000, 'quote applies 10% off');
    ok((await call('POST', '/orders/quote', { token: tb, body: { items, code: 'WRONG' } })).status === 400, 'an unknown code is refused');
    ok((await call('POST', '/orders/quote', { token: tb, body: { items: [{ productId: cap.json.id, qty: 1 }], code: 'SAVE10' } })).status === 400, 'a code below its minimum spend is refused');

    // checkout the whole cart, with the code
    const co = await call('POST', '/cart/checkout', { token: tb, body: { currency: 'NGN', code: 'SAVE10', shipping: ship } });
    ok(co.status === 201 && co.json.order.totalMinor === 2700000 && co.json.order.discountMinor === 300000 && co.json.order.items.length === 2, 'one checkout for several items');
    ok(co.json.order.feeMinor === 135000, 'fee is worked out on what the buyer actually paid');
    const stockOf = async (id: string) => (await pool.query('select stock from product_variants where id = $1', [id])).rows[0].stock;
    ok((await stockOf(vS.id)) === 0, 'the size is held while payment is pending');
    ok((await call('POST', '/orders', { token: tc, body: { items: [{ productId: tee.json.id, variantId: vS.id, qty: 1 }], shipping: ship } })).status === 400, 'a sold-out size cannot be bought');
    ok((await call('POST', '/orders/quote', { token: tb, body: { items, code: 'SAVE10' } })).status === 400, 'a code cannot be used twice by the same buyer');
    const payNgn = async (orderId: string, id: number, kobo: number, status = 'successful') => {
      const r = `bmuette-${orderId}`;
      flwTx.set(r, { ...(flwTx.get(r) as any), id: String(id), status, amount: kobo / 100, currency: 'NGN' } as any);
      return call('POST', '/webhooks/flutterwave', { headers: { 'verif-hash': 'whash' }, body: { event: 'charge.completed', data: { id, tx_ref: r } } });
    };
    await payNgn(co.json.order.id, 7001, 2700000);
    const paid1 = await call('GET', `/orders/${co.json.order.id}`, { token: tb });
    ok(paid1.json.status === 'paid' && paid1.json.timeline.map((e: any) => e.kind).join() === 'placed,paid', 'paying marks it paid and starts the timeline');
    ok((await call('GET', '/cart', { token: tb })).json.count === 0, 'paid items leave the cart');
    ok((await call('GET', '/merchant/discounts', { token: td })).json.items[0].usedCount === 1, 'the code counts its use');
    // a failed payment gives back the stock and the code
    const co2 = await call('POST', '/orders', { token: tc, body: { items: [{ productId: tee.json.id, variantId: vM.id, qty: 1 }], code: 'SAVE10', shipping: ship } });
    ok(co2.status === 201 && co2.json.order.totalMinor === 1080000, 'a variant price and a code combine');
    await payNgn(co2.json.order.id, 7002, 1080000, 'failed');
    ok((await stockOf(vM.id)) === 1 && (await call('GET', '/merchant/discounts', { token: td })).json.items[0].usedCount === 1, 'a failed payment returns the stock and the code');

    // tracking
    const mItems = (await call('GET', '/merchant/orders', { token: td })).json.items;
    const teeItem = mItems.find((i: any) => i.title === 'Logo Tee'); const capItem = mItems.find((i: any) => i.title === 'Dad Cap');
    ok(teeItem.variantLabel === 'S', 'the shop sees which size was bought');
    ok((await call('PATCH', `/merchant/order-items/${teeItem.id}`, { token: td, body: { status: 'shipped', carrier: 'GIG Logistics', trackingNumber: 'GIG123', trackingUrl: 'https://track.example/GIG123' } })).status === 200, 'shop adds tracking');
    const tracked = (await call('GET', `/orders/${co.json.order.id}`, { token: tb })).json;
    const tItem = tracked.items.find((i: any) => i.title === 'Logo Tee');
    ok(tItem.fulfilment === 'shipped' && tItem.trackingNumber === 'GIG123' && tracked.timeline.some((e: any) => e.kind === 'shipped'), 'buyer sees tracking and the timeline');
    ok((await call('POST', `/order-items/${capItem.id}/received`, { token: tc })).status === 404, "only the buyer can confirm it arrived");
    ok((await call('POST', `/order-items/${capItem.id}/received`, { token: tb })).status === 200, 'buyer confirms delivery');
    ok(tracked.items.every((i: any) => i.canRefund === false), 'nothing can be returned before it arrives');

    // refunds
    ok((await call('POST', `/order-items/${teeItem.id}/refund`, { token: tb, body: { reason: 'Wrong size' } })).status === 400, 'an item still in transit cannot be returned yet');
    ok((await call('POST', `/order-items/${capItem.id}/refund`, { token: tc, body: { reason: 'Changed my mind' } })).status === 404, "someone else's item cannot be returned");
    const rq = await call('POST', `/order-items/${capItem.id}/refund`, { token: tb, body: { reason: 'Arrived damaged', details: 'Brim is bent' } });
    ok(rq.status === 201 && rq.json.status === 'requested' && rq.json.amountMinor === 900000, 'ask for a refund (discount share is taken off)');
    ok((await call('POST', `/order-items/${capItem.id}/refund`, { token: tb, body: { reason: 'Again' } })).status === 400, 'one open request per item');
    ok((await call('GET', '/merchant/refunds', { token: td })).json.items.length === 1, 'the shop sees the request');
    ok((await call('POST', `/merchant/refunds/${rq.json.id}/decide`, { token: tb, body: { decision: 'approve' } })).status === 403, 'buyers cannot approve their own refund');
    const appr = await call('POST', `/merchant/refunds/${rq.json.id}/decide`, { token: td, body: { decision: 'approve', response: 'Sorry about that' } });
    ok(appr.status === 200 && appr.json.status === 'refunded' && flwRefunds.length === 1 && flwRefunds[0].amount === 9000, 'approving sends the money back through the payment provider');
    ok((await call('GET', `/orders/${co.json.order.id}`, { token: tb })).json.items.find((i: any) => i.title === 'Dad Cap').refundedMinor === 900000, 'the order shows what was refunded');

    // reviews
    const capItemId = (await call('GET', `/orders/${co.json.order.id}`, { token: tb })).json.items.find((i: any) => i.title === 'Dad Cap').id;
    ok((await call('POST', `/products/${cap.json.id}/reviews`, { token: ta, body: { orderItemId: capItemId, rating: 5 } })).status === 400, 'only buyers can review');
    ok((await call('POST', `/products/${tee.json.id}/reviews`, { token: tb, body: { orderItemId: capItemId, rating: 5 } })).status === 400, 'a review must match what was bought');
    const rev = await call('POST', `/products/${tee.json.id}/reviews`, { token: tb, body: { orderItemId: teeItem.id, rating: 5, body: 'Soft and true to size' } });
    ok(rev.status === 201 && rev.json.verified, 'leave a verified review');
    ok((await call('POST', `/products/${tee.json.id}/reviews`, { token: tb, body: { orderItemId: teeItem.id, rating: 4 } })).status === 409, 'one review per purchase');
    await call('POST', `/products/${cap.json.id}/reviews`, { token: tb, body: { orderItemId: capItemId, rating: 2, body: 'Bent brim' } });
    const revs = await call('GET', `/products/${tee.json.id}/reviews`);
    ok(revs.json.summary.count === 1 && revs.json.summary.avg === 5 && revs.json.summary.histogram[4] === 1 && revs.json.items[0].reviewer.username === 'bola', 'reviews list with a summary');
    const prodAfter = await call('GET', `/products/${tee.json.id}`);
    ok(prodAfter.json.rating.avg === 5 && prodAfter.json.merchant.rating.count === 2 && prodAfter.json.merchant.rating.avg === 3.5, 'products and the seller carry their ratings');
    ok((await call('PATCH', `/reviews/${rev.json.id}/reply`, { token: tb, body: { reply: 'thanks' } })).status === 403, 'only the shop can reply');
    ok((await call('PATCH', `/reviews/${rev.json.id}/reply`, { token: td, body: { reply: 'Thank you!' } })).json.reply === 'Thank you!', 'the shop replies');

    // refund: turned down, and provider failure that can be retried
    const rj = await call('POST', `/order-items/${(await call('POST', '/orders', { token: tc, body: { items: [{ productId: cap.json.id, qty: 2 }], shipping: ship } }).then(async (r) => { await payNgn(r.json.order.id, 7003, 1000000); o3 = r.json.order.id; return { json: r.json.order.items[0] }; }).then((r) => r.json)).id}/refund`, { token: tc, body: { reason: 'Not received' } });
    ok(rj.status === 400, 'an unshipped paid order cannot be returned in the first week');
    const o3item = (await pool.query(`select id from order_items where order_id = $1`, [o3])).rows[0].id;
    await pool.query(`update order_items set fulfilment = 'delivered', delivered_at = now() where id = $1`, [o3item]);
    const rq2 = await call('POST', `/order-items/${o3item}/refund`, { token: tc, body: { reason: 'Not as described' } });
    const rej = await call('POST', `/merchant/refunds/${rq2.json.id}/decide`, { token: td, body: { decision: 'reject', response: 'Item matches the photos' } });
    ok(rej.json.status === 'rejected', 'the shop can decline');
    const rq3 = await call('POST', `/order-items/${o3item}/refund`, { token: tc, body: { reason: 'Still not right' } });
    ok(rq3.status === 201, 'after a decline the buyer can ask again');
    flwRefundFail = true;
    const failed = await call('POST', `/merchant/refunds/${rq3.json.id}/decide`, { token: td, body: { decision: 'approve' } });
    ok(failed.json.status === 'approved' && failed.json.error, 'if the provider fails the refund stays approved with the error');
    flwRefundFail = false;
    ok((await call('POST', `/admin/api/refunds/${rq3.json.id}/decide`, { token: tb, body: { decision: 'approve' } })).status === 403, 'refunds can only be retried by admins or the shop');
    const retry = await call('POST', `/admin/api/refunds/${rq3.json.id}/decide`, { token: ta, body: { decision: 'approve' } });
    ok(retry.json.status === 'refunded' && flwRefunds.length === 2, 'retrying after the outage pays the buyer');
    ok((await call('GET', `/orders/${o3}`, { token: tc })).json.status === 'refunded', 'a fully refunded order is marked refunded');

    // payouts and fees
    const bal = (await call('GET', '/merchant/balance', { token: td })).json.balances[0];
    ok(bal.earnedMinor === 3700000 && bal.feesMinor === 90000 && bal.refundsMinor === 1900000 && bal.availableMinor === 1710000, 'balance shows earnings, fees kept, refunds and what can be paid out');
    await pool.query(`update merchant_ledger set available_at = now() + interval '3 days' where kind in ('sale','fee') and order_item_id = $1`, [teeItem.id]);
    const heldBal = (await call("GET", "/merchant/balance", { token: td })).json.balances[0];
    ok(heldBal.availableMinor === 0 && heldBal.pendingMinor === 1710000, 'new sales are held before they can be paid out');
    await pool.query(`update merchant_ledger set available_at = now() where order_item_id = $1`, [teeItem.id]);
    ok((await call('POST', '/merchant/payouts', { token: td, body: { currency: 'NGN', amountMinor: 100000 } })).status === 400, 'payout needs bank details first');
    await call('PUT', '/merchant/payout-details', { token: td, body: { details: 'GTBank 0123456789 Dee Threads' } });
    ok((await call('POST', '/merchant/payouts', { token: td, body: { currency: 'NGN', amountMinor: 1710001 } })).status === 400, 'cannot take out more than is available');
    const po = await call('POST', '/merchant/payouts', { token: td, body: { currency: 'NGN', amountMinor: 1000000 } });
    ok(po.status === 201 && po.json.status === 'requested', 'request a payout');
    ok((await call('GET', '/merchant/balance', { token: td })).json.balances[0].availableMinor === 710000, 'the requested amount is set aside at once');
    ok((await call('GET', '/admin/api/payouts', { token: tb })).status === 403, 'payouts are admin only');
    ok((await call('GET', '/admin/api/payouts?status=requested', { token: ta })).json.items.length === 1, 'admin sees the request');
    ok((await call('POST', `/admin/api/payouts/${po.json.id}/paid`, { token: ta, body: { reference: 'NIP-998877' } })).json.status === 'paid', 'admin marks it paid with a reference');
    ok((await call('POST', `/admin/api/payouts/${po.json.id}/paid`, { token: ta, body: { reference: 'again' } })).status === 404, 'a payout cannot be paid twice');
    const po2 = await call('POST', '/merchant/payouts', { token: td, body: { currency: 'NGN' } });
    ok(po2.status === 201 && po2.json.amountMinor === 710000, 'omitting the amount takes everything available');
    await call('POST', `/admin/api/payouts/${po2.json.id}/reject`, { token: ta, body: { note: 'Bank details do not match' } });
    const afterBal = (await call("GET", "/merchant/balance", { token: td })).json.balances[0];
    ok(afterBal.availableMinor === 710000 && afterBal.paidOutMinor === 1000000, 'a declined payout goes back into the balance');
    const money = (await call('GET', '/admin/api/commerce', { token: ta })).json;
    ok(money.currencies.some((c: any) => c.currency === 'NGN' && c.feesMinor > 0), 'admin sees fees earned');
    ok((await call('GET', '/merchant/ledger', { token: td })).json.items.length > 5, 'the shop can read its ledger');

    // products tagged in videos
    const vpost = await call('POST', '/posts', { token: td, body: { kind: 'video', caption: 'New drop', mediaIds: [(await upload(td, 'video', 'drop')).id], products: [{ productId: tee.json.id, atMs: 1500 }, { productId: cap.json.id }] } });
    ok(vpost.status === 201 && vpost.json.products.length === 2 && vpost.json.products[0].hasVariants === true && vpost.json.products[0].atMs === 1500, 'tag products in a video');
    ok((await call('PUT', `/posts/${vpost.json.id}/products`, { token: td, body: { products: [{ productId: prod.json.id }] } })).status === 400, "cannot tag someone else's product");
    ok((await call('PUT', `/posts/${vpost.json.id}/products`, { token: ta, body: { products: [] } })).status === 404, "cannot change tags on someone else's post");
    ok((await call('GET', `/posts/${vpost.json.id}`)).json.products.length === 2, 'viewers get the tagged products to tap and buy');

    section('Account deletion');
    await pool.query(`update order_items set fulfilment = 'delivered'`); // nothing left to ship
    ok((await call('POST', '/me/delete', { token: tc, body: { password: 'wrong password' } })).status === 401, 'deleting needs the right password');
    const delRes = await call('POST', '/me/delete', { token: tc, body: { password: 'correct horse' } });
    ok(delRes.status === 204, 'delete account');
    ok((await call('POST', '/auth/login', { body: { email: 'chi@test.dev', password: 'correct horse' } })).status === 401, 'deleted account cannot sign in');
    ok((await call('GET', '/users/chi')).status === 404, 'profile is gone');
    ok((await pool.query(`select count(*)::int n from users where email = 'chi@test.dev'`)).rows[0].n === 0, 'email is erased');

    console.log(`\nAll ${passed} checks passed.`);
    await stop();
  } catch (e) {
    console.error('\nServer log tail:\n' + logs.split('\n').slice(-15).join('\n'));
    await stop();
    throw e;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
