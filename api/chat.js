// api/chat.js — JARVIS backend with Groq + web search + direct weather + time

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, location } = req.body;

  // Current time in Nigeria (WAT = UTC+1)
  const now = new Date();
  const localTime = now.toLocaleString("en-US", {
    timeZone: "Africa/Lagos",
    hour12: true,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  // Build location block
  let locationBlock = "";
  if (location && location.lat && location.lon) {
    locationBlock = `
Current location of Boss Muhammed Aali:
  Coordinates : ${location.lat}, ${location.lon}
  City        : ${location.city || "unknown"}
  Country     : ${location.country || "unknown"}
Use this for weather, directions, or local queries. Never repeat coordinates verbatim unless asked.`;
  }

  const systemPrompt = `You are JARVIS, the personal AI assistant of Boss Muhammed Aali.
Current date and time (Nigeria WAT): ${localTime}
Always use this when asked about the time or date — never say you don't know the time.

Rules:
- Address him as "Boss Muhammed Aali" on the very first greeting, then use "Sir" for all subsequent turns.
- Never refer to him in the third person.
- Be concise — maximum 3 sentences unless a list or factual answer genuinely requires more.
- You have access to a web_search tool and a get_weather tool.
- For ANY weather query, ALWAYS use the get_weather tool — never guess or say you cannot access weather.
- Use web_search for news, scores, stock prices, current events, or anything else time-sensitive.
- Do NOT explain that you are searching — just search, then answer naturally.
- For weather queries without an explicit location, use Boss Muhammed Aali's current location below.
- If location is unavailable, ask "Shall I use your current location, Sir?"
${locationBlock}`;

  const tools = [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for real-time info: news, sports scores, stock prices, current events.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get real-time weather for any city or coordinates. Always use this for weather questions.",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name e.g. Minna, Lagos, London" },
            lat:  { type: "number", description: "Latitude (use if city unknown)" },
            lon:  { type: "number", description: "Longitude (use if city unknown)" },
          },
        },
      },
    },
  ];

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 512,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        tool_choice: "auto",
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Groq error:", data);
      return res.status(500).json({ error: data.error?.message || "Groq API error" });
    }

    const choice = data.choices?.[0];

    // Handle tool calls
    if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length > 0) {
      const toolCall = choice.message.tool_calls[0];
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      let toolResult = "";

      if (toolName === "get_weather") {
        toolResult = await getWeather(toolArgs, location);
      } else if (toolName === "web_search") {
        toolResult = await performWebSearch(toolArgs.query);
      }

      const followUp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 512,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
            choice.message,
            {
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResult,
            },
          ],
        }),
      });

      const followData = await followUp.json();
      const finalText = followData.choices?.[0]?.message?.content || "I couldn't retrieve that, Sir.";
      return res.status(200).json({ reply: finalText });
    }

    // Normal response
    const reply = choice?.message?.content || "I didn't catch that, Sir.";
    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// WEATHER via Open-Meteo (free, no key)
async function getWeather(args, locationFallback) {
  try {
    let lat = args.lat;
    let lon = args.lon;
    let cityName = args.city || "";

    if (cityName && (!lat || !lon)) {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`
      );
      const geoData = await geoRes.json();
      if (geoData.results?.length > 0) {
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
        cityName = geoData.results[0].name + ", " + (geoData.results[0].country || "");
      }
    }

    if (!lat || !lon) {
      if (locationFallback?.lat && locationFallback?.lon) {
        lat = locationFallback.lat;
        lon = locationFallback.lon;
        cityName = locationFallback.city || "your location";
      } else {
        return "Location unavailable. Please enable GPS, Sir.";
      }
    }

    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
      `&wind_speed_unit=kmh&temperature_unit=celsius&timezone=auto&forecast_days=3`
    );
    const w = await wRes.json();
    const c = w.current;
    const d = w.daily;

    const WMO = {
      0:"Clear sky", 1:"Mainly clear", 2:"Partly cloudy", 3:"Overcast",
      45:"Foggy", 48:"Icy fog", 51:"Light drizzle", 53:"Drizzle", 55:"Heavy drizzle",
      61:"Light rain", 63:"Rain", 65:"Heavy rain", 71:"Light snow", 73:"Snow", 75:"Heavy snow",
      80:"Rain showers", 81:"Rain showers", 95:"Thunderstorm", 99:"Thunderstorm with hail"
    };

    const condition = WMO[c.weather_code] || "Unknown";

    return `Weather for ${cityName}:
Current: ${Math.round(c.temperature_2m)}°C, ${condition}
Feels like: ${Math.round(c.apparent_temperature)}°C
Humidity: ${c.relative_humidity_2m}%
Wind: ${Math.round(c.wind_speed_10m)} km/h
Precipitation: ${c.precipitation} mm

3-Day Forecast:
- Today: ${Math.round(d.temperature_2m_min[0])}°C - ${Math.round(d.temperature_2m_max[0])}°C, ${WMO[d.weather_code[0]] || ""}
- Tomorrow: ${Math.round(d.temperature_2m_min[1])}°C - ${Math.round(d.temperature_2m_max[1])}°C, ${WMO[d.weather_code[1]] || ""}
- Day after: ${Math.round(d.temperature_2m_min[2])}°C - ${Math.round(d.temperature_2m_max[2])}°C, ${WMO[d.weather_code[2]] || ""}`;

  } catch (e) {
    console.error("Weather error:", e);
    return "Weather service temporarily unavailable, Sir.";
  }
}

// WEB SEARCH via Serper
async function performWebSearch(query) {
  try {
    if (process.env.SERPER_KEY) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      const d = await r.json();
      const snippets = [
        ...(d.answerBox
          ? [`${d.answerBox.title || ""}: ${d.answerBox.answer || d.answerBox.snippet || ""}`]
          : []),
        ...(d.organic?.slice(0, 4).map((x) => `${x.title}: ${x.snippet}`) || []),
      ].join("\n");
      return snippets || "No results found.";
    }
    return "Web search not configured.";
  } catch (e) {
    console.error("Search error:", e);
    return "Search temporarily unavailable.";
  }
}
