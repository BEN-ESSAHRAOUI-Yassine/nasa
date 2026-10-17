// Run once with "npm run fetch-data" to save a snapshot of live NASA data
// into /data. The server uses these files as a fallback when NASA is down.

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.NASA_API_KEY;
const NASA_BASE = 'https://api.nasa.gov';
const DATA_DIR = path.join(__dirname, '..', 'data');

// Reuse the same cleaning logic as server.js (kept simple: duplicated on purpose)
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
  list.sort((a, b) => (a.miss_distance_km ?? Infinity) - (b.miss_distance_km ?? Infinity));
  return list;
}

const BODIES = { moon: '301', mars: '499' };

async function fetchHorizonsDistance(bodyKey) {
  const today = todayISO();
  // Horizons needs START_TIME < STOP_TIME; a 1-day step gives one row (today)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${BODIES[bodyKey]}'`,
    CENTER: "'500@399'",
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
  const match = text.slice(soe, eoe).match(/RG=\s*([-\d.E+]+)/);
  if (!match) throw new Error('Could not parse distance from Horizons');
  return { body: bodyKey, date: today, distance_km: Math.round(Number(match[1])), unit: 'km' };
}

function save(fileName, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`saved ${path.relative(process.cwd(), filePath)}`);
}

async function main() {
  if (!API_KEY) {
    console.error('NASA_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }
  const date = todayISO();

  // 1) APOD
  try {
    const resp = await fetch(`${NASA_BASE}/planetary/apod?api_key=${API_KEY}&thumbs=true`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    save('apod.json', {
      title: json.title,
      date: json.date,
      explanation: json.explanation,
      url: json.url,
      hdurl: json.hdurl || null,
      media_type: json.media_type,
      copyright: json.copyright || null,
    });
  } catch (err) {
    console.warn(`skipping apod.json: ${err.message}`);
  }

  // 2) Asteroids (NeoWs feed for today)
  try {
    const resp = await fetch(`${NASA_BASE}/neo/rest/v1/feed?api_key=${API_KEY}&start_date=${date}&end_date=${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const asteroids = cleanAsteroids(json);
    save('asteroids.json', { date, count: asteroids.length, asteroids });
  } catch (err) {
    console.warn(`skipping asteroids.json: ${err.message}`);
  }

  // 3) Distances (JPL Horizons, no API key needed)
  const distances = {};
  for (const body of Object.keys(BODIES)) {
    try {
      distances[body] = await fetchHorizonsDistance(body);
      console.log(`${body}: ${distances[body].distance_km} km`);
    } catch (err) {
      console.warn(`skipping ${body}: ${err.message}`);
    }
  }
  if (Object.keys(distances).length > 0) save('distances.json', distances);

  console.log('done');
}

main();
