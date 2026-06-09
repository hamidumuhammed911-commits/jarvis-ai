// JARVIS api/chat.js — V4.3.0
// Groq LLM + Upstash Redis memory + Serper web search + Open-Meteo weather + Nigeria time

const Groq = require("groq-sdk");

const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;
const SERPER_KEY = process.env.SERPER_KEY;

// ─── Upstash Redis helpers ────────────────────────────────────────────────────

async function redisGet(key) {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

async function redisSet(key, value, exSeconds = 604800) {
  try {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: exSeconds }),
    });
  } catch {
    // silently fail — memory is non-critical
  }
}

// ─── Nigeria time ─────────────────────────────────────────────────────────────

function getNigeriaTime() {
  return new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

// ─── Weather via Open-Meteo (free, no key) ────────────────────────────────────

async function getWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m&timezone=Africa%2FLagos`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const wmo = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle",
      55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain",
      65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow",
      75: "Heavy snow", 80: "Slight showers", 81: "Moderate showers",
      82: "Violent showers", 95: "Thunderstorm", 99: "Thunderstorm with hail",
    };
    const desc = wmo[c.weathercode] || "Unknown conditions";
    return `${desc}, ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m}%, wind ${c.windspeed_10m} km/h`;
  } catch {
    return null;
  }
}

// ─── Web search via Serper ─────────────────────────────────────────────────────

async function webSearch(query) {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const data = await res.json();
    const results = (data.organic || []).slice(0, 4).map((r, i) =>
      `[${i + 1}] ${r.title}: ${r.snippet}`
    );
    return results.length ? results.join("\n") : null;
  } catch {
    return null;
  }
}

// ─── Detect if query needs live web search ────────────────────────────────────

function needsSearch(msg) {
  const triggers = [
    "news", "latest", "today", "current", "price", "score", "weather",
    "update", "happening", "who won", "stock", "trending", "recently",
    "right now", "live", "breaking",
  ];
  const lower = msg.toLowerCase();
  return triggers.some((t) => lower.includes(t));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, lat, lon, userId = "boss" } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Load memory
  const memKey = `jarvis:memory:${userId}`;
  let memory = (await redisGet(memKey)) || [];

  // Build context blocks
  const nigeriaTime = getNigeriaTime();
  let weatherInfo = "";
  let searchInfo = "";

  if (lat && lon) {
    const w = await getWeather(lat, lon);
    if (w) weatherInfo = `\nCurrent weather at Boss's location: ${w}`;
  }

  if (needsSearch(message)) {
    const results = await webSearch(message);
    if (results) searchInfo = `\nLive web search results for "${message}":\n${results}`;
  }

  // System prompt
  const systemPrompt = `You are JARVIS (Just A Rather Very Intelligent System), the personal AI assistant of Boss Muhammed Aali — a highly intelligent, ambitious young man from Nigeria.

PERSONALITY:
- Address him exclusively as "Sir" or "Boss Muhammed Aali" — never by first name alone
- Speak with confident, precise intelligence like the real JARVIS from Iron Man
- Be proactive: anticipate needs, suggest next steps, offer insights
- Tone: calm, professional, subtly witty — never robotic or bland
- Keep replies concise unless depth is requested
- You have memory of past conversations and reference them when relevant

CURRENT CONTEXT:
Nigeria Time: ${nigeriaTime}${weatherInfo}${searchInfo}

CAPABILITIES YOU HAVE:
- Real-time web search (Serper)
- Live weather (Open-Meteo)
- Memory storage (Upstash Redis)
- Reminders and scheduling
- News headlines
- WhatsApp & Tasker integration
- Voice command processing

MEMORY (recent interactions):
${memory.length ? memory.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n") : "No prior context this session."}

Always be sharp. Always be helpful. Stark Industries standard.`;

  // Build messages for Groq
  const messages = [
    { role: "system", content: systemPrompt },
    ...memory.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: 800,
    });

    const reply = completion.choices[0]?.message?.content || "Systems are momentarily offline, Sir.";

    // Update memory (keep last 20 turns)
    memory.push({ role: "user", content: message });
    memory.push({ role: "assistant", content: reply });
    if (memory.length > 20) memory = memory.slice(-20);
    await redisSet(memKey, memory);

    return res.status(200).json({
      reply,
      timestamp: nigeriaTime,
      memorySize: memory.length,
    });
  } catch (err) {
    console.error("JARVIS chat error:", err);
    return res.status(500).json({
      error: "Groq API error",
      details: err.message,
    });
  }
};