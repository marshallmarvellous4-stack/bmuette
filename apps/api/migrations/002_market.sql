create table merchants (
  user_id      uuid primary key references users(id) on delete cascade,
  shop_name    text not null,
  slug         text not null,
  description  text not null default '',
  country      char(2) not null,
  payout_provider text check (payout_provider in ('stripe','flutterwave')),
  payout_ref   text,            -- Stripe connected account id / Flutterwave subaccount id
  verified     boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index merchants_slug_uq on merchants (lower(slug));

create table products (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(user_id) on delete cascade,
  title        text not null,
  description  text not null default '',
  -- physical goods, digital goods, bookable services, courses, food, event tickets
  kind         text not null check (kind in ('physical','digital','service','course','food','ticket')),
  price_minor  bigint not null check (price_minor >= 0),
  currency     char(3) not null,
  stock        int check (stock is null or stock >= 0),   -- null = unlimited
  category     text not null default 'general',
  tags         text[] not null default '{}',
  status       text not null default 'active' check (status in ('draft','active','archived')),
  post_id      uuid references posts(id) on delete set null,  -- the video/photo that sells it
  like_count   int not null default 0,
  save_count   int not null default 0,
  sold_count   int not null default 0,
  search       tsvector,
  embedding    vector(512),
  created_at   timestamptz not null default now()
);
create index products_merchant_idx on products (merchant_id, created_at desc);
create index products_active_idx   on products (created_at desc) where status = 'active';
create index products_tags_idx     on products using gin (tags);
create index products_search_idx   on products using gin (search);
create index products_title_trgm   on products using gin (lower(title) gin_trgm_ops);
create index products_embed_idx    on products using hnsw (embedding vector_cosine_ops);

alter table saves add constraint saves_product_fk foreign key (product_id) references products(id) on delete cascade;
alter table reports add constraint reports_product_fk foreign key (product_id) references products(id) on delete cascade;

create unique index reports_product_uq on reports (reporter_id, product_id) where product_id is not null;

create table product_media (
  product_id uuid not null references products(id) on delete cascade,
  media_id   uuid not null references media_assets(id) on delete restrict,
  position   int not null default 0,
  primary key (product_id, media_id)
);

create table orders (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid not null references users(id),
  status         text not null default 'pending' check (status in ('pending','paid','failed','cancelled','refunded')),
  currency       char(3) not null,
  subtotal_minor bigint not null,
  fee_minor      bigint not null,           -- BMUETTE's cut
  total_minor    bigint not null,
  provider       text not null check (provider in ('stripe','flutterwave')),
  provider_ref   text,                      -- Stripe session id / Flutterwave tx_ref
  shipping       jsonb,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
create index orders_buyer_idx on orders (buyer_id, created_at desc);
create unique index orders_provider_ref_uq on orders (provider, provider_ref) where provider_ref is not null;

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  product_id       uuid not null references products(id),
  merchant_id      uuid not null references merchants(user_id),
  title            text not null,
  unit_price_minor bigint not null,
  qty              int not null check (qty > 0),
  fulfilment       text not null default 'pending' check (fulfilment in ('pending','shipped','delivered','cancelled'))
);
create index order_items_order_idx    on order_items (order_id);
create index order_items_merchant_idx on order_items (merchant_id);

-- Webhooks are delivered more than once. The unique key makes processing idempotent.
create table payment_events (
  provider   text not null,
  event_id   text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create or replace function products_search_update() returns trigger language plpgsql as $$
begin
  new.search := to_tsvector('simple', coalesce(new.title,'') || ' ' || coalesce(new.description,'') || ' ' ||
                                      coalesce(new.category,'') || ' ' || array_to_string(new.tags, ' '));
  return new;
end $$;
create trigger products_search_trg before insert or update of title, description, category, tags on products
  for each row execute function products_search_update();
