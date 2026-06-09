// api/chat.js — JARVIS with memory, weather, time, web search

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MEMORY_KEY = "jarvis:memory:boss";

// ── KV helpers ─────────────────────────────────────────────
async function memoryGet() {
  try {
    const r = await fetch(`${KV_URL}/get/${MEMORY_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    return d.result ? JSON.parse(d.result) : [];
  } catch { return []; }
}

async function memorySet(facts) {
  try {
    await fetch(`${KV_URL}/set/${MEMORY_KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(facts) })
    });
  } catch {}
}

async function memoryAdd(fact) {
  const facts = await memoryGet();
  // avoid duplicates
  if (!facts.includes(fact)) {
    facts.push(fact);
    if (facts.length > 50) facts.shift(); // keep last 50
    await memorySet(facts);
  }
}

// ── Main handler ───────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, location } = req.body;

  // Current Nigeria time
  const now = new Date();
  const localTime = now.toLocaleString("en-US", {
    timeZone: "Africa/Lagos", hour12: true,
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

  // Load memory
  const memoryFacts = await memoryGet();
  const memoryBlock = memoryFacts.length > 0
    ? `\nThings you remember about Boss Muhammed Aali:\n${memoryFacts.map(f => `- ${f}`).join("\n")}`
    : "\nNo memories stored yet.";

  // Location block
  let locationBlock = "";
  if (location?.lat && location?.lon) {
    locationBlock = `\nCurrent location: ${location.city || "unknown"}, ${location.country || "unknown"} (${location.lat}, ${location.lon})`;
  }

  const systemPrompt = `You are JARVIS, the personal AI assistant of Boss Muhammed Aali.
Current date and time (Nigeria WAT): ${localTime}
${memoryBlock}
${locationBlock}

Rules:
- Address him as "Boss Muhammed Aali" on first greeting, then "Sir".
- Never third person. Max 3 sentences unless list/factual.
- For ANY weather query, use get_weather tool immediately.
- For news, scores, stocks, current events, use web_search tool.
- For time/date questions, answer directly from the time above.
- MEMORY: When Boss Muhammed Aali tells you something personal to remember (preferences, habits, people, schedule), use the save_memory tool to store it. Examples: "remember I wake at 6am", "my wife's name is Aisha", "I prefer Celsius".
- When recalling memories, refer to them naturally without saying "according to my memory".
- Never say you cannot remember — check the memory block above first.`;

  const tools = [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for real-time info: news, sports, stocks, current events.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get real-time weather. Always use for weather questions.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
            lat:  { type: "number" },
            lon:  { type: "number" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "save_memory",
        description: "Save a fact about Boss Muhammed Aali to long-term memory.",
        parameters: {
          type: "object",
          properties: {
            fact: { type: "string", description: "The fact to remember, e.g. 'Wakes up at 6am', 'Wife is named Aisha'" }
          },
          required: ["fact"]
        }
      }
    }
  ];

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 512,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        tool_choice: "auto"
      })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) return res.status(500).json({ error: data.error?.message || "Groq error" });

    const choice = data.choices?.[0];

    if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      let toolResult = "";

      if (toolName === "save_memory") {
        await memoryAdd(toolArgs.fact);
        toolResult = `Memory saved: "${toolArgs.fact}"`;
      } else if (toolName === "get_weather") {
        toolResult = await getWeather(toolArgs, location);
      } else if (toolName === "web_search") {
        toolResult = await performWebSearch(toolArgs.query);
      }

      const followUp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 512,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
            choice.message,
            { role: "tool", tool_call_id: toolCall.id, content: toolResult }
          ]
        })
      });

      const followData = await followUp.json();
      return res.status(200).json({ reply: followData.choices?.[0]?.message?.content || "I couldn't retrieve that, Sir." });
    }

    return res.status(200).json({ reply: choice?.message?.content || "I didn't catch that, Sir." });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── WEATHER ────────────────────────────────────────────────
async function getWeather(args, locationFallback) {
  try {
    let lat = args.lat, lon = args.lon, cityName = args.city || "";
    if (cityName && (!lat || !lon)) {
      const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`);
      const gd = await g.json();
      if (gd.results?.length > 0) {
        lat = gd.results[0].latitude; lon = gd.results[0].longitude;
        cityName = gd.results[0].name + ", " + (gd.results[0].country || "");
      }
    }
    if (!lat || !lon) {
      if (locationFallback?.lat) { lat = locationFallback.lat; lon = locationFallback.lon; cityName = locationFallback.city || "your location"; }
      else return "Location unavailable, Sir.";
    }
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min,weather_code&wind_speed_unit=kmh&temperature_unit=celsius&timezone=auto&forecast_days=3`);
    const wd = await w.json();
    const c = wd.current, d = wd.daily;
    const WMO = {0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Foggy",51:"Light drizzle",53:"Drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",80:"Rain showers",95:"Thunderstorm"};
    return `Weather for ${cityName}:\nCurrent: ${Math.round(c.temperature_2m)}°C, ${WMO[c.weather_code]||"Unknown"}\nFeels like: ${Math.round(c.apparent_temperature)}°C\nHumidity: ${c.relative_humidity_2m}%\nWind: ${Math.round(c.wind_speed_10m)} km/h\n\n3-Day Forecast:\n- Today: ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°C, ${WMO[d.weather_code[0]]||""}\n- Tomorrow: ${Math.round(d.temperature_2m_min[1])}–${Math.round(d.temperature_2m_max[1])}°C, ${WMO[d.weather_code[1]]||""}\n- Day after: ${Math.round(d.temperature_2m_min[2])}–${Math.round(d.temperature_2m_max[2])}°C, ${WMO[d.weather_code[2]]||""}`;
  } catch { return "Weather service temporarily unavailable, Sir."; }
}

// ── WEB SEARCH ─────────────────────────────────────────────
async function performWebSearch(query) {
  try {
    if (process.env.SERPER_KEY) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": process.env.SERPER_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 })
      });
      const d = await r.json();
      const snippets = [
        ...(d.answerBox ? [`${d.answerBox.title||""}: ${d.answerBox.answer||d.answerBox.snippet||""}`] : []),
        ...(d.organic?.slice(0,4).map(x=>`${x.title}: ${x.snippet}`) || [])
      ].join("\n");
      return snippets || "No results found.";
    }
    return "Web search not configured.";
  } catch { return "Search temporarily unavailable."; }
            }
