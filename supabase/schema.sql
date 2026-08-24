-- Civic Twin AI — Supabase schema
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query → Run).
-- Safe to re-run: seeding is guarded, and buckets/policies use IF NOT EXISTS / DROP+CREATE.

create extension if not exists pgcrypto;

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists stats (
  key   text primary key,
  value numeric not null,
  delta numeric not null default 0
);

create table if not exists stat_history (
  id          bigint generated always as identity primary key,
  key         text not null references stats(key) on delete cascade,
  value       numeric not null,
  recorded_at timestamptz not null default now()
);
create index if not exists stat_history_key_time_idx on stat_history (key, recorded_at desc);

create table if not exists hotspots (
  id        text primary key,
  type      text not null,
  label     text not null,
  detail    text not null,
  lat       numeric not null,
  lng       numeric not null,
  intensity numeric not null
);

create table if not exists insights (
  id         bigint generated always as identity primary key,
  icon       text not null,
  category   text not null,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists health_scores (
  category text primary key,
  score    int not null
);

create table if not exists actions (
  id         bigint generated always as identity primary key,
  priority   text not null,
  title      text not null,
  detail     text not null,
  dismissed  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id         bigint generated always as identity primary key,
  severity   text not null,
  message    text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  description text not null,
  location    text not null,
  lat         numeric,
  lng         numeric,
  photo_url   text,
  status      text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at  timestamptz not null default now()
);

-- Admin allowlist. Never exposed to anon/authenticated clients directly —
-- only readable via the is_admin() security-definer function below, and
-- writable only by the service_role key (used from the Supabase SQL editor
-- or the backend, both of which bypass RLS).
create table if not exists admins (
  email text primary key
);

-- =========================================================
-- is_admin(): lets RLS policies check admin membership without ever
-- granting client roles read access to the admins table itself.
-- =========================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admins a where a.email = (auth.jwt() ->> 'email')
  );
$$;

-- =========================================================
-- ROW LEVEL SECURITY
-- Every table has RLS enabled. Without this, the public anon key (which
-- ships in the frontend JS bundle) would have unrestricted read/write
-- access to everything — this is the single most important section here.
-- =========================================================

alter table stats         enable row level security;
alter table stat_history  enable row level security;
alter table hotspots      enable row level security;
alter table insights      enable row level security;
alter table health_scores enable row level security;
alter table actions       enable row level security;
alter table alerts        enable row level security;
alter table reports       enable row level security;
alter table admins        enable row level security;
-- admins: intentionally zero policies -> default-deny for anon/authenticated.
-- Only service_role (bypasses RLS) or is_admin() (security definer) can read it.

drop policy if exists "public read stats" on stats;
create policy "public read stats" on stats for select using (true);

drop policy if exists "public read stat_history" on stat_history;
create policy "public read stat_history" on stat_history for select using (true);

drop policy if exists "public read hotspots" on hotspots;
create policy "public read hotspots" on hotspots for select using (true);

drop policy if exists "public read insights" on insights;
create policy "public read insights" on insights for select using (true);

drop policy if exists "public read health_scores" on health_scores;
create policy "public read health_scores" on health_scores for select using (true);

drop policy if exists "public read actions" on actions;
create policy "public read actions" on actions for select using (true);
drop policy if exists "admin update actions" on actions;
create policy "admin update actions" on actions for update using (is_admin()) with check (is_admin());

drop policy if exists "public read alerts" on alerts;
create policy "public read alerts" on alerts for select using (true);
drop policy if exists "admin update alerts" on alerts;
create policy "admin update alerts" on alerts for update using (is_admin()) with check (is_admin());

drop policy if exists "public read reports" on reports;
create policy "public read reports" on reports for select using (true);
drop policy if exists "public submit reports" on reports;
create policy "public submit reports" on reports for insert with check (true);
drop policy if exists "admin update reports" on reports;
create policy "admin update reports" on reports for update using (is_admin()) with check (is_admin());

-- =========================================================
-- ANON WRITE POLICIES — zero-backend architecture
-- This app has NO server: the browser talks to Supabase directly with the
-- public anon key. There is no login, so "admin" actions (dismiss an
-- action, resolve an alert) and the on-demand "Simulate" data generator
-- are deliberately open to any anon visitor — that's the tradeoff of a
-- single-shared-admin hackathon demo with zero backend. Do not reuse this
-- pattern for anything with real users or real data; the fix, if this
-- ever needs to be real, is Supabase Auth + tightening these to
-- is_admin() the way "admin update actions/alerts" already do below.
-- =========================================================

drop policy if exists "anon simulate update stats" on stats;
create policy "anon simulate update stats" on stats for update using (true) with check (true);

drop policy if exists "anon simulate insert stat_history" on stat_history;
create policy "anon simulate insert stat_history" on stat_history for insert with check (true);

drop policy if exists "anon simulate update hotspots" on hotspots;
create policy "anon simulate update hotspots" on hotspots for update using (true) with check (true);

drop policy if exists "anon insert insights" on insights;
create policy "anon insert insights" on insights for insert with check (true);

drop policy if exists "anon simulate insert alerts" on alerts;
create policy "anon simulate insert alerts" on alerts for insert with check (true);

-- Two overlapping syncRealData() calls can both check "does this alert
-- already exist" before either has inserted (a classic TOCTOU race) and
-- both proceed to insert — this constraint makes the second insert fail
-- instead of creating a duplicate. The app already ignores insert errors
-- on this path, so no client-side change is needed.
create unique index if not exists alerts_unique_unresolved_msg on alerts (message) where resolved = false;

drop policy if exists "anon dismiss actions" on actions;
create policy "anon dismiss actions" on actions for update using (true) with check (true);

drop policy if exists "anon simulate insert actions" on actions;
create policy "anon simulate insert actions" on actions for insert with check (true);

create unique index if not exists actions_unique_open_title on actions (title) where dismissed = false;

drop policy if exists "anon update report status" on reports;
create policy "anon update report status" on reports for update using (true) with check (true);

drop policy if exists "anon resolve alerts" on alerts;
create policy "anon resolve alerts" on alerts for update using (true) with check (true);

-- =========================================================
-- STORAGE: citizen report photo uploads
-- =========================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read report photos" on storage.objects;
create policy "public read report photos"
  on storage.objects for select
  using (bucket_id = 'report-photos');

drop policy if exists "public upload report photos" on storage.objects;
create policy "public upload report photos"
  on storage.objects for insert
  with check (bucket_id = 'report-photos');

-- =========================================================
-- REALTIME: make sure these tables broadcast postgres_changes
-- (Supabase adds new tables to the default publication automatically in
-- most projects, but this makes it explicit and safe to re-run)
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'stats'
  ) then
    alter publication supabase_realtime add table stats, stat_history, hotspots, insights, health_scores, actions, alerts, reports;
  end if;
end $$;

-- =========================================================
-- SEED DATA (only runs once — guarded by "stats is empty")
-- =========================================================

do $$
declare
  k text;
  base numeric;
  v numeric;
  t timestamptz;
  i int;
begin
  if not exists (select 1 from stats) then

    insert into stats (key, value, delta) values
      ('traffic', 72, 12),
      ('reports_total', 0, 0),
      ('reports_unresolved', 0, 0),
      ('water_health', 94.2, 2.4),
      ('city_health', 87, 0);

    insert into hotspots (id, type, label, detail, lat, lng, intensity) values
      ('hs-1', 'traffic', 'NH-65 Traffic Hotspot', '72% congestion', 17.4483, 78.3915, 0.9),
      ('hs-2', 'water', 'Osman Sagar (Gandipet)', 'Awaiting first sync', 17.3378, 78.2601, 0.4),
      ('hs-3', 'waste', 'Ward 18 Complaints', '42% more complaints', 17.3850, 78.4867, 0.6),
      ('hs-4', 'traffic', 'Begumpet Junction', 'Moderate congestion', 17.4399, 78.4482, 0.5),
      ('hs-5', 'water', 'Hussain Sagar Overflow Watch', 'Monitoring', 17.4239, 78.4738, 0.4),
      ('hs-6', 'traffic', 'Kukatpally', 'Awaiting first sync', 17.4849, 78.4138, 0.3),
      ('hs-7', 'traffic', 'Gachibowli', 'Awaiting first sync', 17.4400, 78.3489, 0.3),
      ('hs-8', 'traffic', 'Dilsukhnagar', 'Awaiting first sync', 17.3687, 78.5247, 0.3),
      ('hs-9', 'traffic', 'Uppal', 'Awaiting first sync', 17.4008, 78.5591, 0.3),
      ('hs-10', 'traffic', 'Hitech City', 'Awaiting first sync', 17.4435, 78.3772, 0.3),
      ('hs-11', 'traffic', 'Ameerpet', 'Awaiting first sync', 17.4374, 78.4487, 0.3),
      ('hs-12', 'traffic', 'Miyapur', 'Awaiting first sync', 17.4966, 78.3520, 0.3),
      ('hs-13', 'traffic', 'LB Nagar', 'Awaiting first sync', 17.3495, 78.5508, 0.3),
      ('hs-14', 'traffic', 'Mehdipatnam', 'Awaiting first sync', 17.3949, 78.4378, 0.3),
      ('hs-15', 'traffic', 'Panjagutta', 'Awaiting first sync', 17.4262, 78.4519, 0.3),
      ('hs-16', 'traffic', 'Charminar / Old City', 'Awaiting first sync', 17.3616, 78.4747, 0.3),
      ('hs-17', 'traffic', 'ECIL', 'Awaiting first sync', 17.4707, 78.5615, 0.3),
      ('hs-18', 'traffic', 'Jubilee Hills', 'Awaiting first sync', 17.4239, 78.4092, 0.3),
      ('hs-19', 'traffic', 'Kondapur', 'Awaiting first sync', 17.4615, 78.3630, 0.3),
      ('hs-20', 'traffic', 'Nizampet', 'Awaiting first sync', 17.5085, 78.3789, 0.3),
      ('hs-21', 'traffic', 'Manikonda', 'Awaiting first sync', 17.4065, 78.3785, 0.3),
      ('hs-22', 'water', 'Safilguda Lake, Malkajgiri', 'Awaiting first sync', 17.4501, 78.5250, 0.4),
      ('hs-23', 'waste', 'Malakpet', 'Awaiting first sync', 17.3753, 78.5000, 0.3),
      ('hs-24', 'waste', 'LB Nagar Waste Zone', 'Awaiting first sync', 17.3495, 78.5508, 0.3);

    insert into insights (icon, category, title, body, created_at) values
      ('🚦', 'traffic', 'Traffic anomaly detected', 'Congestion near NH-65 is 31% higher than the normal evening average.', now() - interval '12 minutes'),
      ('🌧️', 'water', 'Flood risk increasing', 'Heavy rainfall may cause flooding in 3 low-lying zones.', now() - interval '28 minutes'),
      ('🗑️', 'waste', 'Waste collection issue', 'Ward 18 has received 42% more complaints this week.', now() - interval '1 hour');

    insert into health_scores (category, score) values
      ('Infrastructure', 92),
      ('Environment', 84),
      ('Public Safety', 91),
      ('Transport', 68);

    -- No seed rows for actions/alerts: both are populated exclusively by
    -- real threshold triggers in syncRealData() (real traffic %, rain
    -- probability, waste reports, AQI). A fresh install starts with an
    -- honest empty state instead of invented crises that never happened.

    -- Demo citizen reports, clearly labeled as such (never disguised as
    -- real submissions), so a fresh install isn't a dead-empty Citizen
    -- Reports list. Locations/categories are grounded in real, documented
    -- patterns rather than picked arbitrarily — e.g. Charminar/Old City's
    -- entry reflects GHMC's own sanitation-drive coverage of that zone
    -- (dense footfall, narrow lanes, recurring garbage buildup).
    insert into reports (category, description, location, lat, lng, status) values
      ('Waste', '[Demo seed data — not a real citizen submission] Overflowing garbage bin near the market.', 'Ward 18, Kothapet', 17.3850, 78.4867, 'open'),
      ('Waste', '[Demo seed data — not a real citizen submission] Uncollected trash pile for 3 days.', 'Malakpet main road', 17.3753, 78.5000, 'open'),
      ('Waste', '[Demo seed data — not a real citizen submission] Garbage not collected this week near the bus stand.', 'LB Nagar', 17.3495, 78.5508, 'in_progress'),
      ('Waste', '[Demo seed data — not a real citizen submission] Garbage buildup near the market lanes — narrow streets and heavy footfall make daily collection difficult, a known recurring issue in this zone per GHMC sanitation drives.', 'Charminar, Old City', 17.3616, 78.4747, 'open'),
      ('Traffic', '[Demo seed data — not a real citizen submission] Heavy congestion during evening rush hour.', 'NH-65, near Uppal', 17.4008, 78.5591, 'open'),
      ('Water', '[Demo seed data — not a real citizen submission] Suspected pipe leak, puddle forming daily.', 'Banjara Hills Road No. 12', 17.4126, 78.4487, 'open');

    -- Synthetic 24h backfill so trend charts have something to show on
    -- first load, instead of a flat line until the demo has been running
    -- for hours. 10-minute resolution, random-walked back from the seed
    -- value, clamped to a sane range per key.
    for k in select key from stats where key in ('traffic', 'water_health', 'city_health') loop
      select value into base from stats where key = k;
      v := base;
      for i in reverse 144..0 loop
        t := now() - (i * interval '10 minutes');
        v := v + (random() * 6 - 3);
        if k = 'water_health' then
          v := greatest(70, least(99.9, v));
        else
          v := greatest(20, least(98, v));
        end if;
        insert into stat_history (key, value, recorded_at) values (k, v, t);
      end loop;
    end loop;

  end if;
end $$;

-- =========================================================
-- ADMIN USER
-- After creating a user in Authentication → Users (email/password, or let
-- them sign up in-app), grant them admin powers by running:
--
--   insert into admins (email) values ('you@example.com')
--   on conflict (email) do nothing;
--
-- Do this in the SQL Editor (runs as postgres, bypasses RLS).
-- =========================================================
