// jarvis-features.js
// Add to index.html: <script src="jarvis-features.js"></script> before </body>
// Covers: WhatsApp integration + Tasker app switching

// ═══════════════════════════════════════════════════════
// WHATSAPP INTEGRATION
// ═══════════════════════════════════════════════════════
const JarvisWhatsApp = (() => {

  // ── Edit your contacts here ──────────────────────────
  const CONTACTS = {
    "mom":       "+923001234567",
    "mother":    "+923001234567",
    "dad":       "+923009876543",
    "father":    "+923009876543",
    "ali":       "+923331112222",
    "ahmed":     "+923334445566",
    "bhai":      "+923335556677",
    // Add more: "name": "+countrycodenumber"
  };

  const PATTERNS = [
    /(?:send|message|whatsapp|text|msg)\s+(.+?)\s+(?:on\s+whatsapp\s+)?(?:saying?|that|with\s+message)[\s:]+(.+)/i,
    /(?:whatsapp|message|text)\s+(.+?)\s+[""'](.+)[""']/i,
    /tell\s+(.+?)\s+(?:via\s+whatsapp\s+)?(?:that\s+)?(.+)/i,
    /send\s+(.+?)\s+a\s+(?:whatsapp\s+)?message[\s:]+(.+)/i,
  ];

  function detect(userText) {
    const lower = userText.toLowerCase();
    if (!/whatsapp|send.*message|text.*message/.test(lower)) return false;

    for (const pattern of PATTERNS) {
      const m = userText.match(pattern);
      if (m) {
        const nameRaw = m[1].trim().toLowerCase();
        const message = m[2].trim();
        const phone   = resolveContact(nameRaw);
        if (phone) {
          openWhatsApp(phone, message);
          return { name: nameRaw, phone, message };
        } else {
          jarvisSpeak(`I don't have ${m[1].trim()}'s number saved, Sir.`);
          return false;
        }
      }
    }
    return false;
  }

  function resolveContact(name) {
    if (CONTACTS[name]) return CONTACTS[name];
    const key = Object.keys(CONTACTS).find(
      k => name.includes(k) || k.includes(name)
    );
    return key ? CONTACTS[key] : null;
  }

  function openWhatsApp(phone, message) {
    const clean = phone.replace(/\D/g, "");
    const url   = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  }

  function addContact(name, phone) {
    CONTACTS[name.toLowerCase()] = phone;
    console.log("[JARVIS] Contact added:", name, phone);
  }

  return { detect, addContact };
})();


// ═══════════════════════════════════════════════════════
// TASKER APP SWITCHING
// ═══════════════════════════════════════════════════════
// SETUP on Redmi 14C:
//   1. Install Tasker from Play Store
//   2. Install AutoRemote plugin (free tier works)
//   3. Open AutoRemote app → copy your Personal URL key
//   4. Paste the key into CONFIG.autoremoteKey below
//   5. In Tasker: Profile → Event → Plugin → AutoRemote
//      Filter: jarvis=:=*
//      Task: Perform Task → %arcomm  (AutoRemote sets this variable)
//   6. Create tasks named exactly as in APP_TASKS below
//      e.g. task "OpenYouTube" → App → Launch App → YouTube

const JarvisTasker = (() => {

  const CONFIG = {
    mode:           "autoremote",    // "autoremote" | "local"
    autoremoteKey:  "",              // ← paste your AutoRemote key here
    localIP:        "192.168.1.100", // ← your phone IP (only for local mode)
    localPort:      1880,
  };

  // ── App name → Tasker task name ─────────────────────
  const APP_TASKS = {
    "youtube":        "OpenYouTube",
    "spotify":        "OpenSpotify",
    "maps":           "OpenMaps",
    "google maps":    "OpenMaps",
    "chrome":         "OpenChrome",
    "camera":         "OpenCamera",
    "gallery":        "OpenGallery",
    "settings":       "OpenSettings",
    "calculator":     "OpenCalculator",
    "whatsapp":       "OpenWhatsApp",
    "instagram":      "OpenInstagram",
    "twitter":        "OpenTwitter",
    "x":              "OpenTwitter",
    "tiktok":         "OpenTikTok",
    "facebook":       "OpenFacebook",
    "telegram":       "OpenTelegram",
    "snapchat":       "OpenSnapchat",
    "netflix":        "OpenNetflix",
    "files":          "OpenFiles",
    "phone":          "OpenPhone",
    "contacts":       "OpenContacts",
    "clock":          "OpenClock",
    "alarm":          "SetAlarm",
    "flashlight":     "ToggleFlashlight",
    "torch":          "ToggleFlashlight",
    "wifi":           "ToggleWifi",
    "bluetooth":      "ToggleBluetooth",
    "screenshot":     "TakeScreenshot",
    "silent":         "SilentMode",
    "silent mode":    "SilentMode",
    "volume up":      "VolumeUp",
    "volume down":    "VolumeDown",
    "brightness up":  "BrightnessUp",
    "brightness down":"BrightnessDown",
    "hotspot":        "ToggleHotspot",
    "airplane mode":  "ToggleAirplane",
    "do not disturb": "ToggleDND",
    "lock":           "LockScreen",
    "lock screen":    "LockScreen",
  };

  const TRIGGER = /(?:open|launch|switch\s+to|go\s+to|start|turn\s+on|toggle|enable|disable)\s+(.+?)(?:\s+app|\s+please|\s+for\s+me|\s+now)?$/i;

  function detect(text) {
    const lower = text.toLowerCase().trim();

    // Direct match first
    const taskDirect = resolveTask(lower);
    if (taskDirect) {
      sendTaskerCommand(taskDirect, lower);
      return lower;
    }

    // Pattern match
    const m = lower.match(TRIGGER);
    if (m) {
      const appName  = m[1].trim();
      const taskName = resolveTask(appName);
      if (taskName) {
        sendTaskerCommand(taskName, appName);
        return appName;
      }
    }
    return null;
  }

  function resolveTask(appName) {
    if (APP_TASKS[appName]) return APP_TASKS[appName];
    const key = Object.keys(APP_TASKS).find(
      k => appName.includes(k) || k.includes(appName)
    );
    return key ? APP_TASKS[key] : null;
  }

  async function sendTaskerCommand(taskName, appName) {
    try {
      if (CONFIG.mode === "autoremote" && CONFIG.autoremoteKey) {
        const msg = encodeURIComponent(`jarvis=:=${taskName}`);
        const url = `https://autoremotejoaomgcd.appspot.com/sendmessage?key=${CONFIG.autoremoteKey}&message=${msg}`;
        const r   = await fetch(url);
        console.log("[JARVIS Tasker] AutoRemote:", taskName, await r.text());
      } else if (CONFIG.mode === "local") {
        const url = `http://${CONFIG.localIP}:${CONFIG.localPort}/task?name=${encodeURIComponent(taskName)}`;
        const r   = await fetch(url, { signal: AbortSignal.timeout(4000) });
        console.log("[JARVIS Tasker] Local:", taskName, r.status);
      } else {
        console.warn("[JARVIS Tasker] Not configured. Set autoremoteKey or localIP.");
        jarvisSpeak("Tasker is not configured yet, Sir. Please add your AutoRemote key.");
      }
    } catch (err) {
      console.warn("[JARVIS Tasker] Unreachable:", err.message);
      jarvisSpeak(`I couldn't reach your phone to open ${appName}, Sir. Check Tasker connection.`);
    }
  }

  function addApp(name, taskName) {
    APP_TASKS[name.toLowerCase()] = taskName;
  }

  return { detect, addApp };
})();


// ═══════════════════════════════════════════════════════
// TTS HELPER — bridges to your existing speak() function
// ═══════════════════════════════════════════════════════
function jarvisSpeak(text) {
  if (typeof speak === "function") {
    speak(text);
  } else {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    speechSynthesis.speak(u);
  }
}


// ═══════════════════════════════════════════════════════
// HOW TO WIRE INTO YOUR index.html sendToJarvis()
// ═══════════════════════════════════════════════════════
//
// Find your sendFromInput() function in index.html and
// replace it with this upgraded version:
//
// function sendFromInput() {
//   const text = userInput.value.trim();
//   if (!text) return;
//   userInput.value = '';
//
//   // 1. App switching — instant, no API call needed
//   const openedApp = JarvisTasker.detect(text);
//   if (openedApp) {
//     jarvisSpeak(`Opening ${openedApp}, Sir.`);
//     return;
//   }
//
//   // 2. WhatsApp — instant, no API call needed
//   const waResult = JarvisWhatsApp.detect(text);
//   if (waResult) {
//     jarvisSpeak(`Opening WhatsApp for ${waResult.name}, Sir.`);
//     return;
//   }
//
//   // 3. Normal JARVIS API call
//   sendToJarvis(text);
// }