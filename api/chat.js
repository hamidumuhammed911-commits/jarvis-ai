// JARVIS api/chat.js — V4.3.1
// Fixes: "Systems nominal" ghost cache + Upstash Redis memory (save & recall)

export const config = { runtime: "edge" };

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const UPSTASH_URL = process.env.KV_REST_API_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN;
const MEMORY_KEY = "jarvis:memory:boss";
const MAX_MEMORY_ITEMS = 30;

// ── Upstash helpers ──────────────────────────────────────────────────────────

async function memoryGet() {
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${MEMORY_KEY}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const json = await res.json();
    if (!json.result) return [];
    return JSON.parse(json.result);
  } catch {
    return [];
  }
}

async function memorySet(items) {
  try {
    await fetch(`${UPSTASH_URL}/set/${MEMORY_KEY}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(JSON.stringify(items.slice(-MAX_MEMORY_ITEMS))),
    });
  } catch {
    // silent fail — never crash the response over memory
  }
}

// ── Memory extraction from user message ─────────────────────────────────────

function extractMemoryIntent(text) {
  const lower = text.toLowerCase();
  const savePatterns = [
    /remember (?:that )?(.+)/i,
    /note (?:that )?(.+)/i,
    /don['']?t forget (?:that )?(.+)/i,
    /store (?:that )?(.+)/i,
    /keep in mind (?:that )?(.+)/i,
  ];
  for (const pattern of savePatterns) {
    const m = text.match(pattern);
    if (m) return { action: "save", fact: m[1].trim() };
  }
  if (/what do you (remember|know) about me/i.test(lower) ||
      /recall|my memories|what have i told you/i.test(lower)) {
    return { action: "recall" };
  }
  if (/forget everything|clear (?:my )?memory|reset memory/i.test(lower)) {
    return { action: "clear" };
  }
  return null;
}

// ── Nigeria time helper ──────────────────────────────────────────────────────

function getNigeriaTime() {
  return new Date().toLocaleString("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  // Hard-block caching at every layer
  const corsHeaders = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Surrogate-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: corsHeaders,
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { messages = [], location, weather } = body;
  const userMessage = messages.findLast(m => m.role === "user")?.content || "";

  // ── Handle memory intents before hitting Groq ──────────────────────────────
  const memIntent = extractMemoryIntent(userMessage);
  let memories = await memoryGet();

  if (memIntent?.action === "save") {
    const fact = memIntent.fact;
    const timestamp = getNigeriaTime();
    memories.push({ fact, timestamp });
    await memorySet(memories);

    return new Response(
      JSON.stringify({
        reply: `Understood, Sir. I've committed that to memory: "${fact}". It will be available in all future sessions.`,
        memoryUpdated: true,
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (memIntent?.action === "clear") {
    await memorySet([]);
    return new Response(
      JSON.stringify({ reply: "Memory wiped clean, Sir. I start fresh from this point." }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (memIntent?.action === "recall") {
    if (!memories.length) {
      return new Response(
        JSON.stringify({ reply: "My memory banks are empty, Sir. You haven't stored anything with me yet." }),
        { status: 200, headers: corsHeaders }
      );
    }
    const list = memories.map((m, i) => `${i + 1}. ${m.fact} (saved: ${m.timestamp})`).join("\n");
    return new Response(
      JSON.stringify({ reply: `Here is everything I remember about you, Sir:\n\n${list}` }),
      { status: 200, headers: corsHeaders }
    );
  }

  // ── Build system prompt with injected memory ───────────────────────────────
  const memoryBlock = memories.length
    ? `\n\nPERSONAL MEMORY (facts Boss Muhammed Aali has asked you to remember):\n${memories.map(m => `- ${m.fact}`).join("\n")}`
    : "";

  const locationBlock = location
    ? `\nBoss location: ${location.city || "Unknown"}, ${location.country || ""} (lat: ${location.lat}, lon: ${location.lon})`
    : "";

  const weatherBlock = weather
    ? `\nCurrent weather: ${weather.temp}°C, ${weather.description}`
    : "";

  const systemPrompt = `You are JARVIS — an advanced AI assistant serving Boss Muhammed Aali. Always address him as "Sir" or "Boss". You are intelligent, precise, loyal, and slightly formal like the JARVIS from Iron Man. You speak in clear, direct sentences. Never say "Systems nominal" as a standalone reply — always give a real, helpful answer to the Boss's actual question or command.

Current Nigeria time: ${getNigeriaTime()}${locationBlock}${weatherBlock}${memoryBlock}

Rules:
- Always respond to the actual content of the message.
- If asked to remember something, confirm warmly that you've stored it.
- Refer to stored memories naturally when relevant.
- Keep responses concise unless detail is requested.
- Never break character.`;

  // ── Groq call ──────────────────────────────────────────────────────────────
  const groqMessages = [
    { role: "system", content: systemPrompt },
    ...messages.filter(m => m.role !== "system"),
  ];

  try {
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return new Response(
        JSON.stringify({ reply: "I'm having trouble reaching my reasoning core, Sir. Please try again." }),
        { status: 200, headers: corsHeaders }
      );
    }

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content?.trim() ||
      "I didn't receive a response from my reasoning core, Sir.";

    return new Response(JSON.stringify({ reply }), {
      status: 200, headers: corsHeaders,
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(
      JSON.stringify({ reply: "A system error occurred, Sir. Standing by for retry." }),
      { status: 200, headers: corsHeaders }
    );
  }
}
