// Frontend for the Space Mission Design Game (vanilla JS, no build step)

const BUDGET = 1000; // fixed budget in "units"

// Three hardcoded rocket options.
// efficiency = how many km of range you get per 1 fuel unit.
const ROCKETS = [
  { id: 'falcon-lite', name: 'Falcon Lite', speed_kms: 15, fuel_capacity: 900, efficiency: 500, cost: 400 },
  { id: 'orion-heavy', name: 'Orion Heavy', speed_kms: 40, fuel_capacity: 60000, efficiency: 5000, cost: 900 },
  { id: 'star-hopper', name: 'Star Hopper', speed_kms: 5, fuel_capacity: 3000, efficiency: 200, cost: 1200 },
];

// Fetch JSON from our own backend and throw a friendly error on failure
async function api(path) {
  const resp = await fetch(path);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Request failed (${resp.status})`);
  return json;
}

function showError(el, message) {
  el.classList.remove('loading');
  el.innerHTML = `<div class="error">${message}</div>`;
}

function handleMeta(data) {
  if (data.meta && data.meta.source === 'fallback') {
    const banner = document.getElementById('banner');
    banner.textContent = data.meta.message || 'Live NASA data unavailable — showing last saved data.';
    banner.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// 1) Picture of the day
// ---------------------------------------------------------------------------
async function loadApod() {
  const el = document.getElementById('apod-content');
  el.classList.add('loading');
  el.textContent = 'Loading…';
  try {
    const data = await api('/api/apod');
    handleMeta(data);
    const media = data.media_type === 'image'
      ? `<img class="apod-image" src="${data.url}" alt="${data.title}" loading="lazy" />`
      : `<p class="muted">Today's APOD is not an image (${data.media_type}). <a href="${data.url}" target="_blank" rel="noopener">Open it here</a>.</p>`;
    el.classList.remove('loading');
    el.innerHTML = `
      ${media}
      <p class="apod-title">${data.title}</p>
      <p class="apod-date">${data.date}</p>
    `;
  } catch (err) {
    showError(el, `Could not load the picture of the day: ${err.message}. Try running "npm run fetch-data" first.`);
  }
}

// ---------------------------------------------------------------------------
// 2) Mission planner
// ---------------------------------------------------------------------------
const distanceCache = {}; // body -> distance_km (and date)

async function getDistance(body) {
  if (distanceCache[body]) return distanceCache[body];
  const data = await api(`/api/distance/${body}`);
  handleMeta(data);
  distanceCache[body] = data;
  return data;
}

async function updateDistanceInfo() {
  const body = document.getElementById('destination').value;
  const el = document.getElementById('distance-info');
  el.textContent = 'Distance: loading…';
  try {
    const data = await getDistance(body);
    const km = Number(data.distance_km);
    const au = (km / 149597870.7).toFixed(4);
    el.textContent = `Distance from Earth to ${body} (today): ${km.toLocaleString()} km (~${au} AU)`;
  } catch (err) {
    el.textContent = 'Distance: unavailable';
    alert(`Could not load distance: ${err.message}`);
  }
}

function computeMission(rocket, distanceKm) {
  const travelDays = distanceKm / (rocket.speed_kms * 86400);
  const fuelNeeded = distanceKm / rocket.efficiency;
  const failures = [];
  if (fuelNeeded > rocket.fuel_capacity) {
    failures.push(`Not enough fuel: need ${Math.ceil(fuelNeeded)} units, capacity is ${rocket.fuel_capacity}.`);
  }
  if (rocket.cost > BUDGET) {
    failures.push(`Over budget: costs ${rocket.cost} units, budget is ${BUDGET}.`);
  }
  return {
    success: failures.length === 0,
    failures,
    travelDays,
    fuelNeeded,
    maxRange: rocket.fuel_capacity * rocket.efficiency,
  };
}

function formatDays(days) {
  if (days < 1) return `${(days * 24).toFixed(1)} hours`;
  return `${days.toFixed(1)} days`;
}

async function launchMission() {
  const btn = document.getElementById('launch-btn');
  const resultEl = document.getElementById('mission-result');
  const body = document.getElementById('destination').value;
  const rocket = ROCKETS.find((r) => r.id === document.getElementById('rocket').value);

  btn.disabled = true;
  resultEl.classList.remove('hidden', 'success', 'fail');
  resultEl.textContent = 'Calculating trajectory…';

  try {
    const distance = await getDistance(body);
    const distanceKm = Number(distance.distance_km);
    const result = computeMission(rocket, distanceKm);

    const lines = [
      `<p class="result-detail">Destination: ${body.charAt(0).toUpperCase() + body.slice(1)}</p>`,
      `<p class="result-detail">Rocket: ${rocket.name}</p>`,
      `<p class="result-detail">Distance: ${distanceKm.toLocaleString()} km</p>`,
      `<p class="result-detail">Travel time: ${formatDays(result.travelDays)} (at ${rocket.speed_kms} km/s)</p>`,
      `<p class="result-detail">Fuel: ${Math.ceil(result.fuelNeeded)} of ${rocket.fuel_capacity} units</p>`,
      `<p class="result-detail">Cost: ${rocket.cost} of ${BUDGET} units</p>`,
    ];

    if (result.success) {
      resultEl.classList.add('success');
      resultEl.innerHTML = `<p class="result-headline">Mission success</p>${lines.join('')}`;
    } else {
      resultEl.classList.add('fail');
      const reasons = result.failures.map((f) => `<p class="result-detail">${f}</p>`).join('');
      resultEl.innerHTML = `<p class="result-headline">Mission failed</p>${lines.join('')}${reasons}`;
    }
  } catch (err) {
    resultEl.classList.remove('success', 'fail');
    resultEl.innerHTML = `<div class="error">Could not calculate the mission: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 3) Nearby asteroids
// ---------------------------------------------------------------------------
function formatNumber(n) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString();
}

async function loadAsteroids() {
  const el = document.getElementById('asteroids-content');
  el.classList.add('loading');
  el.textContent = 'Loading…';
  try {
    const data = await api('/api/asteroids');
    handleMeta(data);
    const rows = data.asteroids.map((a) => `
      <tr class="${a.hazardous ? 'hazardous' : ''}">
        <td>${a.name}</td>
        <td>${formatNumber(a.diameter_m)}</td>
        <td>${formatNumber(a.miss_distance_km)}</td>
        <td>${formatNumber(a.velocity_kms)}</td>
        <td>${a.hazardous ? '<span class="hazard-tag">⚠ HAZARDOUS</span>' : 'no'}</td>
      </tr>`).join('');
    el.classList.remove('loading');
    el.innerHTML = `
      <p class="muted">${data.count} asteroids passing Earth on ${data.date} (closest first)</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Diameter (m)</th><th>Miss distance (km)</th><th>Velocity (km/s)</th><th>Hazardous</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5">No asteroids found for today.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (err) {
    showError(el, `Could not load asteroid data: ${err.message}. Try running "npm run fetch-data" first.`);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  const rocketSelect = document.getElementById('rocket');
  for (const r of ROCKETS) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name} — speed ${r.speed_kms} km/s, fuel ${r.fuel_capacity}, cost ${r.cost}`;
    rocketSelect.appendChild(opt);
  }

  document.getElementById('destination').addEventListener('change', updateDistanceInfo);
  document.getElementById('launch-btn').addEventListener('click', launchMission);

  loadApod();
  loadAsteroids();
  updateDistanceInfo();
}

document.addEventListener('DOMContentLoaded', init);
