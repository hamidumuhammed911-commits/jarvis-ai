// api/news.js — JARVIS Real-Time Search Handler
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const query = req.query.q || req.body?.q;
  if (!query) return res.status(400).json({ error: "No query provided" });

  const SERPER_KEY = process.env.SERPER_KEY;
  if (!SERPER_KEY) return res.status(500).json({ error: "SERPER_KEY not set" });

  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": SERPER_KEY,
      },
      body: JSON.stringify({ q: query, num: 5 }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: "Serper API error", detail: err });
    }

    const data = await r.json();

    /* Build clean results array */
    const results = [];

    /* Answer box — direct answer if available */
    if (data.answerBox?.answer) {
      results.push({ title: data.answerBox.answer, snippet: "", link: "" });
    } else if (data.answerBox?.snippet) {
      results.push({ title: data.answerBox.snippet, snippet: "", link: "" });
    }

    /* Organic results */
    if (data.organic) {
      data.organic.slice(0, 4).forEach(item => {
        results.push({
          title: item.title || "",
          snippet: item.snippet || "",
          link: item.link || "",
        });
      });
    }

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}