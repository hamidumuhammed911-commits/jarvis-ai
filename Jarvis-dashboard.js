/**
 * JARVIS DASHBOARD MODULE — V1.0.0
 * Live widgets: Clock, Weather, Battery, News Headlines
 * Drop-in addition to index.html — call initDashboard() after DOM load
 *
 * SETUP INSTRUCTIONS (in index.html):
 *   1. Paste the CSS block into your <style> tag
 *   2. Paste the HTML block where you want the dashboard (below .status-bar or above #chat)
 *   3. Add <script src="jarvis-dashboard.js"></script> before </body>
 *   4. Call initDashboard() in your existing DOMContentLoaded handler
 *
 * APIs used (all free, no key required except weather):
 *   - Clock: native JS Date
 *   - Battery: navigator.getBattery()
 *   - Weather: Open-Meteo (free, no key) + your existing GPS coords
 *   - News: GNews API free tier OR your existing Serper key (auto-detects)
 */

// ─────────────────────────────────────────────
// CSS — paste inside your existing <style> tag
// ─────────────────────────────────────────────
export const DASHBOARD_CSS = `
/* ── DASHBOARD GRID ── */
#jarvis-dashboard {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 8px;
  padding: 10px 14px;
  margin: 8px 0;
  position: relative;
}

/* shared widget base */
.jd-widget {
  background: rgba(0, 212, 255, 0.04);
  border: 1px solid rgba(0, 212, 255, 0.18);
  border-radius: 4px;
  padding: 10px 12px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.3s;
}
.jd-widget::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, #00d4ff55, transparent);
}
.jd-widget:hover {
  border-color: rgba(0, 212, 255, 0.45);
}

/* widget label */
.jd-label {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: #00d4ff88;
  text-transform: uppercase;
  margin-bottom: 4px;
}

/* ── CLOCK (spans both columns, top row) ── */
#jd-clock {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
}
#jd-time {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(22px, 6vw, 32px);
  font-weight: 700;
  color: #00d4ff;
  letter-spacing: 0.06em;
  text-shadow: 0 0 18px #00d4ff88;
  line-height: 1;
}
#jd-time .jd-seconds {
  font-size: 0.55em;
  color: #00d4ffaa;
  vertical-align: super;
}
#jd-date-day {
  text-align: right;
}
#jd-date {
  font-family: 'Share Tech Mono', monospace;
  font-size: 11px;
  color: #00d4ffcc;
  letter-spacing: 0.1em;
}
#jd-day {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  color: #00d4ff88;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

/* ── WEATHER ── */
#jd-weather .jd-weather-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
#jd-weather-icon {
  font-size: 26px;
  line-height: 1;
  filter: drop-shadow(0 0 6px #00d4ff66);
}
#jd-weather-temp {
  font-family: 'Orbitron', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #e0f8ff;
}
#jd-weather-desc {
  font-family: 'Rajdhani', sans-serif;
  font-size: 11px;
  color: #00d4ffaa;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 2px;
}
#jd-weather-extra {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
  color: #00d4ff66;
  margin-top: 4px;
}

/* ── BATTERY ── */
#jd-battery .jd-batt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
#jd-batt-bar-wrap {
  flex: 1;
  height: 10px;
  background: rgba(0,212,255,0.1);
  border: 1px solid rgba(0,212,255,0.25);
  border-radius: 2px;
  overflow: hidden;
}
#jd-batt-bar {
  height: 100%;
  background: linear-gradient(90deg, #1a6fff, #00d4ff);
  border-radius: 2px;
  transition: width 1s ease, background 0.5s;
}
#jd-batt-bar.low    { background: linear-gradient(90deg, #ff4466, #ff7744); }
#jd-batt-bar.medium { background: linear-gradient(90deg, #ffaa00, #ffcc44); }
#jd-batt-pct {
  font-family: 'Orbitron', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: #00d4ff;
  min-width: 38px;
  text-align: right;
}
#jd-batt-status {
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
  color: #00d4ff66;
  margin-top: 4px;
  letter-spacing: 0.1em;
}

/* ── NEWS ── */
#jd-news {
  grid-column: 1 / -1;
}
.jd-news-ticker {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
  max-height: 88px;
  overflow: hidden;
}
.jd-news-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  color: #b0dde8;
  line-height: 1.3;
  cursor: pointer;
  padding: 3px 0;
  border-bottom: 1px solid rgba(0,212,255,0.07);
  transition: color 0.2s;
}
.jd-news-item:last-child { border-bottom: none; }
.jd-news-item:hover { color: #00d4ff; }
.jd-news-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #00d4ff;
  flex-shrink: 0;
  margin-top: 4px;
  box-shadow: 0 0 5px #00d4ff;
}
.jd-news-source {
  font-family: 'Share Tech Mono', monospace;
  font-size: 8px;
  color: #00d4ff55;
  margin-top: 1px;
}
#jd-news-refresh {
  position: absolute;
  top: 8px; right: 10px;
  font-family: 'Share Tech Mono', monospace;
  font-size: 9px;
  color: #00d4ff55;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  transition: color 0.2s;
}
#jd-news-refresh:hover { color: #00d4ff; }

/* loading shimmer */
.jd-shimmer {
  background: linear-gradient(90deg, rgba(0,212,255,0.05) 25%, rgba(0,212,255,0.12) 50%, rgba(0,212,255,0.05) 75%);
  background-size: 200% 100%;
  animation: jd-shimmer 1.4s infinite;
  border-radius: 3px;
  height: 12px;
  width: 80%;
}
@keyframes jd-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* separator line above dashboard */
.jd-separator {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent);
  margin: 4px 14px;
}
`;

// ─────────────────────────────────────────────
// HTML — paste into index.html body
// ─────────────────────────────────────────────
export const DASHBOARD_HTML = `
<div class="jd-separator"></div>
<div id="jarvis-dashboard">

  <!-- CLOCK -->
  <div class="jd-widget" id="jd-clock">
    <div>
      <div class="jd-label">SYSTEM TIME</div>
      <div id="jd-time">00:00<span class="jd-seconds">:00</span></div>
    </div>
    <div id="jd-date-day">
      <div id="jd-date">-- --- ----</div>
      <div id="jd-day">------</div>
    </div>
  </div>

  <!-- WEATHER -->
  <div class="jd-widget" id="jd-weather">
    <div class="jd-label">ATMOSPHERIC</div>
    <div class="jd-weather-main">
      <span id="jd-weather-icon">⏳</span>
      <div>
        <div id="jd-weather-temp">--°C</div>
        <div id="jd-weather-desc">ACQUIRING</div>
      </div>
    </div>
    <div id="jd-weather-extra">HUM: --% · WIND: -- km/h</div>
  </div>

  <!-- BATTERY -->
  <div class="jd-widget" id="jd-battery">
    <div class="jd-label">POWER CELL</div>
    <div class="jd-batt-row">
      <div id="jd-batt-bar-wrap">
        <div id="jd-batt-bar" style="width:0%"></div>
      </div>
      <div id="jd-batt-pct">--%</div>
    </div>
    <div id="jd-batt-status">READING…</div>
  </div>

  <!-- NEWS -->
  <div class="jd-widget" id="jd-news">
    <div class="jd-label">INTEL FEED</div>
    <button id="jd-news-refresh" title="Refresh">↻ REFRESH</button>
    <div class="jd-news-ticker" id="jd-news-list">
      <div class="jd-shimmer"></div>
      <div class="jd-shimmer" style="width:65%"></div>
      <div class="jd-shimmer" style="width:75%"></div>
    </div>
  </div>

</div>
<div class="jd-separator"></div>
`;

// ─────────────────────────────────────────────
// JAVASCRIPT — the main module
// ─────────────────────────────────────────────

/**
 * WMO weather code → emoji + description
 */
const WMO_CODES = {
  0:  ['☀️', 'CLEAR'],
  1:  ['🌤', 'MOSTLY CLEAR'],
  2:  ['⛅', 'PARTLY CLOUDY'],
  3:  ['☁️', 'OVERCAST'],
  45: ['🌫', 'FOG'],
  48: ['🌫', 'ICING FOG'],
  51: ['🌦', 'LIGHT DRIZZLE'],
  53: ['🌦', 'DRIZZLE'],
  55: ['🌧', 'HEAVY DRIZZLE'],
  61: ['🌧', 'LIGHT RAIN'],
  63: ['🌧', 'RAIN'],
  65: ['🌧', 'HEAVY RAIN'],
  71: ['🌨', 'LIGHT SNOW'],
  73: ['❄️', 'SNOW'],
  75: ['❄️', 'HEAVY SNOW'],
  80: ['🌦', 'SHOWERS'],
  81: ['🌧', 'RAIN SHOWERS'],
  82: ['⛈', 'VIOLENT SHOWERS'],
  95: ['⛈', 'THUNDERSTORM'],
  96: ['⛈', 'HAIL STORM'],
  99: ['⛈', 'HEAVY HAIL'],
};

// ── CLOCK ──────────────────────────────────────
function startClock() {
  const timeEl = document.getElementById('jd-time');
  const dateEl = document.getElementById('jd-date');
  const dayEl  = document.getElementById('jd-day');
  const DAYS   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2,'0');
    const mm  = String(now.getMinutes()).padStart(2,'0');
    const ss  = String(now.getSeconds()).padStart(2,'0');
    timeEl.innerHTML = `${hh}:${mm}<span class="jd-seconds">:${ss}</span>`;
    dateEl.textContent = `${String(now.getDate()).padStart(2,'0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    dayEl.textContent  = DAYS[now.getDay()];
  }
  tick();
  setInterval(tick, 1000);
}

// ── BATTERY ────────────────────────────────────
async function initBattery() {
  const bar    = document.getElementById('jd-batt-bar');
  const pct    = document.getElementById('jd-batt-pct');
  const status = document.getElementById('jd-batt-status');

  function update(b) {
    const level = Math.round(b.level * 100);
    bar.style.width = level + '%';
    pct.textContent = level + '%';
    bar.className = level <= 20 ? 'low' : level <= 50 ? 'medium' : '';
    const chargingText = b.charging ? '⚡ CHARGING' : (level <= 20 ? '⚠ LOW POWER' : 'ON BATTERY');
    status.textContent = chargingText;
  }

  if ('getBattery' in navigator) {
    try {
      const battery = await navigator.getBattery();
      update(battery);
      battery.addEventListener('levelchange',   () => update(battery));
      battery.addEventListener('chargingchange', () => update(battery));
    } catch {
      pct.textContent = 'N/A';
      status.textContent = 'API UNAVAILABLE';
    }
  } else {
    pct.textContent = 'N/A';
    status.textContent = 'NOT SUPPORTED';
  }
}

// ── WEATHER ────────────────────────────────────
async function initWeather(lat, lon) {
  const iconEl  = document.getElementById('jd-weather-icon');
  const tempEl  = document.getElementById('jd-weather-temp');
  const descEl  = document.getElementById('jd-weather-desc');
  const extraEl = document.getElementById('jd-weather-extra');

  // Use Open-Meteo — completely free, no API key
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh&temperature_unit=celsius`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    const c    = data.current;
    const [icon, desc] = WMO_CODES[c.weather_code] || ['🌡', 'UNKNOWN'];
    iconEl.textContent  = icon;
    tempEl.textContent  = `${Math.round(c.temperature_2m)}°C`;
    descEl.textContent  = desc;
    extraEl.textContent = `HUM: ${c.relative_humidity_2m}% · WIND: ${Math.round(c.wind_speed_10m)} km/h`;
  } catch {
    descEl.textContent = 'SIGNAL LOST';
    extraEl.textContent = 'RETRY ON NEXT CYCLE';
  }
}

// ── NEWS ───────────────────────────────────────
// Uses GNews.io free tier (100 req/day) — set GNEWS_KEY or falls back to Serper via your /api/chat
async function fetchNews() {
  const list = document.getElementById('jd-news-list');

  // Strategy: try GNews free endpoint first, then fall back to a JARVIS AI fetch
  // Replace 'YOUR_GNEWS_KEY' with your actual key or set window.JARVIS_GNEWS_KEY
  const gnewsKey = window.JARVIS_GNEWS_KEY || '';

  let articles = [];

  if (gnewsKey) {
    try {
      const r = await fetch(`https://gnews.io/api/v4/top-headlines?lang=en&max=5&apikey=${gnewsKey}`);
      const d = await r.json();
      articles = (d.articles || []).map(a => ({ title: a.title, source: a.source?.name || 'GNews', url: a.url }));
    } catch { /* fall through */ }
  }

  // Fallback: use Serper via your own /api/news serverless function (see api/news.js below)
  if (!articles.length) {
    try {
      const r = await fetch('/api/news');
      const d = await r.json();
      articles = d.articles || [];
    } catch { /* fall through */ }
  }

  // Static fallback headlines so widget is never empty
  if (!articles.length) {
    articles = [
      { title: 'INTEL FEED OFFLINE — CHECK NETWORK', source: 'JARVIS', url: '#' },
      { title: 'ATTEMPTING RECONNECT…', source: 'SYS', url: '#' },
    ];
  }

  list.innerHTML = articles.slice(0, 4).map(a => `
    <div class="jd-news-item" onclick="window.open('${a.url}','_blank')">
      <span class="jd-news-dot"></span>
      <div>
        <div>${a.title}</div>
        <div class="jd-news-source">${(a.source || '').toUpperCase()}</div>
      </div>
    </div>
  `).join('');
}

// ── GPS BRIDGE ─────────────────────────────────
// Reads lat/lon from whatever your existing GPS system stored
function getCoords() {
  // Try common storage keys your existing code may use
  return new Promise(resolve => {
    // Check if already stored globally by your location module
    if (window._jarvisLat && window._jarvisLon) {
      return resolve({ lat: window._jarvisLat, lon: window._jarvisLon });
    }
    // Fresh GPS request
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        _  => resolve({ lat: 51.5074, lon: -0.1278 }) // London fallback
      );
    } else {
      resolve({ lat: 51.5074, lon: -0.1278 });
    }
  });
}

// ── PUBLIC INIT ────────────────────────────────
export async function initDashboard() {
  // Inject HTML if not already in DOM
  if (!document.getElementById('jarvis-dashboard')) {
    // Find insertion point — after status-bar or before chat container
    const anchor = document.querySelector('.status-bar') ||
                   document.querySelector('#chat') ||
                   document.querySelector('#messages') ||
                   document.body;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = DASHBOARD_HTML;
    if (anchor === document.body) {
      anchor.appendChild(wrapper);
    } else {
      anchor.insertAdjacentHTML('afterend', DASHBOARD_HTML);
    }
  }

  // Inject CSS
  if (!document.getElementById('jd-styles')) {
    const style = document.createElement('style');
    style.id = 'jd-styles';
    style.textContent = DASHBOARD_CSS;
    document.head.appendChild(style);
  }

  // Start all widgets
  startClock();
  await initBattery();

  const { lat, lon } = await getCoords();
  await initWeather(lat, lon);
  await fetchNews();

  // News refresh button
  document.getElementById('jd-news-refresh').addEventListener('click', async () => {
    document.getElementById('jd-news-list').innerHTML =
      '<div class="jd-shimmer"></div><div class="jd-shimmer" style="width:65%"></div>';
    await fetchNews();
  });

  // Auto-refresh weather every 10 min, news every 15 min
  setInterval(() => initWeather(lat, lon), 10 * 60 * 1000);
  setInterval(fetchNews,                   15 * 60 * 1000);
}