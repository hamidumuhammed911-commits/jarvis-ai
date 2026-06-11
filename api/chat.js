// api/chat.js — JARVIS AI Chat Handler V4.3.2 (Node.js compatible)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    messages = [],
    location = null,
    weather = null,
    memory = "",
  } = req.body || {};

  const now = new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "full",
    timeStyle: "medium",
  });

  const systemPrompt = `You are JARVIS — an advanced AI assistant built for Boss Muhammed Aali. Always address him as "Sir" or "Boss". You are intelligent, precise, and loyal, modeled after Tony Stark's JARVIS.

Current Nigeria Time (Africa/Lagos): ${now}
${location ? `Boss Location: ${location}` : ""}
${weather ? `Current Weather: ${weather}` : ""}
${memory ? `Memory about Boss: ${memory}` : ""}

Rules:
- Be concise but thorough. No fluff.
- For image requests, respond ONLY with: IMAGE_GEN::prompt here
- For time questions, use the Nigeria time above.
- If asked to search the web, respond ONLY with: SEARCH::[query] — no other text, no explanation, no greeting, just SEARCH::[query] alone on its own.
- Speak with confidence like JARVIS from Iron Man.`;

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not set" });
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
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-12),
        ],
        max_tokens: 700,
        temperature: 0.65,
        stream: false,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return res.status(502).json({ error: "Groq API error", detail: err });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content || "No response.";
    return res.status(200).json({ reply });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}