-- The shopping half: variants, cart, discount codes, tracking, returns and refunds, reviews, payouts, products tagged in videos.

create table product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  label       text not null,                 -- "M / Black"
  options     jsonb not null default '{}',   -- {"size":"M","colour":"Black"}
  price_minor bigint check (price_minor is null or price_minor >= 0),  -- null = the product's price
  stock       int check (stock is null or stock >= 0),                  -- null = unlimited
  position    int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index product_variants_product_idx on product_variants (product_id, position);

alter table products
  add column rating_avg   numeric(3,2) not null default 0,
  add column rating_count int not null default 0;

create table cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  qty        int not null check (qty between 1 and 20),
  created_at timestamptz not null default now()
);
create unique index cart_items_uq on cart_items (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table discount_codes (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references merchants(user_id) on delete cascade,
  code               text not null,
  kind               text not null check (kind in ('percent','fixed')),
  value              bigint not null check (value > 0),   -- percent (1-90) or minor units
  currency           char(3),                              -- required for fixed
  min_subtotal_minor bigint not null default 0,
  max_uses           int,
  used_count         int not null default 0,
  expires_at         timestamptz,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (kind <> 'fixed' or currency is not null)
);
create unique index discount_codes_uq on discount_codes (merchant_id, upper(code));

alter table orders
  add column discount_minor int8 not null default 0,
  add column discount_code_id uuid references discount_codes(id) on delete set null;

alter table order_items
  add column variant_id uuid references product_variants(id) on delete set null,
  add column variant_label text,
  add column discount_minor int8 not null default 0,   -- this line's share of the order discount
  add column fee_minor int8 not null default 0,        -- BMUETTE's cut of this line
  add column carrier text,
  add column tracking_number text,
  add column tracking_url text,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column refunded_minor int8 not null default 0;

-- Everything that happened to an order, for the tracking screen.
create table order_events (
  id         bigserial primary key,
  order_id   uuid not null references orders(id) on delete cascade,
  item_id    uuid references order_items(id) on delete cascade,
  kind       text not null,   -- placed, paid, shipped, delivered, refund_requested, refund_approved, refund_rejected, refunded
  note       text,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, id);

create table refund_requests (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  buyer_id      uuid not null references users(id) on delete cascade,
  merchant_id   uuid not null references merchants(user_id) on delete cascade,
  reason        text not null,
  details       text,
  amount_minor  int8 not null,
  status        text not null default 'requested' check (status in ('requested','approved','rejected','refunded')),
  response      text,
  decided_by    uuid references users(id) on delete set null,
  decided_at    timestamptz,
  refund_error  text,
  created_at    timestamptz not null default now()
);
create unique index refund_open_uq on refund_requests (order_item_id) where status in ('requested','approved','refunded');
create index refund_merchant_idx on refund_requests (merchant_id, status, created_at desc);
create index refund_status_idx on refund_requests (status, created_at desc);

create table reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  merchant_id   uuid not null references merchants(user_id) on delete cascade,
  reviewer_id   uuid not null references users(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  body          text not null default '',
  reply         text,
  replied_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (order_item_id)
);
create index reviews_product_idx on reviews (product_id, created_at desc);
create index reviews_merchant_idx on reviews (merchant_id);

-- Money owed to merchants. Positive = earned, negative = taken back or paid out.
create table merchant_ledger (
  id            bigserial primary key,
  merchant_id   uuid not null references merchants(user_id) on delete cascade,
  currency      char(3) not null,
  kind          text not null check (kind in ('sale','fee','refund','fee_refund','payout','payout_reversal')),
  amount_minor  int8 not null,
  order_item_id uuid references order_items(id) on delete set null,
  payout_id     uuid,
  available_at  timestamptz not null default now(),   -- sales are held for a few days first
  note          text,
  created_at    timestamptz not null default now()
);
create index ledger_merchant_idx on merchant_ledger (merchant_id, currency, created_at desc);

create table payout_requests (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(user_id) on delete cascade,
  currency     char(3) not null,
  amount_minor int8 not null check (amount_minor > 0),
  status       text not null default 'requested' check (status in ('requested','paid','rejected')),
  destination  text,       -- bank details as typed by the merchant
  reference    text,       -- the transfer reference the admin entered
  note         text,
  handled_by   uuid references users(id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index payout_status_idx on payout_requests (status, created_at desc);
create index payout_merchant_idx on payout_requests (merchant_id, created_at desc);

alter table merchants add column payout_details text;

-- Products shown in a video: tap to buy.
create table post_products (
  post_id    uuid not null references posts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position   int not null default 0,
  at_ms      int,
  primary key (post_id, product_id)
);
create index post_products_product_idx on post_products (product_id);

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('like','comment','reply','follow','message','order_paid','order_update','sale','review','refund','payout','system'));
