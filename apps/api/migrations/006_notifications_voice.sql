-- Notifications, push tokens, notification settings, and voice notes in chat.

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,   -- who receives it
  actor_id        uuid references users(id) on delete cascade,            -- who caused it
  type            text not null check (type in ('like','comment','reply','follow','message','order_paid','order_update','sale','review','system')),
  post_id         uuid references posts(id) on delete cascade,
  comment_id      uuid references comments(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  order_id        uuid references orders(id) on delete cascade,
  title           text not null,
  body            text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc, id desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;
-- Liking the same post twice (like, unlike, like) or following again must not ping twice.
create unique index notifications_like_uq on notifications (user_id, actor_id, post_id) where type = 'like';
create unique index notifications_follow_uq on notifications (user_id, actor_id) where type = 'follow';

create table push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token        text not null unique,
  platform     text not null default 'unknown',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on push_tokens (user_id);

create table notification_prefs (
  user_id   uuid primary key references users(id) on delete cascade,
  likes     boolean not null default true,
  comments  boolean not null default true,
  follows   boolean not null default true,
  messages  boolean not null default true,
  orders    boolean not null default true
);

-- Audio files (voice notes now, music tracks later).
alter table media_assets drop constraint media_assets_kind_check;
alter table media_assets add constraint media_assets_kind_check check (kind in ('image','video','audio'));

alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check check (kind in ('text','image','post','product','voice'));
alter table messages add column duration_ms int;
alter table messages add constraint messages_voice_chk check (kind <> 'voice' or (media_url is not null and duration_ms is not null));
