/**
 * api/news.js — JARVIS Intel Feed
 * Uses your existing SERPER_KEY env var to fetch top news headlines
 * Route: GET /api/news
 * Returns: { articles: [{ title, source, url }] }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SERPER_KEY = process.env.SERPER_KEY;
  if (!SERPER_KEY) {
    return res.status(500).json({ error: 'SERPER_KEY not set', articles: [] });
  }

  try {
    const response = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: 'top news today',
        num: 6,
        gl: 'us',
        hl: 'en',
      }),
    });

    if (!response.ok) throw new Error(`Serper ${response.status}`);

    const data = await response.json();
    const articles = (data.news || []).map(item => ({
      title:  item.title  || 'Untitled',
      source: item.source || 'Unknown',
      url:    item.link   || '#',
    }));

    res.status(200).json({ articles });
  } catch (err) {
    console.error('[JARVIS news]', err.message);
    res.status(200).json({
      articles: [
        { title: 'INTEL FEED TEMPORARILY OFFLINE', source: 'JARVIS', url: '#' },
      ],
    });
  }
}