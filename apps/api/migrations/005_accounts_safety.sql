-- Accounts and safety: email verification, password reset, age and terms, bans, moderation.

alter table users
  add column email_verified_at timestamptz,
  add column terms_version     text,
  add column terms_accepted_at timestamptz,
  -- Only "is this person 18 or over" is kept, never the birth date. Selling and buying need it.
  add column is_adult          boolean not null default false,
  add column banned_at         timestamptz,
  add column ban_reason        text;

-- Everyone who signed up before these rules existed (test accounts) is treated as having accepted them.
update users set is_adult = true, terms_version = 'legacy', terms_accepted_at = created_at;

-- One-time 6 digit codes sent by email. Only a hash is stored.
create table auth_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('verify_email','reset_password')),
  code_hash  text not null,
  attempts   int not null default 0,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index auth_codes_user_idx on auth_codes (user_id, kind, created_at desc);

-- Every email the server sends. With the "log" email driver (development) nothing leaves the server,
-- so this is how you read the codes. With a real provider it is a simple delivery record.
create table email_outbox (
  id         bigserial primary key,
  to_email   text not null,
  subject    text not null,
  body       text not null,
  driver     text not null,
  status     text not null default 'sent',
  created_at timestamptz not null default now()
);
create index email_outbox_created_idx on email_outbox (created_at desc);

-- Reports can now target a comment, carry details, and be worked through by an admin.
alter table reports
  add column comment_id uuid references comments(id) on delete cascade,
  add column details    text,
  add column status     text not null default 'open' check (status in ('open','actioned','dismissed')),
  add column handled_by uuid references users(id) on delete set null,
  add column handled_at timestamptz,
  add column action     text,
  add column note       text;
create unique index reports_comment_uq on reports (reporter_id, comment_id) where comment_id is not null;
create index reports_status_idx on reports (status, created_at desc);

-- Who did what in the admin dashboard.
create table admin_actions (
  id          bigserial primary key,
  admin_id    uuid references users(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index admin_actions_created_idx on admin_actions (created_at desc);
