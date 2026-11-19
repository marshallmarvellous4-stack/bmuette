-- Direct messages. One conversation per pair of people.
create table conversations (
  id            uuid primary key default gen_random_uuid(),
  -- "smallerUserId:largerUserId". The unique index means two people can only ever have one chat.
  pair_key      text not null unique,
  last_message_id uuid,
  last_message_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  last_read_at    timestamptz not null default 'epoch',
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on conversation_members (user_id);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references users(id) on delete cascade,
  kind            text not null check (kind in ('text','image','post','product')),
  body            text,
  media_url       text,
  ref_id          uuid,
  -- Chosen by the app. Sending the same one twice (a retry on bad network) never makes a duplicate.
  client_id       text not null,
  created_at      timestamptz not null default now(),
  unique (sender_id, client_id),
  check (kind <> 'text'  or (body is not null and length(body) between 1 and 4000)),
  check (kind <> 'image' or media_url is not null),
  check (kind not in ('post','product') or ref_id is not null)
);
create index messages_conv_idx on messages (conversation_id, created_at desc, id desc);
