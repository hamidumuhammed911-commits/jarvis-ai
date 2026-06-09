// JARVIS V4.4.0 — api/news.js
// Returns structured headlines from Serper Google News

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { topic = "Nigeria", count = 5 } = req.method === "POST" ? req.body : req.query;

  try {
    const response = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: topic, num: parseInt(count, 10) || 5, gl: "ng" }),
    });

    if (!response.ok) {
      throw new Error(`Serper error: ${response.status}`);
    }

    const data = await response.json();
    const articles = (data.news || []).slice(0, 5).map((item) => ({
      title: item.title,
      source: item.source,
      date: item.date,
      snippet: item.snippet,
      link: item.link,
      imageUrl: item.imageUrl || null,
    }));

    return res.status(200).json({
      topic,
      count: articles.length,
      articles,
      fetched: new Date().toISOString(),
    });

  } catch (err) {
    console.error("JARVIS news error:", err);
    return res.status(500).json({ error: "News retrieval failed", details: err.message });
  }
}