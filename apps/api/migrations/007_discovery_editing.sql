-- Sounds (the music library) and non-destructive editing data on posts.

create table sounds (
  id          uuid primary key default gen_random_uuid(),
  file        text unique,                 -- file name in assets/sounds for library tracks
  title       text not null,
  artist      text not null,
  mood        text,
  bpm         int,
  duration_ms int not null,
  color       text,
  url         text not null,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

alter table posts
  add column sound_id        uuid references sounds(id) on delete set null,
  add column sound_volume    smallint not null default 70 check (sound_volume between 0 and 100),
  add column original_volume smallint not null default 100 check (original_volume between 0 and 100),
  -- Trim, filter and text overlays. The original file is never changed; the player applies these.
  add column edit            jsonb;

create index saves_collection_idx on saves (collection_id, created_at desc) where collection_id is not null;
