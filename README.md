# Civic Twin AI — City Intelligence Dashboard

A live city-intelligence dashboard: Node.js/Express backend with a SQLite-backed
simulated live-data engine, a rule-based AI copilot, and a real Leaflet map —
serving a static frontend with no build step.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite via `better-sqlite3` (file at `server/data/civic.db`, auto-created and seeded on first run)
- **Live updates:** Server-Sent Events (`/api/stream`) pushed every 4s from a server-side data simulator (random-walk traffic/water/health stats, rotating AI insights, hotspot intensity)
- **AI search box:** rule-based keyword matcher over the live data (no API key required)
- **Map:** Leaflet.js + OpenStreetMap/CARTO dark tiles, markers driven by live hotspot data
- **Frontend:** plain HTML/CSS/JS, no build tooling, served as static files by Express

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:4000**.

The SQLite database is created and seeded automatically on first run. Delete
`server/data/civic.db*` any time to reset to a clean seed state.

Change the port with `PORT=5000 npm start`.

## What's real vs. stubbed (read this before demoing)

**Fully functional:**
- Dashboard stats (traffic, water, reports, city health) — live, backend-driven, update every 4s
- AI Insights feed — rotates in new items generated server-side
- Live map with real markers (Leaflet + OpenStreetMap), filterable by Traffic/Water/Waste
- "Ask Civic Twin" AI search — real backend endpoint, answers from live data (rule-based, not an LLM)
- Recommended Actions — dismiss button actually updates the database
- Citizen Reports — the "Citizen Reports" nav item opens a real form that POSTs to the backend and is persisted in SQLite
- Alerts badge — reflects a real unresolved-alerts count from the backend
- Connection status indicator (bottom-left) — reflects actual SSE connection health

**Stubbed (shows a "coming soon" toast, does not error):**
- City Map / Infrastructure / Analytics nav links — no dedicated pages built yet
- City selector (top right) — only Hyderabad has simulated data right now

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/summary` | full dashboard snapshot (stats, hotspots, insights, health, actions, alerts) |
| GET | `/api/stream` | Server-Sent Events stream, pushes the same snapshot every 4s |
| GET | `/api/stats` | current stat values |
| GET | `/api/hotspots` | map hotspot markers |
| GET | `/api/insights?limit=20` | AI insight feed |
| GET | `/api/health` | city health score breakdown |
| GET | `/api/actions` | open recommended actions |
| POST | `/api/actions/:id/dismiss` | mark an action done |
| GET | `/api/alerts` | active alerts |
| GET | `/api/reports` | citizen reports |
| POST | `/api/reports` | submit a citizen report `{category, location, description}` |
| POST | `/api/ai/ask` | ask the AI copilot `{question}` |

## Known limitations

- AI answers are rule-based (keyword matching), not a real LLM — fine for a demo, but don't call it "GPT-powered" on stage
- Only Hyderabad has data; the city selector is cosmetic
- No auth/accounts — this is a single shared admin view, not multi-tenant
- No automated test suite; verified manually + one Playwright smoke test during development (not checked in)
- SQLite is a single file — fine for a hackathon demo, not for concurrent production traffic
