// JARVIS V4.4.0 — api/chat.js
// Features: Groq LLM, Upstash Redis memory (last 10 msgs), weather, time, web search

import Groq from "groq-sdk";
import { Redis } from "@upstash/redis";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const MEMORY_KEY = (userId) => `jarvis:memory:${userId}`;
const FACTS_KEY  = (userId) => `jarvis:facts:${userId}`;
const MAX_HISTORY = 10; // messages kept per user

// ── Helpers ────────────────────────────────────────────────────────────────

async function getNigeriaTime() {
  const now = new Date();
  return now.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

async function getWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m&timezone=auto`;
    const res  = await fetch(url);
    const data = await res.json();
    const c    = data.current;
    const wmo  = {
      0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
      45:"Fog",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
      61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",
      75:"Heavy snow",80:"Rain showers",81:"Heavy showers",82:"Violent showers",
      95:"Thunderstorm",96:"Thunderstorm with hail",99:"Thunderstorm heavy hail",
    };
    return {
      temp: Math.round(c.temperature_2m),
      unit: data.current_units?.temperature_2m || "°C",
      condition: wmo[c.weathercode] || "Unknown",
      wind: Math.round(c.windspeed_10m),
      humidity: c.relativehumidity_2m,
      code: c.weathercode,
    };
  } catch { return null; }
}

async function webSearch(query) {
  try {
    const res  = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 4 }),
    });
    const data = await res.json();
    return (data.organic || [])
      .slice(0, 4)
      .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
      .join("\n");
  } catch { return ""; }
}

// ── Redis memory helpers ────────────────────────────────────────────────────

async function loadHistory(userId) {
  try {
    const raw = await redis.get(MEMORY_KEY(userId));
    if (!raw) return [];
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return []; }
}

async function saveHistory(userId, history) {
  try {
    // Keep only last MAX_HISTORY messages
    const trimmed = history.slice(-MAX_HISTORY);
    await redis.set(MEMORY_KEY(userId), JSON.stringify(trimmed), { ex: 60 * 60 * 24 * 7 }); // 7 days
  } catch { /* silent */ }
}

async function loadFacts(userId) {
  try {
    const raw = await redis.get(FACTS_KEY(userId));
    if (!raw) return {};
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return {}; }
}

async function saveFacts(userId, facts) {
  try {
    await redis.set(FACTS_KEY(userId), JSON.stringify(facts), { ex: 60 * 60 * 24 * 30 }); // 30 days
  } catch { /* silent */ }
}

// Extract memorable facts from conversation (name, prefs, tasks)
function extractFacts(text, existingFacts) {
  const facts = { ...existingFacts };
  const lower = text.toLowerCase();
  if (lower.includes("my name is") || lower.includes("i am called")) {
    const match = text.match(/(?:my name is|i am called)\s+([A-Z][a-z]+)/i);
    if (match) facts.userName = match[1];
  }
  if (lower.includes("i like") || lower.includes("i love")) {
    const match = text.match(/i (?:like|love)\s+(.+?)(?:\.|,|$)/i);
    if (match) facts.likes = (facts.likes || []).concat(match[1].trim()).slice(-5);
  }
  if (lower.includes("remind me") || lower.includes("don't forget")) {
    const match = text.match(/(?:remind me|don't forget)\s+(?:to\s+)?(.+?)(?:\.|,|$)/i);
    if (match) facts.lastReminder = match[1].trim();
  }
  return facts;
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, lat, lon, userId = "boss" } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  try {
    // 1. Gather context in parallel
    const [nigeriaTime, weather, history, facts] = await Promise.all([
      getNigeriaTime(),
      lat && lon ? getWeather(lat, lon) : Promise.resolve(null),
      loadHistory(userId),
      loadFacts(userId),
    ]);

    // 2. Decide if web search needed
    const needsSearch = /news|latest|today|current|price|score|weather|who is|what is|search/i.test(message);
    let searchResults = "";
    if (needsSearch) {
      searchResults = await webSearch(message);
    }

    // 3. Build system prompt
    const weatherBlock = weather
      ? `WEATHER: ${weather.temp}${weather.unit}, ${weather.condition}, Wind ${weather.wind}km/h, Humidity ${weather.humidity}%`
      : "WEATHER: Unavailable";

    const factsBlock = Object.keys(facts).length
      ? `KNOWN FACTS ABOUT BOSS:\n${JSON.stringify(facts, null, 2)}`
      : "";

    const searchBlock = searchResults
      ? `WEB SEARCH RESULTS:\n${searchResults}`
      : "";

    const systemPrompt = `You are JARVIS (Just A Rather Very Intelligent System), the AI assistant for Stark Industries.
Always address the user as "Boss Muhammed Aali" or "Sir". Be concise, intelligent, and professional with a subtle wit.
Respond in 1-3 sentences unless a detailed answer is truly required.

CURRENT NIGERIA TIME: ${nigeriaTime}
${weatherBlock}
${factsBlock}
${searchBlock}

IMPORTANT RULES:
- Never say you are an AI or mention Groq/LLM.
- If asked about yourself, say you are JARVIS, created by Stark Industries.
- For weather, use the data above — do NOT say you cannot access weather.
- For time, use the Nigeria time above — always accurate.
- Keep responses sharp and mission-focused.`;

    // 4. Build messages array with history
    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    // 5. Call Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 400,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "Systems nominal, Sir.";

    // 6. Update history & facts in Redis (non-blocking)
    const updatedHistory = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ];
    const updatedFacts = extractFacts(message, facts);

    await Promise.all([
      saveHistory(userId, updatedHistory),
      saveFacts(userId, updatedFacts),
    ]);

    // 7. Return response + weather data for HUD card
    return res.status(200).json({
      reply,
      weather: weather || null,
      memorySize: updatedHistory.length,
    });

  } catch (err) {
    console.error("JARVIS chat error:", err);
    return res.status(500).json({ error: "JARVIS core failure", details: err.message });
  }
}