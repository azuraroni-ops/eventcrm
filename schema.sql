-- EventCRM — Supabase Schema
-- Run this in your Supabase project → SQL Editor → New query

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "pg_net";
create extension if not exists "pg_cron";

-- ===========================
-- TABLES
-- ===========================

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  event_date    timestamptz,
  location      text,
  location_url  text,
  invitation_url text,
  blessing_email text,
  blessing_email_sent_at timestamptz,
  bit_link      text,
  created_at    timestamptz default now()
);

create table if not exists guests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references events(id) on delete cascade,
  name          text not null,
  phone         text,
  rsvp_status   text default 'pending' check (rsvp_status in ('pending','attending','not_attending')),
  num_guests    int default 0,
  num_children  int default 0,
  table_number  text,
  rsvp_token    uuid default gen_random_uuid() unique,
  rsvp_date     timestamptz,
  reminder_count int default 0,
  gift_amount   numeric default 0,
  gift_description text,
  blessing_text text,
  created_at    timestamptz default now()
);

create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references events(id) on delete cascade,
  guest_id      uuid references guests(id) on delete cascade,
  type          text,
  sent_at       timestamptz default now(),
  status        text default 'sent'
);

create table if not exists blessings (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references events(id) on delete cascade,
  guest_id      uuid references guests(id) on delete cascade,
  blessing_text text,
  submitted_at  timestamptz default now()
);

create table if not exists sending_sessions (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  hour_bucket   timestamptz,
  messages_sent int default 0,
  messages_failed int default 0,
  campaign_type text,
  created_at    timestamptz default now()
);

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references events(id) on delete cascade,
  category      text not null,
  description   text,
  amount        numeric not null default 0,
  paid          boolean default false,
  notes         text,
  created_at    timestamptz default now()
);

create table if not exists app_config (
  key           text primary key,
  value         text,
  updated_at    timestamptz default now()
);

-- ===========================
-- STORAGE
-- ===========================

-- Run in Supabase Dashboard → Storage → New bucket
-- Name: invitations | Public: true
-- Or via SQL (requires storage schema access):
-- insert into storage.buckets (id, name, public) values ('invitations', 'invitations', true)
-- on conflict (id) do nothing;

-- ===========================
-- ROW LEVEL SECURITY (optional but recommended)
-- ===========================

-- Disable RLS for single-user app (anon key has full access)
alter table events          disable row level security;
alter table guests          disable row level security;
alter table messages        disable row level security;
alter table blessings       disable row level security;
alter table sending_sessions disable row level security;
alter table expenses        disable row level security;
alter table app_config      disable row level security;

-- ===========================
-- BLESSINGS EMAIL FUNCTION (optional — requires pg_cron + pg_net)
-- ===========================

create or replace function send_blessings_emails()
returns void language plpgsql as $$
declare
  ev record;
  resend_key text;
  blessing_lines text;
  email_body text;
begin
  select value into resend_key from app_config where key = 'resend_api_key';
  if resend_key is null then return; end if;

  for ev in
    select e.id, e.name, e.event_date, e.blessing_email
    from events e
    where e.blessing_email is not null
      and e.blessing_email_sent_at is null
      and e.event_date + interval '4 hours' < now()
  loop
    select string_agg('• ' || b.blessing_text, E'\n') into blessing_lines
    from blessings b
    where b.event_id = ev.id and b.blessing_text is not null;

    if blessing_lines is null then continue; end if;

    email_body := '{"from":"EventCRM <noreply@yourdomain.com>","to":["' || ev.blessing_email ||
      '"],"subject":"ברכות מ' || ev.name || '","text":"' || replace(blessing_lines, '"', '\"') || '"}';

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := ('{"Authorization":"Bearer ' || resend_key || '","Content-Type":"application/json"}')::jsonb,
      body := email_body::jsonb
    );

    update events set blessing_email_sent_at = now() where id = ev.id;
  end loop;
end;
$$;

-- Schedule hourly (requires pg_cron enabled in Supabase)
-- select cron.schedule('send-blessings', '0 * * * *', 'select send_blessings_emails()');
