export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { messages, system } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          ...messages
        ]
      })
    });
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No response received.';
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
