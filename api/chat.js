// ═══════════════════════════════════════════════════════════════════════════
// JARVIS FRONTEND PATCH v2
// Paste this block INSIDE your <script> tag, replacing / augmenting the
// existing sendMessage() and related helpers.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. LOCATION — fetch once, keep in memory ────────────────────────────────
let jarvisLocation = null;

function initLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      // Reverse-geocode city name via free Nominatim API
      let city = '';
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
          { headers: { 'User-Agent': 'JARVIS-AI/2.0' } }
        );
        const d = await r.json();
        city = d.address?.city || d.address?.town || d.address?.village || '';
      } catch (_) {}

      jarvisLocation = { lat, lon, city };
      console.log('[JARVIS] Location locked:', jarvisLocation);
    },
    (err) => console.warn('[JARVIS] Location denied:', err.message),
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

// Call immediately on load
initLocation();


// ── 2. WHATSAPP DEEP-LINK HANDLER ───────────────────────────────────────────
// Parses [WHATSAPP:+1234567890:message text] from JARVIS reply
function handleWhatsApp(reply) {
  const match = reply.match(/\[WHATSAPP:([^:]+):([^\]]+)\]/);
  if (!match) return reply;

  const number  = match[1].replace(/\s/g, '');
  const message = encodeURIComponent(match[2]);
  const url     = `https://wa.me/${number.replace('+', '')}?text=${message}`;

  // Small delay so JARVIS finishes speaking first
  setTimeout(() => window.open(url, '_blank'), 1800);

  // Strip the token from displayed text
  return reply.replace(match[0], '').trim();
}


// ── 3. TASKER APP-SWITCH HANDLER ────────────────────────────────────────────
// Requires: Tasker + HTTP Server plugin running on Redmi 14C (port 1820)
// Task: receive "app" param → launch app by name
//
// HOW TO SET UP TASKER:
//   • Install "HTTP Server" plugin (by loopj) → create server on port 1820
//   • Add Task: HTTP Server → On Request "/open"
//     Action: Launch App → %http_query_app   (URL param)
//   • Make sure phone & your browsing device are on the same Wi-Fi
//     OR use Tailscale/ngrok for remote access
//
// Set TASKER_IP to your Redmi's local IP (find in Settings → Wi-Fi → IP)
const TASKER_IP   = '192.168.1.100';  // ← CHANGE THIS to your Redmi's IP
const TASKER_PORT = 1820;

async function handleOpenApp(reply) {
  const match = reply.match(/\[OPEN_APP:([^\]]+)\]/);
  if (!match) return reply;

  const appName = match[1].trim();

  try {
    await fetch(`http://${TASKER_IP}:${TASKER_PORT}/open?app=${encodeURIComponent(appName)}`, {
      method: 'GET',
      mode:   'no-cors',   // Tasker doesn't set CORS headers
    });
    console.log('[JARVIS] Tasker: open app →', appName);
  } catch (e) {
    console.warn('[JARVIS] Tasker unreachable:', e.message);
    // JARVIS already said "Opening X, Sir" — no extra error needed in UI
  }

  return reply.replace(match[0], '').trim();
}


// ── 4. MAIN sendMessage() — drop-in replacement ─────────────────────────────
// Replace your existing sendMessage function with this one.
async function sendMessage(text) {
  if (!text || busy) return;
  busy = true;

  // Stop any ongoing speech
  window.speechSynthesis.cancel();

  const userText = text.trim();
  userInput.value = '';

  addMsg('user', userText);
  history.push({ role: 'user', content: userText });

  // Thinking indicator
  const thinking = addThinking();   // your existing addThinking() helper

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        location: jarvisLocation,   // ← GPS injected here
      }),
    });

    const data = await res.json();
    let reply = data.reply || 'No response, Sir.';

    // ── Process special tokens ─────────────────────────────────────────────
    reply = handleWhatsApp(reply);
    reply = await handleOpenApp(reply);

    thinking?.remove();

    history.push({ role: 'assistant', content: reply });
    addMsg('assistant', reply);
    speak(reply);       // your existing speak() TTS helper

  } catch (e) {
    thinking?.remove();
    const errMsg = 'Connection error, Sir. Check your network.';
    addMsg('assistant', errMsg);
    speak(errMsg);
    console.error('[JARVIS] sendMessage error:', e);
  } finally {
    busy = false;
  }
}


// ── 5. LIVE MODE ─────────────────────────────────────────────────────────────
// Your existing liveSendMessage() just calls sendMessage(text) already,
// so it automatically gets location + WhatsApp + Tasker support. ✅
// No changes needed there.