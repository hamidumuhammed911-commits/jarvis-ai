// api/chat.js — JARVIS AI Chat Handler V4.3.2 (Streaming + Image Gen)
export const config = { runtime: "edge" }; // Edge runtime = faster cold starts

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  const {
    messages = [],
    location = null,
    weather = null,
    memory = "",
    stream = true, // default to streaming
  } = body;

  // Nigeria time
  const now = new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "full",
    timeStyle: "medium",
  });

  // System prompt
  const systemPrompt = `You are JARVIS — an advanced AI assistant built for Boss Muhammed Aali. Always address him as "Sir" or "Boss". You are intelligent, precise, and loyal, modeled after Tony Stark's JARVIS.

Current Nigeria Time (Africa/Lagos): ${now}
${location ? `Boss Location: ${location}` : ""}
${weather ? `Current Weather: ${weather}` : ""}
${memory ? `Memory about Boss: ${memory}` : ""}

Rules:
- Be concise but thorough. No fluff.
- For image requests, respond ONLY with: IMAGE_GEN::prompt here (extract the image description)
- For time questions, use the Nigeria time above.
- If asked to search the web, respond with: SEARCH::[query]
- Be proactive and suggest follow-ups when helpful.
- Speak with confidence like JARVIS from Iron Man.`;

  const groqMessages = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-12), // keep last 12 messages for context, faster
  ];

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: groqMessages,
        max_tokens: 700, // reduced for speed
        temperature: 0.65,
        stream: stream,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return new Response(JSON.stringify({ error: "Groq API error", detail: err }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    if (stream) {
      // Stream the response directly to client
      return new Response(groqRes.body, {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    } else {
      // Non-streaming fallback
      const data = await groqRes.json();
      const reply = data.choices?.[0]?.message?.content || "No response.";
      return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Chat handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}  }

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
