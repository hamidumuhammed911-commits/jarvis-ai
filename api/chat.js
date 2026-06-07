// api/chat.js — JARVIS backend
// Model: compound-beta (Groq) — built-in web search, no extra config needed
// Features: real-time info, location-aware system prompt

export default async function handler(req, res) {
  // ── CORS ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, location } = req.body;

    // ── BUILD SYSTEM PROMPT ──
    // Location injected here server-side so it's always in context
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });

    let locationStr = 'Location unknown';
    if (location?.lat && location?.lon) {
      locationStr = `Lat ${location.lat.toFixed(4)}, Lon ${location.lon.toFixed(4)}`;
      if (location.city) locationStr = `${location.city}, ${location.country || ''} (${locationStr})`;
    }

    const SYSTEM = `You are JARVIS, a highly intelligent personal AI assistant. You are speaking DIRECTLY to your boss, Muhammed Aali — he is the one talking to you right now. Greet him as "Boss Muhammed Aali" on the first message, then use "Sir" after that. Never refer to him in third person. Never say things like "speak with him" or "on his behalf" — you are always talking directly TO him. Be precise, helpful, slightly formal but friendly. Keep responses concise — max 3 sentences.

Current date/time: ${timeStr}
Boss's current location: ${locationStr}

You have access to real-time web search. Use it automatically when asked about:
- Current news, weather, sports scores, stock prices
- Any information that may have changed recently
- Local information relevant to the boss's location
Do NOT mention that you are searching — just answer naturally with up-to-date info.`;

    // ── CALL GROQ compound-beta ──
    // compound-beta-mini: 3x faster, single web search per turn — perfect for voice
    // compound-beta: slower but can do multiple searches — use for research queries
    // We auto-select based on whether the query looks research-heavy
    const lastUserMsg = messages?.findLast?.(m => m.role === 'user')?.content || '';
    const isResearch = /research|compare|summarize|explain.*detail|list.*all|top \d+/i.test(lastUserMsg);
    const model = isResearch ? 'compound-beta' : 'compound-beta-mini';

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,   // keep concise for voice
        messages: [
          { role: 'system', content: SYSTEM },
          ...(messages || [])
        ]
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'Groq API error', detail: err });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content || 'I encountered an issue, Sir.';
    const toolsUsed = data.choices?.[0]?.message?.executed_tools || [];

    return res.status(200).json({
      reply,
      model,                         // so frontend can show "⚡ Live Search" badge
      searched: toolsUsed.length > 0 // true when compound used web search
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}