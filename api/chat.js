// api/chat.js — Vercel serverless function, Groq backend
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages array' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: system || 'You are JARVIS, a helpful AI assistant.' },
          ...messages
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return res.status(groqRes.status).json({ error: `Groq error: ${err}` });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('JARVIS API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
