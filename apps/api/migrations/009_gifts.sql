-- Virtual gifts: coins people buy, gifts they send on posts (shown in the comments), and what creators earn.

create table gifts (
  slug   text primary key,
  name   text not null,
  coins  int not null check (coins > 0),
  tier   int not null check (tier between 1 and 4),   -- how grand the animation is
  sort   int not null default 0,
  active boolean not null default true
);
insert into gifts (slug, name, coins, tier, sort) values
  ('spark',     'Spark',      1,    1, 1),
  ('rose',      'Rose',       5,    1, 2),
  ('gem',       'Gem',        20,   2, 3),
  ('crown',     'Crown',      50,   2, 4),
  ('rocket',    'Rocket',     100,  3, 5),
  ('trophy',    'Trophy',     200,  3, 6),
  ('supernova', 'Supernova',  500,  4, 7),
  ('orbit',     'Orbit',      1000, 4, 8);

create table wallets (
  user_id uuid primary key references users(id) on delete cascade,
  coins   int not null default 0 check (coins >= 0)
);

-- Every change to a coin balance, so the balance can always be explained.
create table coin_ledger (
  id         bigserial primary key,
  user_id    uuid not null references users(id) on delete cascade,
  delta      int not null,
  kind       text not null check (kind in ('purchase','gift','refund','adjust')),
  ref        text,
  created_at timestamptz not null default now()
);
create index coin_ledger_user_idx on coin_ledger (user_id, id desc);

create table coin_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  pack_id      text not null,
  coins        int not null,
  currency     char(3) not null,
  amount_minor int8 not null,
  provider     text not null,
  provider_ref text,
  status       text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index coin_purchases_ref_idx on coin_purchases (provider, provider_ref);
create index coin_purchases_user_idx on coin_purchases (user_id, created_at desc);

create table gift_sends (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  post_id      uuid not null references posts(id) on delete cascade,
  gift_slug    text not null references gifts(slug),
  qty          int not null check (qty between 1 and 99),
  coins        int not null,                 -- total coins spent (price x qty at the time)
  earned_minor int8 not null,                -- what the creator earned, in NGN minor units
  message      text,
  created_at   timestamptz not null default now()
);
create index gift_sends_post_idx on gift_sends (post_id, created_at desc);
create index gift_sends_sender_idx on gift_sends (sender_id, created_at desc);
create index gift_sends_recipient_idx on gift_sends (recipient_id, created_at desc);

-- A gift appears in the comments as a special comment.
alter table comments
  add column kind text not null default 'text' check (kind in ('text','gift')),
  add column gift_send_id uuid references gift_sends(id) on delete set null;
alter table posts add column gift_coins int not null default 0;

-- Creators who are not shops can now earn and be paid out, so the money tables point at users.
alter table merchant_ledger drop constraint merchant_ledger_merchant_id_fkey;
alter table merchant_ledger add constraint merchant_ledger_user_fkey foreign key (merchant_id) references users(id) on delete cascade;
alter table payout_requests drop constraint payout_requests_merchant_id_fkey;
alter table payout_requests add constraint payout_requests_user_fkey foreign key (merchant_id) references users(id) on delete cascade;
alter table merchant_ledger drop constraint merchant_ledger_kind_check;
alter table merchant_ledger add constraint merchant_ledger_kind_check
  check (kind in ('sale','fee','refund','fee_refund','payout','payout_reversal','gift'));
alter table users add column payout_details text;
update users u set payout_details = m.payout_details from merchants m where m.user_id = u.id and m.payout_details is not null;

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','follow','message','order_paid','order_update','sale','review','refund','payout','gift','system'));
