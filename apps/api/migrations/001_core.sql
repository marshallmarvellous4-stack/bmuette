-- BMUETTE core schema. Postgres 16+, pgvector.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  username      text not null,
  display_name  text not null,
  bio           text not null default '',
  avatar_url    text,
  country       char(2),
  is_merchant   boolean not null default false,
  is_admin      boolean not null default false,
  follower_count  int not null default 0,
  following_count int not null default 0,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index users_email_uq    on users (lower(email));
create unique index users_username_uq on users (lower(username));
create index users_username_trgm      on users using gin (lower(username) gin_trgm_ops);

create table refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  family_id   uuid not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

create table blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Every uploaded file. Images live in object storage, videos in the video provider.
create table media_assets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  kind        text not null check (kind in ('image','video')),
  status      text not null default 'uploading' check (status in ('uploading','processing','ready','failed')),
  mime        text,
  bytes       bigint,
  storage_key text,            -- object key for images
  stream_uid  text,            -- provider id for videos
  url         text,            -- image URL, or HLS playlist for video
  thumb_url   text,
  width       int,
  height      int,
  duration_ms int,
  created_at  timestamptz not null default now()
);
create index media_owner_idx on media_assets (owner_id, created_at desc);
create index media_stream_idx on media_assets (stream_uid) where stream_uid is not null;

create table posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references users(id) on delete cascade,
  kind          text not null check (kind in ('video','photo')),
  caption       text not null default '',
  tags          text[] not null default '{}',
  -- "Act without leaving": {kind: buy|book|enroll|join_event|expert|order_food, product_id?, label?}
  cta           jsonb,
  status        text not null default 'published' check (status in ('pending','published','held','removed')),
  allow_download boolean not null default false,
  like_count    int not null default 0,
  comment_count int not null default 0,
  save_count    int not null default 0,
  share_count   int not null default 0,
  view_count    int not null default 0,
  report_count  int not null default 0,
  search        tsvector,
  embedding     vector(512),
  created_at    timestamptz not null default now()
);
create index posts_author_idx  on posts (author_id, created_at desc);
create index posts_recent_idx  on posts (created_at desc) where status = 'published';
create index posts_tags_idx    on posts using gin (tags);
create index posts_search_idx  on posts using gin (search);
create index posts_embed_idx   on posts using hnsw (embedding vector_cosine_ops);

create table post_media (
  post_id  uuid not null references posts(id) on delete cascade,
  media_id uuid not null references media_assets(id) on delete restrict,
  position int not null default 0,
  primary key (post_id, media_id)
);

create table likes (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index likes_post_idx on likes (post_id);

create table collections (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  name       text not null,
  is_private boolean not null default true,
  created_at timestamptz not null default now()
);
create index collections_owner_idx on collections (owner_id);

-- Saved posts or products, optionally filed in a board.
create table saves (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  post_id       uuid references posts(id) on delete cascade,
  product_id    uuid,
  collection_id uuid references collections(id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((post_id is null) <> (product_id is null))
);
create unique index saves_post_uq    on saves (user_id, post_id)    where post_id is not null;
create unique index saves_product_uq on saves (user_id, product_id) where product_id is not null;

create table comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  parent_id  uuid references comments(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comments_post_idx on comments (post_id, created_at);

-- "Seen" and "watched" are different signals, so they live in different tables.
create table impressions (
  user_id uuid not null references users(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create table views (
  id         bigserial primary key,
  user_id    uuid references users(id) on delete set null,
  post_id    uuid not null references posts(id) on delete cascade,
  watch_ms   int not null check (watch_ms >= 0),
  completion real not null check (completion between 0 and 1),
  replays    int not null default 0,
  created_at timestamptz not null default now()
);
create index views_post_idx on views (post_id);
create index views_user_idx on views (user_id, created_at desc);

-- Learned interest per tag, updated from views, likes and saves.
create table user_interests (
  user_id uuid not null references users(id) on delete cascade,
  tag     text not null,
  weight  real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

create table searches (
  id         bigserial primary key,
  user_id    uuid references users(id) on delete set null,
  query      text not null,
  created_at timestamptz not null default now()
);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  post_id     uuid references posts(id) on delete cascade,
  product_id  uuid,
  user_id     uuid references users(id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- One report per person per target, so five reports means five different people.
create unique index reports_post_uq on reports (reporter_id, post_id) where post_id is not null;
create unique index reports_user_uq on reports (reporter_id, user_id) where user_id is not null;

create or replace function posts_search_update() returns trigger language plpgsql as $$
begin
  new.search := to_tsvector('simple', coalesce(new.caption,'') || ' ' || array_to_string(new.tags, ' '));
  return new;
end $$;
create trigger posts_search_trg before insert or update of caption, tags on posts
  for each row execute function posts_search_update();
