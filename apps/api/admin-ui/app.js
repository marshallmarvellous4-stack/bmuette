(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const RT_KEY = 'bmuette.admin.rt';
const MARK = '<svg viewBox="0 0 32 32"><path d="M10 7h7a5 5 0 0 1 2.4 9.4A5.2 5.2 0 0 1 17.5 26H10Z" fill="#fff"/></svg>';

const S = { mod: { status: 'open', items: [], next: null, counts: {}, audit: [] }, token: null, rt: null, me: null, tab: 'overview', days: 7, auto: true, timer: null, ordersStatus: '', kinds: new Set(), cur: null, charts: {}, people: { q: '', items: [], next: null, total: 0 }, orders: { items: [], next: null }, act: { items: [], next: null }, loaded: false };
const store = { get: () => { try { return sessionStorage.getItem(RT_KEY); } catch { return null; } }, set: (v) => { try { v ? sessionStorage.setItem(RT_KEY, v) : sessionStorage.removeItem(RT_KEY); } catch {} } };

// ------------------------------------------------------------------ formatting
const nf = new Intl.NumberFormat();
const money = (minor, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(minor / 100); } catch { return `${cur} ${(minor / 100).toFixed(2)}`; } };
const moneyShort = (minor, cur) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100); } catch { return `${cur} ${Math.round(minor / 100)}`; } };
const ago = (iso) => { if (!iso) return 'never'; const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`; return new Date(iso).toLocaleDateString(); };
const abs = (iso) => (iso ? new Date(iso).toLocaleString() : '');
const clock = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bucketLabel = (t, unit, long) => { // t is "YYYY-MM-DDTHH:mm" already in the chosen zone
  const [d, h] = t.split('T'); const [y, m, dd] = d.split('-').map(Number);
  if (unit === 'hour') return `${h}${long ? ` · ${dd} ${MON[m - 1]}` : ''}`;
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  return long ? `${wk} ${dd} ${MON[m - 1]}` : `${dd} ${MON[m - 1]}`;
};
const delta = (cur, prev) => {
  if (!prev && !cur) return '<span class="delta flat">no change</span>';
  if (!prev) return '<span class="delta up">new</span>';
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return '<span class="delta flat">same as before</span>';
  return `<span class="delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p) >= 100 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)}%</span>`;
};

// ------------------------------------------------------------------ talking to the server
let refreshing = null;
async function refreshToken() {
  if (!S.rt) throw new Error('signed out');
  // One refresh at a time: the server treats a reused refresh token as theft and ends the session.
  refreshing ||= fetch('/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: S.rt }) })
    .then(async (r) => { if (!r.ok) throw new Error('signed out'); const j = await r.json(); S.token = j.accessToken; S.rt = j.refreshToken; store.set(S.rt); })
    .finally(() => { refreshing = null; });
  return refreshing;
}
async function api(path, retry = true) {
  let res;
  try { res = await fetch(`/admin/api/${path}`, { headers: { authorization: `Bearer ${S.token}` } }); }
  catch { throw Object.assign(new Error('Can’t reach the server'), { offline: true }); }
  if (res.status === 401 && retry) { try { await refreshToken(); } catch { signOut(); throw new Error('Signed out'); } return api(path, false); }
  if (res.status === 403) { signOut('This account is not an admin.'); throw new Error('Not an admin'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Error ${res.status}`);
  return res.json();
}
async function login(email, password) {
  const res = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 429 ? 'Too many attempts. Wait a minute.' : j.message || 'Could not sign in');
  S.token = j.accessToken; S.rt = j.refreshToken; S.me = j.user;
  const probe = await fetch('/admin/api/system', { headers: { authorization: `Bearer ${S.token}` } });
  if (probe.status === 403) { await fetch('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: S.rt }) }).catch(() => {}); S.token = S.rt = null; throw new Error('That account is not an admin. Run make-admin for it first (see the guide).'); }
  store.set(S.rt);
}
function signOut(message) {
  if (S.rt) fetch('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: S.rt }) }).catch(() => {});
  S.token = S.rt = S.me = null; store.set(null); clearInterval(S.timer); S.loaded = false;
  renderLogin(message);
}

// ------------------------------------------------------------------ charts (plain SVG)
function chart(key, { title, series, unit, fmt, kind = 'bar', sub = '', head = '', big }) {
  S.charts[key] = { series, unit, fmt, kind };
  const n = series.length, W = 600, H = 150, max = Math.max(1, ...series.map((p) => p.v));
  const bw = W / n;
  let body = '';
  if (kind === 'bar') body = series.map((p, i) => { const h = Math.max(p.v ? 3 : 0, (p.v / max) * (H - 6)); return `<rect x="${(i * bw + bw * 0.14).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${(bw * 0.72).toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(4, bw * 0.3).toFixed(1)}" fill="#0B0B0D" opacity="${i === n - 1 ? 0.5 : 1}"/>`; }).join('');
  else {
    const pts = series.map((p, i) => [(i + 0.5) * bw, H - 6 - (p.v / max) * (H - 14)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    body = `<path d="${d} L${pts[n - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z" fill="#0B0B0D" opacity=".07"/><path d="${d}" fill="none" stroke="#0B0B0D" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }
  const mid = series[Math.floor(n / 2)];
  return `<div class="card chart" data-chart="${key}">
    <div class="head"><div><h3 style="margin-bottom:4px">${esc(title)}</h3>${big !== undefined ? `<div class="big">${big}</div>` : ''}<div class="cap">${sub}</div></div>${head}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)} chart"><line x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}" stroke="#E6E6EA" vector-effect="non-scaling-stroke"/>${body}<rect class="hl" x="0" y="0" width="${bw}" height="${H}" fill="#0B0B0D" opacity="0"/></svg>
    <div style="display:flex;justify-content:space-between" class="cap"><span>${bucketLabel(series[0].t, unit)}</span><span>${bucketLabel(mid.t, unit)}</span><span>${bucketLabel(series[n - 1].t, unit)}</span></div></div>`;
}
const tip = $('#tip');
document.addEventListener('mousemove', (e) => {
  const c = e.target.closest?.('[data-chart]');
  if (!c || !S.charts[c.dataset.chart]) { tip.style.opacity = 0; document.querySelectorAll('.hl').forEach((h) => h.setAttribute('opacity', 0)); return; }
  const d = S.charts[c.dataset.chart], svg = $('svg', c), r = svg.getBoundingClientRect();
  if (e.clientY < r.top - 6 || e.clientY > r.bottom + 6) { tip.style.opacity = 0; return; }
  const i = Math.min(d.series.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * d.series.length)));
  const hl = $('.hl', svg); hl.setAttribute('x', (i * 600) / d.series.length); hl.setAttribute('opacity', 0.06);
  tip.textContent = `${bucketLabel(d.series[i].t, d.unit, true)}: ${d.fmt(d.series[i].v)}`;
  tip.style.opacity = 1; tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14)}px`; tip.style.top = `${e.clientY - 38}px`;
});

// ------------------------------------------------------------------ views
async function post(path, body, retry = true) {
  let res;
  try { res = await fetch(`/admin/api/${path}`, { method: 'POST', headers: { authorization: `Bearer ${S.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  catch { throw Object.assign(new Error('Can’t reach the server'), { offline: true }); }
  if (res.status === 401 && retry) { try { await refreshToken(); } catch { signOut(); throw new Error('Signed out'); } return post(path, body, false); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Error ${res.status}`);
  return res.json();
}
const view = () => $('#view');
function shell() {
  const tabs = [['overview', 'Overview'], ['people', 'People'], ['orders', 'Orders & payments'], ['moderation', 'Moderation'], ['money', 'Payouts & refunds'], ['activity', 'Activity'], ['errors', 'Errors'], ['system', 'System']];
  $('#app').innerHTML = `<header class="top"><div class="top-in">
      <div class="brand"><div class="mark">${MARK}</div>BMUETTE <small>Admin</small></div>
      <nav>${tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
      <div class="who"><span>${esc(S.me?.username || '')}</span><button class="link" data-act="signout">Sign out</button></div>
    </div></header><main id="view"></main>`;
}
function renderLogin(message) {
  $('#app').innerHTML = `<div class="login"><form class="card" id="lf" autocomplete="on">
    <div class="mark">${MARK}</div><h1>Admin</h1><p>Sign in with your BMUETTE admin account.</p>
    <label class="f" for="em">EMAIL</label><input class="in" id="em" type="email" autocomplete="username" required>
    <label class="f" for="pw">PASSWORD</label><input class="in" id="pw" type="password" autocomplete="current-password" required>
    <div class="err" id="le" role="alert">${esc(message || '')}</div>
    <button class="btn block" type="submit">Sign in</button></form></div>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('.btn', e.target); b.disabled = true; $('#le').textContent = '';
    try { await login($('#em').value.trim(), $('#pw').value); start(); } catch (err) { $('#le').textContent = err.message; b.disabled = false; }
  });
  $('#em').focus();
}
const skeleton = (rows = 4) => `<div class="grid g4">${Array.from({ length: rows }, () => '<div class="card"><div class="skeleton" style="width:50%"></div><div class="skeleton" style="height:30px;margin-top:14px;width:70%"></div></div>').join('')}</div>`;
const banner = (msg, bad) => `<div class="banner ${bad ? 'bad' : ''}" role="status">${esc(msg)}</div>`;
const bar = (title, extra = '') => `<div class="bar"><h2>${title}</h2>${extra}</div>`;
const rangeChips = () => `<div class="chips" role="group" aria-label="Time range">${[[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(([d, l]) => `<button class="chip ${S.days === d ? 'on' : ''}" data-days="${d}">${l}</button>`).join('')}</div>`;
const liveSwitch = () => `<span class="sw ${S.auto ? 'on' : ''}" data-act="auto" role="switch" aria-checked="${S.auto}" tabindex="0"><i></i>Live</span>`;
const stamp = () => `<span class="stamp" id="stamp">${S.updated ? `Updated ${clock(S.updated)}` : ''}</span>`;

function listRows(items, fmt, emptyMsg = 'Nothing yet in this period.') {
  if (!items.length) return `<div class="empty">${emptyMsg}</div>`;
  const max = Math.max(1, ...items.map((i) => i.w ?? 0));
  return `<div class="list">${items.map((i) => `<div class="row"><div class="a" style="flex:1"><div>${i.a}</div>${i.w !== undefined ? `<div class="bar2"><i style="width:${Math.max(3, (i.w / max) * 100)}%"></i></div>` : ''}</div><div class="b">${i.b}</div></div>`).join('')}</div>`;
}

function overviewHTML(o) {
  const k = o.kpis, a = o.attention, unit = o.window.unit;
  const tiles = [
    ['stuckPending', a.stuckPending, 'Orders waiting over 1 hour (payment may not have been confirmed)', 'orders:pending'],
    ['failed', a.failedPayments24h, 'Failed payments in the last 24 hours', 'orders:failed'],
    ['errors', a.serverErrors24h, 'Server errors in the last 24 hours', 'errors'],
    ['reports', a.reports7d, 'Open reports waiting for a decision', 'moderation'],
  ].map(([id, n, t, go]) => `<button class="attn ${n > 0 ? 'hot' : ''}" data-go="${go}" aria-label="${n} — ${esc(t)}"><div class="n">${n}</div><div class="t">${t}</div><span class="dot"></span></button>`).join('');

  const money1 = k.orders.money;
  const rev = money1.length ? money1.slice(0, 3).map((m) => `<div class="ml"><span>${money(m.gmvMinor, m.currency)}</span>${delta(m.gmvMinor, m.prevGmvMinor)}</div>`).join('') : '<div class="v m">No sales yet</div>';
  const fee = money1.length ? money1.slice(0, 3).map((m) => `<div class="ml"><span>${money(m.feeMinor, m.currency)}</span>${delta(m.feeMinor, m.prevFeeMinor)}</div>`).join('') : '<div class="v m">None yet</div>';
  const kpi = (label, v, sub, d) => `<div class="card kpi"><h3>${label}</h3><div class="v">${v}</div><div class="sub">${d ? d + ' · ' : ''}${sub}</div></div>`;
  const conv = k.orders.conversion === null ? '—' : `${Math.round(k.orders.conversion * 100)}%`;
  const cards = [
    `<div class="card kpi"><h3>Revenue (paid orders)</h3>${rev}<div class="sub">Sales value customers paid, before platform fee</div></div>`,
    `<div class="card kpi"><h3>Platform fees earned</h3>${fee}<div class="sub">${o.kpis.orders.money.length ? 'Your cut of those sales' : 'Your cut of each sale'}</div></div>`,
    kpi('Paid orders', nf.format(k.orders.paid.cur), `${nf.format(k.orders.created.cur)} started · ${conv} completed`, delta(k.orders.paid.cur, k.orders.paid.prev)),
    kpi('New signups', nf.format(k.users.newUsers.cur), `${nf.format(k.users.total)} people in total`, delta(k.users.newUsers.cur, k.users.newUsers.prev)),
    kpi('Active people', nf.format(k.users.active.cur), 'Used the app at least once', delta(k.users.active.cur, k.users.active.prev)),
    kpi('New posts', nf.format(k.content.posts.cur), `${nf.format(k.content.videos.cur)} videos · ${nf.format(k.content.photos.cur)} photos`, delta(k.content.posts.cur, k.content.posts.prev)),
    kpi('Video and photo views', nf.format(k.content.views.cur), `${nf.format(k.content.likes.cur)} likes · ${nf.format(k.content.comments.cur)} comments`, delta(k.content.views.cur, k.content.views.prev)),
    kpi('Messages sent', nf.format(k.content.messages.cur), `${nf.format(k.content.follows.cur)} new follows`, delta(k.content.messages.cur, k.content.messages.prev)),
    kpi('Shops', nf.format(k.market.merchants), `${nf.format(k.market.newMerchants.cur)} opened in this period`, delta(k.market.newMerchants.cur, k.market.newMerchants.prev)),
    kpi('Products for sale', nf.format(k.market.activeProducts), `${nf.format(k.market.newProducts.cur)} listed in this period`, delta(k.market.newProducts.cur, k.market.newProducts.prev)),
  ].join('');

  const cs = Object.keys(o.series.revenue);
  const curSel = S.cur && cs.includes(S.cur) ? S.cur : cs[0];
  const revSeries = curSel ? o.series.revenue[curSel] : o.series.paid.map((p) => ({ t: p.t, v: 0 }));
  const sumV = (s) => s.reduce((x, p) => x + p.v, 0);
  const label = o.window.days === 1 ? 'today' : `last ${o.window.days} days`;
  const charts = [
    chart('signups', { title: 'Signups', series: o.series.signups, unit, fmt: (v) => `${v} new`, big: nf.format(sumV(o.series.signups)), sub: label }),
    chart('active', { title: 'Active people', series: o.series.active, unit, fmt: (v) => `${v} active`, kind: 'line', big: nf.format(k.users.active.cur), sub: `unique people, ${label}` }),
    chart('revenue', { title: 'Revenue', series: revSeries, unit, fmt: (v) => (curSel ? money(v, curSel) : '0'), big: curSel ? money(sumV(revSeries), curSel) : '—', sub: label, head: cs.length > 1 ? `<select class="sel" data-act="cur" aria-label="Currency">${cs.map((c) => `<option ${c === curSel ? 'selected' : ''}>${c}</option>`).join('')}</select>` : curSel ? `<span class="pill">${curSel}</span>` : '' }),
    chart('paid', { title: 'Paid orders', series: o.series.paid, unit, fmt: (v) => `${v} paid`, big: nf.format(sumV(o.series.paid)), sub: `${nf.format(sumV(o.series.orders))} started, ${label}` }),
    chart('posts', { title: 'New posts', series: o.series.posts, unit, fmt: (v) => `${v} posts`, big: nf.format(sumV(o.series.posts)), sub: label }),
    chart('messages', { title: 'Messages', series: o.series.messages, unit, fmt: (v) => `${v} messages`, kind: 'line', big: nf.format(sumV(o.series.messages)), sub: label }),
  ].join('');

  const b = o.breakdowns;
  const lists = `<div class="grid g3 mt">
    <div class="card"><h3>Best-selling products</h3>${listRows(b.topProducts.map((p) => ({ a: esc(p.title), b: `${money(p.revenueMinor, p.currency)} · ${p.units} sold`, w: p.revenueMinor })))}</div>
    <div class="card"><h3>Top shops</h3>${listRows(b.topMerchants.map((p) => ({ a: esc(p.name), b: `${money(p.revenueMinor, p.currency)} · ${p.units} sold`, w: p.revenueMinor })))}</div>
    <div class="card"><h3>Most-watched posts</h3>${listRows(b.topPosts.map((p) => ({ a: `@${esc(p.username)} <span class="sm" style="color:var(--card-muted)">${esc(p.caption || p.kind)}</span>`, b: `${nf.format(p.views)} views`, w: p.views })))}</div>
    <div class="card"><h3>Signups by country</h3>${listRows(b.signupCountries.map((p) => ({ a: p.key === '??' ? 'Not given' : esc(p.key), b: nf.format(p.n), w: p.n })))}</div>
    <div class="card"><h3>Products for sale, by type</h3>${listRows(b.productKinds.map((p) => ({ a: esc(p.key), b: nf.format(p.n), w: p.n })), 'No products listed yet.')}</div>
    <div class="card"><h3>Payments by provider</h3>${listRows(b.providers.map((p) => ({ a: `${esc(p.provider)} · <span class="pill ${esc(p.status)}">${esc(p.status)}</span>`, b: `${p.n} · ${money(p.totalMinor, p.currency)}` })), 'No orders in this period.')}</div>
  </div>`;
  return `<div class="grid g4">${tiles}</div><div class="grid g4 mt">${cards}</div><div class="grid g2 mt">${charts}</div>${lists}`;
}

async function showOverview() {
  const first = !S.ov;
  if (first) view().innerHTML = bar('Overview') + skeleton(8);
  try {
    S.ov = await api(`overview?days=${S.days}&tz=${encodeURIComponent(TZ)}`); S.updated = new Date();
    view().innerHTML = bar('Overview', `${rangeChips()}${liveSwitch()}${stamp()}`) + overviewHTML(S.ov);
  } catch (e) { if (S.token) view().insertAdjacentHTML('afterbegin', banner(e.message + (e.offline ? '. Trying again shortly.' : ''), true)); }
}

const csv = (name, head, rows) => {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function peopleHTML() {
  const P = S.people;
  const rows = P.items.map((u) => `<tr><td><strong>@${esc(u.username)}</strong> ${u.isAdmin ? '<span class="pill">admin</span>' : ''}${u.isMerchant ? ' <span class="pill">shop</span>' : ''}${u.banned ? ' <span class="pill failed">banned</span>' : ''}<div class="sm">${esc(u.displayName)}</div></td><td>${esc(u.email)}${u.emailVerified ? '' : '<div class="sm">not verified</div>'}</td><td>${esc(u.country || '—')}</td><td title="${esc(abs(u.createdAt))}">${ago(u.createdAt)}</td><td title="${esc(abs(u.lastSeen))}">${ago(u.lastSeen)}</td><td class="num">${u.posts}</td><td class="num">${u.followers}</td><td class="num">${u.paidOrders}</td><td class="num">${u.isAdmin ? '' : u.banned ? `<button class="btn sm ghost" data-unban="${esc(u.id)}">Unban</button>` : `<button class="btn sm ghost" data-ban="${esc(u.id)}" data-name="${esc(u.username)}">Ban</button>`}</td></tr>`).join('');
  return bar('People', `<span class="stamp">${nf.format(P.total)} in total</span>`) + `<div class="card"><div class="tools"><input class="in" id="pq" type="search" placeholder="Search name, username or email" value="${esc(P.q)}" aria-label="Search people"><button class="btn sm ghost" data-act="csv-people">Download CSV</button></div>
    <div class="tw"><table><thead><tr><th>Person</th><th>Email</th><th>Country</th><th>Joined</th><th>Last seen</th><th class="num">Posts</th><th class="num">Followers</th><th class="num">Paid orders</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">No one matches.</td></tr>'}</tbody></table></div>
    ${P.next ? '<div class="more"><button class="btn sm" data-act="more-people">Show more</button></div>' : ''}</div>`;
}
async function loadPeople(more) {
  const P = S.people, p = new URLSearchParams({ limit: '25' }); if (P.q) p.set('q', P.q); if (more && P.next) p.set('cursor', P.next);
  const r = await api(`people?${p}`); P.items = more ? P.items.concat(r.items) : r.items; P.next = r.nextCursor; P.total = r.total;
}
async function showPeople(more) {
  try { await loadPeople(more); const q = $('#pq'); const had = q && document.activeElement === q; view().innerHTML = peopleHTML(); if (had) { const n = $('#pq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
  catch (e) { if (S.token) view().innerHTML = bar('People') + banner(e.message, true); }
}

const ST = [['', 'All'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['cancelled', 'Cancelled'], ['refunded', 'Refunded']];
function ordersHTML() {
  const O = S.orders;
  const rows = O.items.map((o) => `<tr><td title="${esc(abs(o.createdAt))}">${ago(o.createdAt)}${o.paidAt ? `<div class="sm">paid ${ago(o.paidAt)}</div>` : ''}</td><td>@${esc(o.buyer.username)}<div class="sm">${esc(o.buyer.email)}</div></td><td>${o.items.map((i) => `${i.qty} × ${esc(i.title)} <span class="sm">· ${esc(i.shop)}</span>`).join('<br>')}</td><td class="num">${money(o.totalMinor, o.currency)}</td><td class="num">${money(o.feeMinor, o.currency)}</td><td>${esc(o.provider)}<div class="sm mono">${esc(o.providerRef || '—')}</div></td><td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td></tr>`).join('');
  const ev = (S.events || []).map((e) => `<tr><td title="${esc(abs(e.at))}">${ago(e.at)}</td><td>${esc(e.provider)}</td><td class="mono">${esc(e.type || '—')}</td><td class="mono">${esc(e.ref || '—')}</td><td>${e.status ? `<span class="pill ${esc(String(e.status).toLowerCase().replace('successful', 'ok').replace('succeeded', 'ok'))}">${esc(e.status)}</span>` : ''}</td></tr>`).join('');
  return bar('Orders & payments', `${liveSwitch()}${stamp()}`) + `<div class="card"><div class="tools"><div class="chips">${ST.map(([k, l]) => `<button class="chip ${S.ordersStatus === k ? 'on' : ''}" data-ost="${k}">${l}</button>`).join('')}</div><span style="flex:1"></span><button class="btn sm ghost" data-act="csv-orders">Download CSV</button></div>
    <div class="tw"><table><thead><tr><th>When</th><th>Buyer</th><th>Items</th><th class="num">Total</th><th class="num">Platform fee</th><th>Provider</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">No orders here yet.</td></tr>'}</tbody></table></div>
    ${O.next ? '<div class="more"><button class="btn sm" data-act="more-orders">Show more</button></div>' : ''}</div>
    <div class="card mt"><h3>Messages from Stripe and Flutterwave</h3><div class="tw"><table><thead><tr><th>Received</th><th>Provider</th><th>Event</th><th>Reference</th><th>Result</th></tr></thead><tbody>${ev || '<tr><td colspan="5" class="empty">No payment messages received yet. When customers pay, the providers report here.</td></tr>'}</tbody></table></div></div>`;
}
async function loadOrders(more) {
  const O = S.orders, p = new URLSearchParams({ limit: '25' }); if (S.ordersStatus) p.set('status', S.ordersStatus); if (more && O.next) p.set('cursor', O.next);
  const [r, ev] = await Promise.all([api(`orders?${p}`), more ? S.events : api('payment-events?limit=30')]);
  O.items = more ? O.items.concat(r.items) : r.items; O.next = r.nextCursor; S.events = ev;
}
async function showOrders(more) {
  try { await loadOrders(more); S.updated = new Date(); view().innerHTML = ordersHTML(); } catch (e) { if (S.token) view().innerHTML = bar('Orders & payments') + banner(e.message, true); }
}

const ICON = { signup: 'NEW', session: 'IN', post: 'POST', comment: 'CMT', merchant: 'SHOP', product: 'ITEM', order: 'ORD', payment: 'PAID', report: 'RPT', webhook: 'HOOK', error: 'ERR' };
const KIND_LABEL = { signup: 'Signups', session: 'Sign-ins', post: 'Posts', comment: 'Comments', merchant: 'Shops', product: 'Products', order: 'Orders', payment: 'Payments', report: 'Reports', webhook: 'Provider messages', error: 'Errors' };
const sentence = (x) => {
  const u = `<strong>@${esc(x.actor)}</strong>`, d = esc(x.detail);
  return ({ signup: `${u} joined${x.detail ? ` from ${d}` : ''}`, session: `${u} signed in`, post: `${u} posted ${d}`, comment: `${u} commented “${d}”`, merchant: `${u} opened a shop: ${d}`, product: `${u} listed ${d}`, order: `${u} placed an order: ${d}`, payment: `${u} paid: ${d}`, report: `${u} reported something: “${d}”`, webhook: `<strong>${esc(x.actor)}</strong> sent ${d}`, error: `Server error ${d}` })[x.kind] || esc(x.detail);
};
const key = (x) => `${x.at}|${x.kind}|${x.ref}`;
function activityHTML(fresh = new Set()) {
  const items = S.act.items.map((x) => `<div class="it ${fresh.has(key(x)) ? 'new' : ''}"><div class="ic ${x.kind}">${ICON[x.kind] || '•'}</div><div class="tx"><div class="ln">${sentence(x)}</div><div class="tm" title="${esc(abs(x.at))}">${ago(x.at)} · ${esc(KIND_LABEL[x.kind] || x.kind)}</div></div></div>`).join('');
  return bar('Activity', `${liveSwitch()}${stamp()}`) + `<div class="card"><div class="tools"><div class="chips"><button class="chip ${S.kinds.size ? '' : 'on'}" data-kind="">Everything</button>${Object.entries(KIND_LABEL).map(([k, l]) => `<button class="chip ${S.kinds.has(k) ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div></div>
    <div class="feed">${items || '<div class="empty">Nothing has happened yet.</div>'}</div>${S.act.next ? '<div class="more"><button class="btn sm" data-act="more-act">Show older</button></div>' : ''}</div>`;
}
async function showActivity(more) {
  try {
    const p = new URLSearchParams({ limit: '60' }); if (S.kinds.size) p.set('kinds', [...S.kinds].join(',')); if (more && S.act.next) p.set('before', S.act.next);
    const r = await api(`activity?${p}`); const prev = new Set(S.act.items.map(key));
    const fresh = new Set(!more && S.act.items.length ? r.items.filter((x) => !prev.has(key(x))).map(key) : []);
    S.act.items = more ? S.act.items.concat(r.items) : r.items; S.act.next = r.nextBefore; S.updated = new Date();
    view().innerHTML = activityHTML(fresh);
  } catch (e) { if (S.token) view().innerHTML = bar('Activity') + banner(e.message, true); }
}

async function showErrors() {
  try {
    const rows = await api('errors?limit=100'); S.errors = rows; S.updated = new Date();
    view().innerHTML = bar('Errors', `${liveSwitch()}${stamp()}`) + `<div class="banner">Problems on the server (status 500 and above). Kept for 30 days. Only the request path and a short message are stored, never what people typed.</div><div class="card"><div class="tw"><table><thead><tr><th>When</th><th>Request</th><th>Status</th><th>Message</th></tr></thead><tbody>${rows.map((r) => `<tr><td title="${esc(abs(r.at))}">${ago(r.at)}</td><td class="mono">${esc(r.method)} ${esc(r.path)}</td><td><span class="pill error">${r.status}</span></td><td>${esc(r.message)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No server errors recorded. That is what you want.</td></tr>'}</tbody></table></div></div>`;
  } catch (e) { if (S.token) view().innerHTML = bar('Errors') + banner(e.message, true); }
}

const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const dur = (s) => (s > 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s > 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);
async function showSystem() {
  try {
    const [s, em] = await Promise.all([api('system'), api('emails?limit=10')]); S.updated = new Date(); const c = s.config;
    const yn = (b, y = 'Connected', n = 'Not set up') => (b ? `<span class="pill ok">${y}</span>` : `<span class="pill pending">${n}</span>`);
    view().innerHTML = bar('System', `${liveSwitch()}${stamp()}`) + (s.warnings.length ? `<div class="mt" style="margin:0 0 14px">${s.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}</div>` : '<div class="banner">Everything this page checks looks fine.</div>') +
      `<div class="grid g3">
      <div class="card"><h3>Server</h3><div class="kv"><span>Environment</span><span>${esc(c.env)}</span><span>Running for</span><span>${dur(s.runtime.uptimeSeconds)}</span><span>Memory</span><span>${s.runtime.rssMb} MB</span><span>Node</span><span>${esc(s.runtime.node)}</span><span>Live chat connections</span><span>${s.live.sockets} (${s.live.users} people)</span></div></div>
      <div class="card"><h3>Services</h3><div class="kv"><span>Database</span><span>${s.dbLatencyMs} ms · ${bytes(s.dbSizeBytes)}</span><span>Redis</span><span>${yn(s.redis === 'ok', 'Connected', s.redis === 'down' ? 'Down' : 'Not set up')}</span><span>Stripe</span><span>${yn(c.stripe)}</span><span>Flutterwave</span><span>${yn(c.flutterwave)}</span><span>AI search</span><span>${yn(c.ai, 'On', 'Off')}</span><span>Email</span><span>${yn(c.email === 'resend', 'Resend', 'Log only (dev)')}</span></div></div>
      <div class="card"><h3>Settings</h3><div class="kv"><span>Photos stored in</span><span>${esc(c.storage)}</span><span>Videos stored in</span><span>${esc(c.video)}</span><span>Platform fee</span><span>${c.platformFeePercent}%</span><span>Public address</span><span class="mono" style="word-break:break-all">${esc(c.publicBaseUrl)}</span></div></div>
      <div class="card"><h3>Data</h3><div class="kv">${Object.entries(s.counts).map(([k, v]) => `<span>${esc(k)}</span><span>${nf.format(v)}</span>`).join('')}</div></div>
      <div class="card" style="grid-column:1/-1"><h3>Latest emails${c.email === 'resend' ? '' : ' (development: nothing is really sent, read codes here)'}</h3><div class="tw"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Message</th></tr></thead><tbody>${em.items.map((m) => `<tr><td title="${esc(abs(m.at))}">${ago(m.at)}</td><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td class="sm" style="white-space:pre-wrap">${esc(m.body)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No emails yet.</td></tr>'}</tbody></table></div></div>
      <div class="card"><h3>Database updates applied</h3><div class="kv">${s.migrations.map((m) => `<span class="mono" style="grid-column:1/-1;text-align:left;color:var(--card-text)">${esc(m)}</span>`).join('')}</div></div></div>`;
  } catch (e) { if (S.token) view().innerHTML = bar('System') + banner(e.message, true); }
}

// ------------------------------------------------------------------ moderation
const REASON = { spam: 'Spam', nudity: 'Nudity', violence: 'Violence', harassment: 'Harassment', scam: 'Scam', counterfeit: 'Counterfeit', copyright: 'Copyright', child_safety: 'Child safety', other: 'Other' };
const TYPE_LABEL = { post: 'Post', product: 'Product', comment: 'Comment', user: 'Person' };
function actionsFor(r) {
  const t = r.target.type, hidden = ['held', 'removed', 'archived', 'banned'].includes(r.target.state);
  const b = (act, label, cls = 'ghost') => `<button class="btn sm ${cls}" data-resolve="${esc(r.id)}" data-action="${act}">${label}</button>`;
  if (r.status !== 'open') return `<span class="sm">${esc(r.action || '')}${r.note ? ` · ${esc(r.note)}` : ''}</span>`;
  const out = [b('dismiss', 'Dismiss')];
  if (t === 'user') out.push(b('ban', 'Ban person', 'danger'));
  else { out.push(b('remove', t === 'product' ? 'Take down' : 'Remove', 'danger')); if (hidden) out.push(b('restore', 'Restore')); out.push(b('ban', 'Remove + ban owner', 'danger')); }
  return out.join(' ');
}
function moderationHTML() {
  const M = S.mod, c = M.counts || {};
  const rows = M.items.map((r) => `<tr><td title="${esc(abs(r.createdAt))}">${ago(r.createdAt)}<div class="sm">by @${esc(r.reporter)}</div></td>
      <td><span class="pill">${TYPE_LABEL[r.target.type]}</span> <span class="pill ${['held', 'removed', 'archived', 'banned'].includes(r.target.state) ? 'failed' : 'ok'}">${esc(r.target.state)}</span><div>${esc(r.target.label || '')}</div><div class="sm">${esc(r.target.owner ? `@${r.target.owner}` : '')}</div></td>
      <td><strong>${esc(REASON[r.reason] || r.reason)}</strong>${r.details ? `<div class="sm">“${esc(r.details)}”</div>` : ''}${r.status === 'open' && r.openOnTarget > 1 ? `<div class="sm">${r.openOnTarget} open reports on this</div>` : ''}</td>
      <td class="acts">${actionsFor(r)}</td></tr>`).join('');
  const audit = (M.audit || []).map((a) => `<tr><td title="${esc(abs(a.at))}">${ago(a.at)}</td><td>@${esc(a.admin || '—')}</td><td>${esc(a.action)}</td><td>${esc(a.targetType)}</td><td class="sm">${esc(a.note || '')}</td></tr>`).join('');
  return bar('Moderation', `${liveSwitch()}${stamp()}`) + `<div class="card"><div class="tools"><div class="chips">${[['open', `Open (${c.open ?? 0})`], ['actioned', `Actioned (${c.actioned ?? 0})`], ['dismissed', `Dismissed (${c.dismissed ?? 0})`]].map(([k, l]) => `<button class="chip ${M.status === k ? 'on' : ''}" data-mst="${k}">${l}</button>`).join('')}</div></div>
    <div class="tw"><table><thead><tr><th>Reported</th><th>What was reported</th><th>Why</th><th>Decision</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">${M.status === 'open' ? 'No open reports. Nothing needs a decision.' : 'Nothing here yet.'}</td></tr>`}</tbody></table></div>
    ${M.next ? '<div class="more"><button class="btn sm" data-act="more-mod">Show more</button></div>' : ''}</div>
    <div class="card mt"><h3>What admins did (latest 30)</h3><div class="tw"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>On</th><th>Note</th></tr></thead><tbody>${audit || '<tr><td colspan="5" class="empty">No actions yet.</td></tr>'}</tbody></table></div></div>`;
}
async function showModeration(more) {
  try {
    const M = S.mod, p = new URLSearchParams({ status: M.status, limit: '25' }); if (more && M.next) p.set('cursor', M.next);
    const [r, a] = await Promise.all([api(`reports?${p}`), api('audit?limit=30')]);
    M.items = more ? M.items.concat(r.items) : r.items; M.next = r.nextCursor; M.counts = r.counts; M.audit = a.items; S.updated = new Date();
    view().innerHTML = moderationHTML();
  } catch (e) { if (S.token) view().innerHTML = bar('Moderation') + banner(e.message, true); }
}
async function decide(id, action) {
  let note;
  if (action === 'ban' || action === 'remove') { note = prompt(action === 'ban' ? 'Reason for the ban (the person will be told they are suspended):' : 'Short note for the record (optional):', ''); if (note === null) return; }
  try { await post(`reports/${id}/resolve`, { action, note: note || undefined }); } catch (e) { alert(e.message); }
  S.mod.items = []; showModeration();
}

// ------------------------------------------------------------------ payouts and refunds
async function showMoney() {
  try {
    const [m, po, rf] = await Promise.all([api('commerce'), api('payouts?status=requested'), api('refunds')]);
    S.updated = new Date();
    const cur = m.currencies.map((c) => `<tr><td>${esc(c.currency)}</td><td>${c.orders}</td><td>${money(c.grossMinor, c.currency)}</td><td>${money(c.feesMinor, c.currency)}</td><td>${money(c.discountsMinor, c.currency)}</td><td>${money(c.owedToShopsMinor, c.currency)}</td></tr>`).join('');
    const pay = po.items.map((p) => `<tr><td title="${esc(abs(p.createdAt))}">${ago(p.createdAt)}</td><td>${esc(p.shopName)}</td><td><strong>${money(p.amountMinor, p.currency)}</strong></td><td class="sm">${esc(p.destination || '')}</td>
      <td class="acts"><button class="btn sm" data-pay="${esc(p.id)}">Mark paid</button> <button class="btn sm danger" data-prej="${esc(p.id)}">Decline</button></td></tr>`).join('');
    const ref = rf.items.map((r) => `<tr><td title="${esc(abs(r.createdAt))}">${ago(r.createdAt)}</td><td>${esc(r.title)}${r.variantLabel ? ` (${esc(r.variantLabel)})` : ''}<div class="sm">${esc(r.buyerName || '')} from ${esc(r.shopName || '')}</div></td>
      <td>${esc(r.reason)}${r.details ? `<div class="sm">“${esc(r.details)}”</div>` : ''}</td><td>${money(r.amountMinor, r.currency)}</td>
      <td><span class="pill ${r.status === 'refunded' ? 'ok' : r.status === 'rejected' ? 'failed' : ''}">${esc(r.status)}</span>${r.error ? `<div class="sm">${esc(r.error)}</div>` : ''}</td>
      <td class="acts">${r.status === 'requested' || r.status === 'approved' ? `<button class="btn sm" data-rdec="${esc(r.id)}" data-dec="approve">${r.status === 'approved' ? 'Retry refund' : 'Refund'}</button>${r.status === 'requested' ? ` <button class="btn sm ghost" data-rdec="${esc(r.id)}" data-dec="reject">Decline</button>` : ''}` : ''}</td></tr>`).join('');
    view().innerHTML = bar('Payouts & refunds', stamp()) +
      `<div class="card"><h3>Money in and owed</h3><div class="tw"><table><thead><tr><th>Currency</th><th>Paid orders</th><th>Customers paid</th><th>BMUETTE fees</th><th>Discounts given</th><th>Owed to shops now</th></tr></thead><tbody>${cur || '<tr><td colspan="6" class="empty">No paid orders yet.</td></tr>'}</tbody></table></div></div>
       <div class="card mt"><h3>Payout requests (${po.items.length})</h3><p class="sm">Send the money by bank transfer, then press Mark paid and enter the transfer reference. BMUETTE does not move money to shops by itself.</p><div class="tw"><table><thead><tr><th>Asked</th><th>Shop</th><th>Amount</th><th>Send to</th><th></th></tr></thead><tbody>${pay || '<tr><td colspan="5" class="empty">No payouts waiting.</td></tr>'}</tbody></table></div></div>
       <div class="card mt"><h3>Return and refund requests</h3><div class="tw"><table><thead><tr><th>Asked</th><th>Item</th><th>Reason</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${ref || '<tr><td colspan="6" class="empty">No requests.</td></tr>'}</tbody></table></div></div>`;
  } catch (e) { if (S.token) view().innerHTML = bar('Payouts & refunds') + banner(e.message, true); }
}

// ------------------------------------------------------------------ navigation and events
async function show(tab, opts = {}) {
  S.tab = tab; if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'overview') return showOverview();
  if (tab === 'people') { if (!opts.keep) S.people = { q: S.people.q, items: [], next: null, total: 0 }; return showPeople(); }
  if (tab === 'orders') return showOrders();
  if (tab === 'moderation') return showModeration();
  if (tab === 'money') return showMoney();
  if (tab === 'activity') return showActivity();
  if (tab === 'errors') return showErrors();
  if (tab === 'system') return showSystem();
}
function schedule() {
  clearInterval(S.timer);
  S.timer = setInterval(() => {
    if (!S.auto || document.hidden || !S.token || S.tab === 'people') return;
    if (S.tab === 'moderation' && S.mod.items.length > 25) return;
    // Don't throw away rows someone has paged in or is reading.
    if (S.tab === 'orders' && S.orders.items.length > 25) return;
    if (S.tab === 'activity' && S.act.items.length > 60) return;
    show(S.tab, { keep: true }).then(() => { const s = $('#stamp'); if (s && S.updated) s.textContent = `Updated ${clock(S.updated)}`; });
  }, 30000);
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-pay],[data-prej],[data-rdec],[data-tab],[data-days],[data-act],[data-go],[data-ost],[data-kind],[data-mst],[data-resolve],[data-ban],[data-unban]'); if (!t) return;
  const d = t.dataset;
  if (d.pay) { const ref = prompt('Bank transfer reference (you have sent the money):', ''); if (!ref || ref.trim().length < 2) return; try { await post(`payouts/${d.pay}/paid`, { reference: ref.trim() }); } catch (err) { alert(err.message); } return showMoney(); }
  if (d.prej) { const note = prompt('Why is this payout declined? The shop will see this.', ''); if (!note || note.trim().length < 3) return; try { await post(`payouts/${d.prej}/reject`, { note: note.trim() }); } catch (err) { alert(err.message); } return showMoney(); }
  if (d.rdec) { const approve = d.dec === 'approve'; if (approve && !confirm('Refund the buyer through the payment provider now?')) return; const response = approve ? undefined : prompt('Reason shown to the buyer:', ''); if (!approve && response === null) return; try { await post(`refunds/${d.rdec}/decide`, { decision: d.dec, response: response || undefined }); } catch (err) { alert(err.message); } return showMoney(); }
  if (d.mst) { S.mod = { ...S.mod, status: d.mst, items: [], next: null }; return showModeration(); }
  if (d.resolve) return decide(d.resolve, d.action);
  if (d.ban) { const reason = prompt(`Ban @${d.name}? Their posts and shop are hidden and they are signed out. Reason (required):`, ''); if (!reason || reason.trim().length < 3) return; try { await post(`users/${d.ban}/ban`, { reason: reason.trim() }); } catch (err) { alert(err.message); } return showPeople(); }
  if (d.unban) { if (!confirm('Lift this ban?')) return; try { await post(`users/${d.unban}/unban`); } catch (err) { alert(err.message); } return showPeople(); }
  if (d.tab) { S.ov = null; S.act = { items: [], next: null }; S.orders = { items: [], next: null }; return show(d.tab); }
  if (d.days) { S.days = Number(d.days); S.ov = null; return show('overview'); }
  if (d.go) { const [tab, f] = d.go.split(':'); if (tab === 'orders') { S.ordersStatus = f || ''; S.orders = { items: [], next: null }; } if (tab === 'activity') { S.kinds = new Set(f ? [f] : []); S.act = { items: [], next: null }; } return show(tab); }
  if (d.ost !== undefined) { S.ordersStatus = d.ost; S.orders = { items: [], next: null }; return showOrders(); }
  if (d.kind !== undefined) { if (!d.kind) S.kinds.clear(); else S.kinds.has(d.kind) ? S.kinds.delete(d.kind) : S.kinds.add(d.kind); S.act = { items: [], next: null }; return showActivity(); }
  const a = d.act;
  if (a === 'signout') return signOut();
  if (a === 'auto') { S.auto = !S.auto; t.classList.toggle('on', S.auto); t.setAttribute('aria-checked', S.auto); return; }
  if (a === 'more-people') return showPeople(true);
  if (a === 'more-orders') return showOrders(true);
  if (a === 'more-act') return showActivity(true);
  if (a === 'more-mod') return showModeration(true);
  if (a === 'csv-people') return csv('people', ['username', 'name', 'email', 'country', 'joined', 'last seen', 'posts', 'followers', 'paid orders', 'shop', 'admin'], S.people.items.map((u) => [u.username, u.displayName, u.email, u.country, u.createdAt, u.lastSeen, u.posts, u.followers, u.paidOrders, u.isMerchant, u.isAdmin]));
  if (a === 'csv-orders') return csv('orders', ['order', 'created', 'paid', 'status', 'buyer', 'email', 'currency', 'total', 'platform fee', 'provider', 'provider ref', 'items'], S.orders.items.map((o) => [o.id, o.createdAt, o.paidAt, o.status, o.buyer.username, o.buyer.email, o.currency, o.totalMinor / 100, o.feeMinor / 100, o.provider, o.providerRef, o.items.map((i) => `${i.qty}x ${i.title}`).join('; ')]));
});
document.addEventListener('change', (e) => { if (e.target.dataset.act === 'cur') { S.cur = e.target.value; view().innerHTML = bar('Overview', `${rangeChips()}${liveSwitch()}${stamp()}`) + overviewHTML(S.ov); } });
let pqTimer;
document.addEventListener('input', (e) => { if (e.target.id === 'pq') { clearTimeout(pqTimer); pqTimer = setTimeout(() => { S.people.q = e.target.value.trim(); S.people.items = []; showPeople(); }, 300); } });
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.act === 'auto') { e.preventDefault(); e.target.click(); } });
window.addEventListener('online', () => S.token && show(S.tab, { keep: true }));

function start() {
  shell();
  const h = location.hash.slice(1); if (['overview', 'people', 'orders', 'moderation', 'money', 'activity', 'errors', 'system'].includes(h)) S.tab = h;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  show(S.tab); schedule();
}
(async () => {
  const rt = store.get();
  if (!rt) return renderLogin();
  S.rt = rt;
  try { await refreshToken(); const me = await fetch('/me', { headers: { authorization: `Bearer ${S.token}` } }).then((r) => r.json()); S.me = me; start(); }
  catch { store.set(null); renderLogin(); }
})();
})();
