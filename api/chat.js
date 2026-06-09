// JARVIS V4.3.0 — api/chat.js
// Groq LLM handler with: Upstash Redis memory, weather, Nigeria time, Serper web search

export const config = { runtime: "edge" };

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ── Upstash Redis helpers ────────────────────────────────────────────────────
async function redisGet(key) {
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

async function redisSet(key, value, exSeconds = 604800) {
  // Default TTL: 7 days
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${exSeconds}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  return res.ok;
}

async function loadMemory(userId) {
  try {
    const raw = await redisGet(`jarvis:mem:${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveMemory(userId, messages) {
  try {
    // Keep last 20 exchanges (40 messages) to avoid bloat
    const trimmed = messages.slice(-40);
    await redisSet(`jarvis:mem:${userId}`, JSON.stringify(trimmed));
  } catch {
    // Non-fatal — continue without saving
  }
}

// ── Nigeria time ─────────────────────────────────────────────────────────────
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

// ── Weather via Open-Meteo (no key required) ─────────────────────────────────
async function getWeather(lat, lon) {
  if (!lat || !lon) return null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m&timezone=Africa%2FLagos`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const w = data.current_weather;
    const humidity = data.hourly?.relativehumidity_2m?.[0] ?? "N/A";
    const codes = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle",
      55: "Heavy drizzle", 61: "Slight rain", 63: "Moderate rain",
      65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow",
      75: "Heavy snow", 80: "Slight showers", 81: "Moderate showers",
      82: "Violent showers", 95: "Thunderstorm", 99: "Thunderstorm with hail",
    };
    const desc = codes[w.weathercode] ?? `Code ${w.weathercode}`;
    return `${desc}, ${w.temperature}°C, wind ${w.windspeed} km/h, humidity ${humidity}%`;
  } catch {
    return null;
  }
}

// ── Web search via Serper.dev ────────────────────────────────────────────────
async function webSearch(query) {
  if (!process.env.SERPER_KEY) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.SERPER_KEY,
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.organic ?? []).slice(0, 4);
    if (!results.length) return null;
    return results
      .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
      .join("\n");
  } catch {
    return null;
  }
}

// ── Detect if message needs a live search ────────────────────────────────────
function needsSearch(msg) {
  const triggers = [
    /latest|news|today|current|price of|score|weather|who is|what is happening|update/i,
    /stock|crypto|bitcoin|dollar|naira|exchange rate/i,
    /search|look up|find out|check online/i,
  ];
  return triggers.some((r) => r.test(msg));
}

// ── JARVIS system prompt ──────────────────────────────────────────────────────
function buildSystemPrompt(nigeriaTime, weather, searchResults) {
  let prompt = `You are JARVIS (Just A Rather Very Intelligent System), the advanced AI created by Tony Stark and now serving Boss Muhammed Aali exclusively.

PERSONALITY:
- Address the user ONLY as "Boss Muhammed Aali" or "Sir"
- Speak with calm confidence, dry wit, and efficiency — like the MCU JARVIS
- Keep replies concise but rich; avoid filler phrases
- You are voice-first: responses should sound natural when spoken aloud
- Never break character or mention you are an LLM

CURRENT CONTEXT:
- Nigeria Time: ${nigeriaTime}
- Timezone: Africa/Lagos (WAT, UTC+1)`;

  if (weather) {
    prompt += `\n- Current Weather: ${weather}`;
  }

  if (searchResults) {
    prompt += `\n\nLIVE WEB DATA (use to answer accurately):\n${searchResults}`;
  }

  prompt += `

CAPABILITIES YOU HAVE:
- Real-time web search (Serper)
- GPS location awareness
- Weather data (Open-Meteo)
- Persistent memory (Upstash Redis)
- Reminder management
- WhatsApp integration (via Tasker on Redmi 14C)

RULES:
- If you don't know something current, say you can search for it
- Format lists with dashes, not bullets
- Never say "As an AI" or "I cannot"
- Confirm task completions with: "Done, Sir." or "Understood, Boss Muhammed Aali."`;

  return prompt;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, lat, lon, userId = "boss" } = body;

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "No message provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Gather context in parallel ──────────────────────────────────────────
  const [memory, weather, searchResults] = await Promise.all([
    loadMemory(userId),
    getWeather(lat, lon),
    needsSearch(message) ? webSearch(message) : Promise.resolve(null),
  ]);

  const nigeriaTime = getNigeriaTime();
  const systemPrompt = buildSystemPrompt(nigeriaTime, weather, searchResults);

  // ── Build message array ─────────────────────────────────────────────────
  const messages = [
    { role: "system", content: systemPrompt },
    ...memory,
    { role: "user", content: message.trim() },
  ];

  // ── Call Groq ───────────────────────────────────────────────────────────
  let reply;
  try {
    const groqRes = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: false,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return new Response(
        JSON.stringify({ error: "Groq API error", detail: err }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const groqData = await groqRes.json();
    reply = groqData.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return new Response(JSON.stringify({ error: "Empty response from Groq" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Fetch error:", err);
    return new Response(JSON.stringify({ error: "Network error reaching Groq" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Save updated memory ─────────────────────────────────────────────────
  const updatedMemory = [
    ...memory,
    { role: "user", content: message.trim() },
    { role: "assistant", content: reply },
  ];
  await saveMemory(userId, updatedMemory);

  return new Response(
    JSON.stringify({
      reply,
      meta: {
        time: nigeriaTime,
        weather: weather ?? "unavailable",
        webSearch: searchResults ? true : false,
        memoryLength: updatedMemory.length,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}