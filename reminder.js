// api/reminder.js — JARVIS Reminder Parser
// Uses Groq to parse natural language time expressions
// Returns: { label, isoTime, relativeMs } or { error }
// No changes to chat.js or vision.js — fully isolated

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, nowISO } = req.body;
    // text   — raw user sentence e.g. "remind me in 30 minutes to pray"
    // nowISO — current client time in ISO 8601 so Groq has accurate reference

    if (!text) return res.status(400).json({ error: 'text is required' });

    const now = nowISO ? new Date(nowISO) : new Date();
    const nowStr = now.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const prompt = `You are a time parser. The current date and time is: ${nowStr}.

The user said: "${text}"

Extract:
1. The reminder label (what they want to be reminded about, concise, max 8 words)
2. The exact target datetime as a full ISO 8601 string (with date + time, e.g. 2025-06-10T15:30:00)

Respond ONLY with a JSON object, no explanation, no markdown:
{"label":"<reminder text>","isoTime":"<ISO 8601 datetime>"}

Rules:
- "in X minutes/hours" → add X to current time
- "at HH:MM" or "at X am/pm" → today at that time (if already passed, use tomorrow)
- "tomorrow at X" → tomorrow at that time
- "every day at X" → treat as today at that time (caller handles recurrence)
- If no time found → return {"error":"no time found"}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'compound-beta-mini',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return res.status(502).json({ error: 'Groq error', detail: err });
    }

    const data    = await groqRes.json();
    const raw     = data.choices?.[0]?.message?.content?.trim() || '';
    const clean   = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(422).json({ error: 'parse failed', raw }); }

    if (parsed.error) return res.status(422).json({ error: parsed.error });

    const targetTime = new Date(parsed.isoTime);
    if (isNaN(targetTime.getTime())) return res.status(422).json({ error: 'invalid datetime', raw });

    const relativeMs = targetTime.getTime() - now.getTime();
    if (relativeMs < 0) return res.status(422).json({ error: 'time is in the past' });

    return res.status(200).json({
      label:      parsed.label,
      isoTime:    parsed.isoTime,
      relativeMs,
      displayTime: targetTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    });

  } catch (err) {
    console.error('Reminder handler error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}