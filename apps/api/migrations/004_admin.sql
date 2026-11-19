-- Server errors (5xx) kept for the admin dashboard. Old rows are pruned automatically.
create table error_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  method  text not null,
  path    text not null,          -- without the query string, which can hold tokens
  status  int not null,
  message text not null,
  user_id uuid
);
create index error_log_at_idx on error_log (at desc);

-- The dashboard reads "what happened in the last N days" from many tables.
create index if not exists users_created_idx         on users (created_at);
create index if not exists posts_created_idx         on posts (created_at);
create index if not exists comments_created_idx      on comments (created_at);
create index if not exists likes_created_idx         on likes (created_at);
create index if not exists views_created_idx         on views (created_at);
create index if not exists follows_created_idx       on follows (created_at);
create index if not exists orders_created_idx        on orders (created_at);
create index if not exists orders_paid_idx           on orders (paid_at) where paid_at is not null;
create index if not exists orders_status_idx         on orders (status, created_at);
create index if not exists refresh_tokens_created_idx on refresh_tokens (created_at);
create index if not exists merchants_created_idx     on merchants (created_at);
create index if not exists products_created_idx      on products (created_at);
create index if not exists reports_created_idx       on reports (created_at);
create index if not exists messages_created_idx      on messages (created_at);
create index if not exists payment_events_created_idx on payment_events (created_at);
