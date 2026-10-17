require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const NASA_BASE = 'https://api.nasa.gov';
const API_KEY = process.env.NASA_API_KEY;

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Simple in-memory cache (10 minutes) so we do not hit NASA rate limits
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function getCached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data;
  return undefined;
}

function setCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Fallback: if a NASA call fails, serve the last saved data from /data
// ---------------------------------------------------------------------------
function readFallback(fileName) {
  try {
    const filePath = path.join(__dirname, 'data', fileName);
    let text = fs.readFileSync(filePath, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Try live data first, then cached data, then the saved fallback file.
async function getData(cacheKey, fetcher, fallbackFile) {
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    if (!API_KEY) throw new Error('NASA_API_KEY is not set');
    const data = await fetcher();
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`[warn] live fetch failed for ${cacheKey}: ${err.message}`);
    const saved = readFallback(fallbackFile);
    if (saved) return { ...saved, meta: { source: 'fallback', message: 'Live NASA data unavailable — showing last saved data.' } };
    throw new Error(`Could not load ${cacheKey}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1) GET /api/apod -> NASA Astronomy Picture of the Day
// ---------------------------------------------------------------------------
app.get('/api/apod', async (req, res) => {
  try {
    const data = await getData(
      'apod',
      async () => {
        const url = `${NASA_BASE}/planetary/apod?api_key=${API_KEY}&thumbs=true`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`APOD responded ${resp.status}`);
        const json = await resp.json();
        return {
          title: json.title,
          date: json.date,
          explanation: json.explanation,
          url: json.url,
          hdurl: json.hdurl || null,
          media_type: json.media_type,
          copyright: json.copyright || null,
        };
      },
      'apod.json'
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2) GET /api/asteroids -> NASA NeoWs feed for today (cleaned list)
// ---------------------------------------------------------------------------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function cleanAsteroids(json) {
  const byDate = json.near_earth_objects || {};
  const list = [];
  for (const date of Object.keys(byDate)) {
    for (const neo of byDate[date]) {
      const approach = (neo.close_approach_data || [])[0] || {};
      const diameter = neo.estimated_diameter?.meters?.estimated_diameter_max ?? null;
      list.push({
        name: neo.name,
        diameter_m: diameter !== null ? Math.round(diameter) : null,
        miss_distance_km: approach.miss_distance?.kilometers ? Math.round(Number(approach.miss_distance.kilometers)) : null,
        velocity_kms: approach.relative_velocity?.kilometers_per_second
          ? Number(Number(approach.relative_velocity.kilometers_per_second).toFixed(2))
          : null,
        hazardous: Boolean(neo.is_potentially_hazardous_asteroid),
      });
    }
  }
  // Closest first — most interesting for the table
  list.sort((a, b) => (a.miss_distance_km ?? Infinity) - (b.miss_distance_km ?? Infinity));
  return list;
}

app.get('/api/asteroids', async (req, res) => {
  try {
    const data = await getData(
      'asteroids',
      async () => {
        const date = todayISO();
        const url = `${NASA_BASE}/neo/rest/v1/feed?api_key=${API_KEY}&start_date=${date}&end_date=${date}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`NeoWs responded ${resp.status}`);
        const json = await resp.json();
        return { date, count: json.element_count, asteroids: cleanAsteroids(json) };
      },
      'asteroids.json'
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3) GET /api/distance/:body -> JPL Horizons: Earth -> Moon (301) or Mars (499)
// ---------------------------------------------------------------------------
const BODIES = { moon: '301', mars: '499' };

async function fetchHorizonsDistance(bodyKey) {
  const today = todayISO();
  // Horizons needs START_TIME < STOP_TIME; a 1-day step gives one row (today)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${BODIES[bodyKey]}'`,
    CENTER: "'500@399'", // geocentric
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    START_TIME: `'${today}'`,
    STOP_TIME: `'${tomorrow}'`,
    STEP_SIZE: "'1 d'",
    REF_SYSTEM: "'ICRF'",
    OUT_UNITS: "'KM-S'",
  });
  const resp = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  if (!resp.ok) throw new Error(`Horizons responded ${resp.status}`);
  const text = await resp.text();

  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe === -1 || eoe === -1) throw new Error('Horizons returned no ephemeris data');

  // RG = observer range (km) — our distance from Earth to the body
  const match = text.slice(soe, eoe).match(/RG=\s*([-\d.E+]+)/);
  if (!match) throw new Error('Could not parse distance from Horizons');

  const distanceKm = Math.round(Number(match[1]));
  return { body: bodyKey, date: today, distance_km: distanceKm, unit: 'km' };
}

app.get('/api/distance/:body', async (req, res) => {
  const body = String(req.params.body || '').toLowerCase();
  if (!BODIES[body]) {
    return res.status(400).json({ error: 'Unknown body. Use "moon" or "mars".' });
  }
  try {
    const data = await getData(
      `distance:${body}`,
      () => fetchHorizonsDistance(body),
      'distances.json'
    );
    // distances.json stores { moon: {...}, mars: {...} } — unwrap for fallback
    if (data && data.meta && data.meta.source === 'fallback' && data[body]) {
      return res.json({ ...data[body], meta: data.meta });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Space Mission Design Game running at http://localhost:${PORT}`);
});
