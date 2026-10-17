# Space Mission Design Game

A small NASA Space Apps demo: a mini mission planner that uses **live NASA data**.
Pick a destination (Moon or Mars) and a rocket, press *Launch mission*, and see if
your mission succeeds. The app also shows today's Astronomy Picture of the Day and
a table of asteroids passing Earth today.

## Setup

1. Install dependencies (Node.js v18+ required):

   ```bash
   npm install
   ```

2. Create your environment file and add your free NASA API key
   (get one at https://api.nasa.gov):

   ```bash
   copy .env.example .env      # Windows
   # cp .env.example .env      # macOS / Linux
   ```

   Then edit `.env` and replace `your_key_here` with your key.

3. (Optional) Save a snapshot of today's NASA data for offline fallback:

   ```bash
   npm run fetch-data
   ```

4. Start the app:

   ```bash
   npm start
   ```

   Open **http://localhost:3000** in your browser.

## NASA data sources used

| Route | Source | What it provides |
|---|---|---|
| `GET /api/apod` | [NASA APOD](https://api.nasa.gov/planetary/apod) | Picture of the day (title, image, date) |
| `GET /api/asteroids` | [NASA NeoWs](https://api.nasa.gov/neo/rest/v1/feed) | Near-Earth asteroids for today (diameter, miss distance, velocity, hazardous flag) |
| `GET /api/distance/:body` | [JPL Horizons](https://ssd.jpl.nasa.gov/api/horizons.api) | Today's Earth→Moon (301) and Earth→Mars (499) distance in km (no API key needed) |

The browser only talks to **your** backend — the NASA API key stays in `.env` on
the server and is never sent to the client.

## How the mission calculation works

Each rocket has a **speed** (km/s), a **fuel capacity** (units), a **fuel
efficiency** (km of range per fuel unit), and a **cost** (units). The budget is a
fixed **1000 units**.

- **Travel time** = `distance_km / (speed_kms × 86 400)` — shown in days (or hours).
- **Fuel needed** = `distance_km / efficiency` — must fit inside the rocket's capacity.
- **Mission succeeds** if fuel needed ≤ capacity **and** cost ≤ 1000.
  Otherwise it fails and tells you why (out of fuel / over budget).

Rough scale of the real distances (from JPL Horizons, live): the Moon is ~384,000 km
away, Mars ~230,000,000 km. So Mars needs a long-range, efficient rocket — and the
demo's presets are tuned so *some* missions succeed and some fail, making it a real
choice.

## Notes

- Data is cached in memory for 10 minutes to respect NASA rate limits.
- If a NASA call fails (or your key is missing), the server serves the last saved
  files from `data/` (created by `npm run fetch-data`) and the UI shows a warning banner.
