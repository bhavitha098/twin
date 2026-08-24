# Civic Twin AI — City Intelligence Dashboard

A live city-intelligence dashboard with **zero backend**: a static HTML/CSS/JS
frontend talks directly to Supabase (Postgres + Row Level Security +
Realtime + Storage) from the browser. There is no server, no API routes, no
process to keep alive — deploy `public/` anywhere that serves static files
(Vercel, Netlify, GitHub Pages, a Supabase Storage public bucket, or just
open it locally).

## Stack

- **Database:** Supabase Postgres, read and written directly from the browser via `@supabase/supabase-js` and the public anon key. Every table has Row Level Security — see `supabase/schema.sql` for the exact policies. There is no service-role key anywhere in this app.
- **Live updates:** Supabase Realtime — the frontend subscribes to `postgres_changes` on every relevant table and re-renders when anything changes, from any browser tab, anywhere.
- **Mock data generator ("Simulate"):** a button, not a background process. Clicking it runs a batch of random-walk updates directly against Supabase (stats, hotspot intensity, occasional insight/alert/action). Nothing moves until you click it — that's deliberate, so a demo is never waiting on a timer to do something interesting.
- **AI copilot:** a live-data-grounded pattern matcher running entirely in the browser — not an LLM. There's no server to hold a secret API key, so this intentionally does not call Claude/GPT/etc. It answers from whatever is currently loaded from Supabase (traffic, hotspots, health score, reports), same as before, just running client-side. See "Adding a real LLM" below if you want to change that.
- **Photo uploads:** citizen reports can attach a photo, uploaded directly from the browser to the Supabase Storage `report-photos` bucket via the anon key (RLS restricts it to image uploads under 5MB).
- **Map:** Leaflet.js + OpenStreetMap/CARTO dark tiles, markers driven by live hotspot data, with click-to-pin reporting.
- **Frontend:** plain HTML/CSS/JS (ES module), no build tooling.

## Run it

```bash
npm run dev
```

That's `npx serve public` under the hood — a static file server, nothing
project-specific. Then open **http://localhost:4000**. You can also just
open `public/index.html` directly, or deploy the `public/` folder as-is to
any static host.

`public/config.js` already has this project's Supabase URL and anon key
baked in (the anon key is meant to be public — Row Level Security is what
actually protects the data, not secrecy of this key). If you point this at
a different Supabase project, update `public/config.js` and re-run the
schema below against it.

## Applying schema / RLS changes

```bash
cp .env.example .env   # fill in SUPABASE_DB_URL from Supabase Settings -> Database
npm run db:migrate
```

This is the only thing that still needs a local secret (the DB connection
string, to run SQL via `psql`) — it's never read by the app itself and never
shipped to the browser.

## What's real vs. stubbed (read this before demoing)

**Fully functional:**
- Dashboard stats (traffic, water, reports, city health) — live, Supabase-backed, with 6h trend sparklines, updated instantly via Realtime whenever anyone changes the data
- "Simulate" button — generates realistic mock activity on demand, written directly to Supabase
- AI Insights feed, plus an on-demand "Generate" button that analyzes real 6h trend data for a fresh insight
- Live map with real markers (Leaflet + OpenStreetMap), filterable by Traffic/Water/Waste, with click-to-pin reporting
- "Ask Civic Twin" AI search — answers from live Supabase data via pattern matching (not an LLM — see above)
- Recommended Actions — dismiss button, replenished occasionally by Simulate
- Citizen Reports — real form, persisted in Supabase, optional photo upload to Supabase Storage, map-pin location
- Alerts — a real panel (not a toast) listing active alerts with a resolve button
- Connection status indicator (bottom-left) — reflects actual Supabase Realtime connection health

**Stubbed (shows a "coming soon" toast, does not error):**
- City Map / Infrastructure / Analytics nav links — no dedicated pages built yet
- City selector (top right) — only Hyderabad has simulated data right now

## Security model — read this before reusing this pattern elsewhere

There is no login. This is a single-shared-admin hackathon demo, so RLS
deliberately allows **any anon visitor** to: submit reports, run Simulate,
generate insights, dismiss actions, and resolve alerts. The `stats`,
`hotspots`, `insights`, `stat_history`, `actions`, and `alerts` tables all
have explicit anon write policies for exactly this reason — see the
"ANON WRITE POLICIES" section in `supabase/schema.sql`, which documents the
tradeoff inline. The `admins` table stays fully locked down (no policies at
all — only `service_role` or the `is_admin()` security-definer function can
touch it), and `is_admin()`-gated policies are left in place alongside the
anon ones, so adding real Supabase Auth later is a matter of tightening
those policies, not re-architecting.

**Do not reuse the anon-write pattern for anything with real users or real
data.**

## Adding a real LLM back

There's nowhere to safely put an API key in a pure static frontend. If you
want real Claude/GPT answers instead of the pattern matcher:
- Add a Supabase Edge Function that holds the key as a Supabase secret and proxies the request (`supabase functions deploy`), call it from the browser with `supabase.functions.invoke(...)`, or
- Bring back a thin server (only for this one endpoint) and keep everything else exactly as-is.

## Known limitations

- The AI copilot is pattern-matched from live data, not a real LLM (see above)
- Only Hyderabad has data; the city selector is cosmetic
- No auth/accounts — see "Security model" above
- No automated test suite; verified manually with Playwright during development (not checked in)
- RLS's `anon` write policies mean any visitor with the page open can generate mock data, dismiss actions, and resolve alerts — intentional for a shared-demo, not appropriate beyond that
