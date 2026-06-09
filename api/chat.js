// ============================================================
// JARVIS — api/chat.js  V4.3.0
// Fixes: proper memory R/W, system prompt, "Systems nominal" bug
// ============================================================

export const config = { runtime: 'edge' };

// ── Upstash Redis helpers ────────────────────────────────────
async function redisGet(key) {
  try {
    const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    const data = await res.json();
    return data.result ?? null;
  } catch (e) {
    console.error('[Redis GET]', e.message);
    return null;
  }
}

async function redisSet(key, value, exSeconds = 0) {
  try {
    const body = exSeconds > 0
      ? [key, value, 'EX', exSeconds]
      : [key, value];
    const res = await fetch(`${process.env.KV_REST_API_URL}/set`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('[Redis SET]', e.message);
    return null;
  }
}

// ── Memory: load all facts for this user ────────────────────
async function loadMemory(userId = 'boss') {
  const raw = await redisGet(`jarvis:memory:${userId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ── Memory: save facts array ─────────────────────────────────
async function saveMemory(facts, userId = 'boss') {
  // Keep max 50 facts, no expiry (persistent)
  const trimmed = facts.slice(-50);
  await redisSet(`jarvis:memory:${userId}`, JSON.stringify(trimmed));
}

// ── Memory: extract new facts from message ──────────────────
function extractFacts(message) {
  const facts = [];
  const lower = message.toLowerCase();

  // "remember that X" / "remember X"
  const rememberMatch = message.match(/remember (?:that )?(.+)/i);
  if (rememberMatch) facts.push(rememberMatch[1].trim());

  // "my name is X"
  const nameMatch = message.match(/my name is ([^\.,]+)/i);
  if (nameMatch) facts.push(`User's name is ${nameMatch[1].trim()}`);

  // "I wake up at X" / "I sleep at X" / "I work at X"
  const routineMatch = message.match(/I (?:wake up|sleep|go to bed|work|start|finish|eat|pray|exercise) (?:at|around|by) ([^\.,]+)/i);
  if (routineMatch) facts.push(message.trim());

  // "I am X years old" / "I'm X"
  const ageMatch = message.match(/I(?:'m| am) (\d+) years old/i);
  if (ageMatch) facts.push(`User is ${ageMatch[1]} years old`);

  // "I live in X" / "I'm from X"
  const locationMatch = message.match(/I (?:live in|am from|'m from) ([^\.,]+)/i);
  if (locationMatch) facts.push(`User lives in ${locationMatch[1].trim()}`);

  return facts;
}

// ── Nigeria time ─────────────────────────────────────────────
function getNigeriaTime() {
  return new Date().toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: true
  });
}

// ── Web search via Serper ────────────────────────────────────
async function webSearch(query) {
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num: 3 })
    });
    const data = await res.json();
    const snippets = (data.organic || [])
      .slice(0, 3)
      .map(r => `• ${r.title}: ${r.snippet}`)
      .join('\n');
    return snippets || 'No results found.';
  } catch (e) {
    return `Search failed: ${e.message}`;
  }
}

// ── Weather via Open-Meteo ───────────────────────────────────
async function getWeather(lat, lon) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m&timezone=auto`
    );
    const data = await res.json();
    const w = data.current_weather;
    return `${w.temperature}°C, wind ${w.windspeed} km/h, weathercode ${w.weathercode}`;
  } catch (e) {
    return 'Weather unavailable';
  }
}

// ── Build system prompt ──────────────────────────────────────
function buildSystemPrompt(memoryFacts, weatherInfo, nigeriaTime) {
  const memoryBlock = memoryFacts.length > 0
    ? `\n\nTHINGS YOU REMEMBER ABOUT YOUR BOSS:\n${memoryFacts.map(f => `- ${f}`).join('\n')}`
    : '';

  return `You are JARVIS (Just A Rather Very Intelligent System), the AI assistant of Boss Muhammed Aali. You were built by Boss Muhammed Aali himself.

PERSONALITY & RULES:
- Always address the user as "Sir" or "Boss Muhammed Aali"
- Tone: highly intelligent, calm, precise, slightly formal — like the JARVIS from Iron Man
- Be genuinely helpful and informative. NEVER reply with generic filler like "Systems nominal, Sir" unless the user literally asks for system status
- Give real, substantive answers to every question
- For memory requests ("remember that X"), confirm what you stored: "Noted, Sir. I've stored that [fact]."
- For memory recall requests, cite the stored fact clearly
- Keep responses concise but complete

CURRENT CONTEXT:
- Current Nigeria time: ${nigeriaTime}
- Current weather: ${weatherInfo || 'Not available'}
${memoryBlock}

CAPABILITIES:
- Real-time web search
- Weather & location awareness
- Memory of facts about the Boss
- Reminders and scheduling
- General knowledge and reasoning`;
}

// ── Main handler ─────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const {
    message = '',
    messages: history = [],
    lat,
    lon,
    userId = 'boss'
  } = body;

  if (!message.trim()) {
    return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400 });
  }

  // ── 1. Load memory ──────────────────────────────────────────
  let memoryFacts = await loadMemory(userId);

  // ── 2. Extract & save new facts from this message ───────────
  const newFacts = extractFacts(message);
  if (newFacts.length > 0) {
    // Avoid duplicates
    for (const fact of newFacts) {
      if (!memoryFacts.includes(fact)) {
        memoryFacts.push(fact);
      }
    }
    await saveMemory(memoryFacts, userId);
  }

  // ── 3. Gather context ────────────────────────────────────────
  const nigeriaTime = getNigeriaTime();
  let weatherInfo = '';
  if (lat && lon) {
    weatherInfo = await getWeather(lat, lon);
  }

  // ── 4. Check if web search needed ───────────────────────────
  let searchContext = '';
  const searchTriggers = /latest|news|current|today|price|weather|who is|what is happening|score|match|update/i;
  if (searchTriggers.test(message) && !/remember|recall|what do you know/i.test(message)) {
    searchContext = await webSearch(message);
  }

  // ── 5. Build messages for Groq ───────────────────────────────
  const systemPrompt = buildSystemPrompt(memoryFacts, weatherInfo, nigeriaTime);

  // Build conversation: last 10 turns from history for context
  const recentHistory = (history || []).slice(-10);

  const userContent = searchContext
    ? `${message}\n\n[Web search results for context:\n${searchContext}]`
    : message;

  const groqMessages = [
    ...recentHistory,
    { role: 'user', content: userContent }
  ];

  // ── 6. Call Groq ─────────────────────────────────────────────
  let groqResponse;
  try {
    groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...groqMessages
        ],
        max_tokens: 1024,
        temperature: 0.7
      })
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Groq connection failed: ${e.message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!groqResponse.ok) {
    const errText = await groqResponse.text();
    return new Response(
      JSON.stringify({ error: `Groq API error ${groqResponse.status}: ${errText}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const groqData = await groqResponse.json();
  const reply = groqData.choices?.[0]?.message?.content ?? 'I encountered an issue generating a response, Sir.';

  // ── 7. Return response with memory state ─────────────────────
  return new Response(
    JSON.stringify({
      reply,
      memorySaved: newFacts.length > 0,
      newFacts,
      memoryCount: memoryFacts.length,
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    }
  );
}